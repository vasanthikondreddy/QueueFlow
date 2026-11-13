const QueueEvent = require('../models/QueueEvent');
const Token = require('../models/Token');

/**
 * Appends a QueueEvent. The business operation has already been committed at this point,
 * so a failure here is logged loudly instead of turning a successful action into an error.
 */
async function recordEvent(queue, eventType, tokenId) {
  try {
    const waitingCount = await Token.countDocuments({ queueId: queue._id, status: 'WAITING' });
    await QueueEvent.create({ queueId: queue._id, managerId: queue.managerId, eventType, tokenId, waitingCount });
  } catch (err) {
    console.error(`[events] failed to record ${eventType}:`, err.message);
  }
}

module.exports = { recordEvent };
