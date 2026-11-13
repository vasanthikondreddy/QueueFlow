const mongoose = require('mongoose');
const Queue = require('../models/Queue');
const Token = require('../models/Token');
const QueueEvent = require('../models/QueueEvent');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const realtime = require('../utils/realtime');
const { ok } = require('../utils/response');
const { withQueueLock } = require('../utils/queueLock');
const { recordEvent } = require('../services/events');
const { getQueueState } = require('../services/tokenService');

const DUP_NAME = () => new ApiError(409, 'You already have a queue with this name.', 'QUEUE_NAME_TAKEN');
const emptyCounts = () => ({ waiting: 0, serving: 0, completed: 0, cancelled: 0, total: 0 });

async function countsFor(queueIds) {
  const rows = await Token.aggregate([
    { $match: { queueId: { $in: queueIds } } },
    { $group: { _id: { q: '$queueId', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const map = new Map();
  rows.forEach(({ _id, n }) => {
    const key = String(_id.q);
    if (!map.has(key)) map.set(key, emptyCounts());
    const c = map.get(key);
    c[_id.s.toLowerCase()] = n;
    c.total += n;
  });
  return map;
}

exports.create = asyncHandler(async (req, res) => {
  let queue;
  try {
    queue = await Queue.create({ name: req.body.name, managerId: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw DUP_NAME();
    throw err;
  }
  await recordEvent(queue, 'QUEUE_CREATED');
  realtime.publishQueuesChanged(req.user.id, queue.id);
  res.status(201).json(ok({ queue: { ...queue.toJSON(), counts: emptyCounts() } }));
});

exports.list = asyncHandler(async (req, res) => {
  const queues = await Queue.find({ managerId: req.user._id }).sort({ createdAt: -1 });
  const counts = await countsFor(queues.map((q) => q._id));
  res.json(ok({ queues: queues.map((q) => ({ ...q.toJSON(), counts: counts.get(q.id) || emptyCounts() })) }));
});

exports.get = asyncHandler(async (req, res) => {
  const queue = await Queue.findOne({ _id: req.params.queueId, managerId: req.user._id });
  if (!queue) throw new ApiError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
  const counts = await countsFor([queue._id]);
  res.json(ok({ queue: { ...queue.toJSON(), counts: counts.get(queue.id) || emptyCounts() } }));
});

exports.update = asyncHandler(async (req, res) => {
  const { name, status } = req.body;
  if (name === undefined && status === undefined) throw new ApiError(400, 'Provide a name or a status to update.', 'VALIDATION_ERROR');
  const set = {};
  if (name !== undefined) Object.assign(set, { name, nameKey: name.toLowerCase() });
  if (status !== undefined) set.status = status;

  const state = await withQueueLock(req.params.queueId, req.user._id, async (queue) => {
    try {
      await Queue.updateOne({ _id: queue._id }, { $set: set, $inc: { version: 1 } });
    } catch (err) {
      if (err.code === 11000) throw DUP_NAME();
      throw err;
    }
    return getQueueState(queue.id);
  });
  realtime.publishQueueState(req.user.id, state);
  res.json(ok({ queue: { ...state.queue, counts: state.counts } }));
});

exports.remove = asyncHandler(async (req, res) => {
  const { queueId } = req.params;
  await withQueueLock(queueId, req.user._id, async () => {
    const active = await Token.countDocuments({ queueId, status: { $in: ['WAITING', 'SERVING'] } });
    if (active > 0) {
      throw new ApiError(409, `This queue still has ${active} active token${active > 1 ? 's' : ''}. Serve or cancel them before deleting.`, 'QUEUE_NOT_EMPTY');
    }
    const id = new mongoose.Types.ObjectId(queueId);
    await Token.deleteMany({ queueId: id });
    await QueueEvent.deleteMany({ queueId: id });
    await Queue.deleteOne({ _id: id, managerId: req.user._id });
  });
  realtime.publishQueueDeleted(req.user.id, queueId);
  res.json(ok({ deleted: true }));
});
