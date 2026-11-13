const crypto = require('crypto');
const Queue = require('../models/Queue');
const ApiError = require('./ApiError');

const LOCK_TTL_MS = 10000; // a crashed holder can never block a queue for longer than this
const MAX_WAIT_MS = 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Per-queue mutex stored in MongoDB (works across multiple server instances).
 * Lock acquisition is a single atomic findOneAndUpdate, so exactly one request wins.
 * It also doubles as the ownership check: a queue that belongs to another manager
 * is indistinguishable from a missing one (404).
 */
async function withQueueLock(queueId, managerId, fn) {
  const lockId = crypto.randomUUID();
  const startedAt = Date.now();
  let queue = null;

  while (!queue) {
    const now = new Date();
    queue = await Queue.findOneAndUpdate(
      { _id: queueId, managerId, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + LOCK_TTL_MS), lockId } },
      { new: true }
    );
    if (queue) break;
    if (!(await Queue.exists({ _id: queueId, managerId }))) {
      throw new ApiError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
    }
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new ApiError(409, 'This queue is busy. Please try again.', 'QUEUE_BUSY');
    }
    await sleep(20 + Math.random() * 40);
  }

  try {
    return await fn(queue);
  } finally {
    await Queue.updateOne({ _id: queueId, lockId }, { $set: { lockedUntil: null, lockId: null } }).catch((e) =>
      console.error('[lock] release failed:', e.message)
    );
  }
}

module.exports = { withQueueLock };
