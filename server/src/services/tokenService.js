const mongoose = require('mongoose');
const Queue = require('../models/Queue');
const Token = require('../models/Token');
const ApiError = require('../utils/ApiError');
const { withQueueLock } = require('../utils/queueLock');
const { recordEvent } = require('./events');

const formatToken = (seq) => `Q${String(seq).padStart(3, '0')}`;
const bump = (queueId) => Queue.updateOne({ _id: queueId }, { $inc: { version: 1 } });

/** Full snapshot of a queue: what the UI renders and what Socket.IO broadcasts. */
async function getQueueState(queueId) {
  const [queue, waiting, serving, history, grouped] = await Promise.all([
    Queue.findById(queueId),
    Token.find({ queueId, status: 'WAITING' }).sort({ position: 1 }),
    Token.findOne({ queueId, status: 'SERVING' }),
    Token.find({ queueId, status: { $in: ['COMPLETED', 'CANCELLED'] } })
      .sort({ createdAt: -1 })
      .limit(30),
    Token.aggregate([{ $match: { queueId: new mongoose.Types.ObjectId(queueId) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  if (!queue) throw new ApiError(404, 'Queue not found', 'QUEUE_NOT_FOUND');

  const counts = { waiting: 0, serving: 0, completed: 0, cancelled: 0, total: 0 };
  grouped.forEach((g) => {
    counts[g._id.toLowerCase()] = g.n;
    counts.total += g.n;
  });
  const finishedAt = (t) => t.completedAt || t.cancelledAt || t.createdAt;
  history.sort((a, b) => finishedAt(b) - finishedAt(a));

  return { queue: queue.toJSON(), waiting, serving, history: history.slice(0, 15), counts };
}

async function addToken(queueId, managerId, personName, requestId) {
  return withQueueLock(queueId, managerId, async (queue) => {
    if (requestId) {
      const existing = await Token.findOne({ queueId, requestId });
      if (existing) return { token: existing, state: await getQueueState(queueId), duplicate: true };
    }
    if (queue.status !== 'ACTIVE') {
      throw new ApiError(409, 'This queue is inactive. Activate it to add people.', 'QUEUE_INACTIVE');
    }

    // Atomic counter: returns the value BEFORE increment, so each request gets a unique number.
    const before = await Queue.findOneAndUpdate({ _id: queueId }, { $inc: { nextTokenNumber: 1, version: 1 } }, { new: false });
    const seq = before.nextTokenNumber;
    const waitingCount = await Token.countDocuments({ queueId, status: 'WAITING' });

    const token = await Token.create({
      queueId,
      managerId,
      seq,
      tokenNumber: formatToken(seq),
      personName,
      requestId,
      status: 'WAITING',
      position: waitingCount + 1,
    });
    await recordEvent(queue, 'TOKEN_ADDED', token._id);
    return { token, state: await getQueueState(queueId), duplicate: false };
  });
}

async function reorder(queueId, managerId, { tokenId, direction, version }) {
  return withQueueLock(queueId, managerId, async (queue) => {
    if (version !== undefined && version !== queue.version) {
      throw new ApiError(409, 'The queue changed while you were editing. It has been refreshed.', 'STALE_QUEUE');
    }
    const waiting = await Token.find({ queueId, status: 'WAITING' }).sort({ position: 1 }).select('_id position');
    const idx = waiting.findIndex((t) => t.id === tokenId);

    if (idx === -1) {
      const t = await Token.findOne({ _id: tokenId, queueId }).select('status');
      if (!t) throw new ApiError(404, 'Token not found', 'TOKEN_NOT_FOUND');
      const msg = t.status === 'SERVING' ? 'A token that is being served cannot be moved.' : `A ${t.status.toLowerCase()} token cannot be moved.`;
      throw new ApiError(409, msg, 'TOKEN_NOT_MOVABLE');
    }
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0) throw new ApiError(409, 'This token is already first in line.', 'MOVE_OUT_OF_BOUNDS');
    if (target >= waiting.length) throw new ApiError(409, 'This token is already last in line.', 'MOVE_OUT_OF_BOUNDS');

    // Swap with the neighbour. Positions stay contiguous because we only exchange two values.
    await Token.bulkWrite([
      { updateOne: { filter: { _id: waiting[idx]._id, status: 'WAITING' }, update: { $set: { position: waiting[target].position } } } },
      { updateOne: { filter: { _id: waiting[target]._id, status: 'WAITING' }, update: { $set: { position: waiting[idx].position } } } },
    ]);
    await bump(queueId);
    await recordEvent(queue, 'TOKEN_REORDERED', waiting[idx]._id);
    return { state: await getQueueState(queueId) };
  });
}

async function serveNext(queueId, managerId) {
  return withQueueLock(queueId, managerId, async (queue) => {
    if (queue.status !== 'ACTIVE') throw new ApiError(409, 'This queue is inactive. Activate it to serve tokens.', 'QUEUE_INACTIVE');
    if (await Token.exists({ queueId, status: 'SERVING' })) {
      throw new ApiError(409, 'Complete the current service before calling the next token.', 'ALREADY_SERVING');
    }
    let token;
    try {
      token = await Token.findOneAndUpdate(
        { queueId, status: 'WAITING' },
        { $set: { status: 'SERVING', servingAt: new Date(), position: null } },
        { sort: { position: 1 }, new: true }
      );
    } catch (err) {
      // Backstop: the partial unique index "one_serving_per_queue" rejected a second SERVING token.
      if (err.code === 11000) throw new ApiError(409, 'Complete the current service before calling the next token.', 'ALREADY_SERVING');
      throw err;
    }
    if (!token) throw new ApiError(409, 'There is nobody waiting in this queue.', 'QUEUE_EMPTY');

    await Token.updateMany({ queueId, status: 'WAITING' }, { $inc: { position: -1 } });
    await bump(queueId);
    await recordEvent(queue, 'TOKEN_SERVING', token._id);
    return { token, state: await getQueueState(queueId) };
  });
}

async function complete(queueId, managerId, tokenId) {
  return withQueueLock(queueId, managerId, async (queue) => {
    const token = await Token.findOneAndUpdate(
      { _id: tokenId, queueId, status: 'SERVING' },
      { $set: { status: 'COMPLETED', completedAt: new Date() } },
      { new: true }
    );
    if (!token) {
      const t = await Token.findOne({ _id: tokenId, queueId }).select('status');
      if (!t) throw new ApiError(404, 'Token not found', 'TOKEN_NOT_FOUND');
      throw new ApiError(409, `Only a token being served can be completed (this one is ${t.status.toLowerCase()}).`, 'INVALID_STATE');
    }
    await bump(queueId);
    await recordEvent(queue, 'TOKEN_COMPLETED', token._id);
    return { token, state: await getQueueState(queueId) };
  });
}

async function cancel(queueId, managerId, tokenId) {
  return withQueueLock(queueId, managerId, async (queue) => {
    const before = await Token.findOneAndUpdate(
      { _id: tokenId, queueId, status: 'WAITING' },
      { $set: { status: 'CANCELLED', cancelledAt: new Date(), position: null } },
      { new: false }
    );
    if (!before) {
      const t = await Token.findOne({ _id: tokenId, queueId }).select('status');
      if (!t) throw new ApiError(404, 'Token not found', 'TOKEN_NOT_FOUND');
      if (t.status === 'SERVING') {
        throw new ApiError(409, 'A token that is being served cannot be cancelled. Complete the service instead.', 'CANNOT_CANCEL_SERVING');
      }
      throw new ApiError(409, `This token is already ${t.status.toLowerCase()}.`, 'INVALID_STATE');
    }
    // Close the gap so waiting positions stay 1..n
    await Token.updateMany({ queueId, status: 'WAITING', position: { $gt: before.position } }, { $inc: { position: -1 } });
    await bump(queueId);
    await recordEvent(queue, 'TOKEN_CANCELLED', before._id);
    const token = await Token.findById(tokenId);
    return { token, state: await getQueueState(queueId) };
  });
}

module.exports = { getQueueState, addToken, reorder, serveNext, complete, cancel };
