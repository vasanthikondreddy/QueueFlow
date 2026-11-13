const mongoose = require('mongoose');
const { EVENT_TYPES } = require('../utils/constants');

/** Append-only history of queue changes; powers the queue-length time series. */
const queueEventSchema = new mongoose.Schema({
  queueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Queue', required: true },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  eventType: { type: String, enum: EVENT_TYPES, required: true },
  tokenId: { type: mongoose.Schema.Types.ObjectId, ref: 'Token' },
  waitingCount: { type: Number, required: true, min: 0 }, // waiting tokens AFTER the event
  timestamp: { type: Date, default: Date.now },
});

queueEventSchema.index({ queueId: 1, timestamp: 1 });
queueEventSchema.index({ managerId: 1, timestamp: 1 });

module.exports = mongoose.model('QueueEvent', queueEventSchema);
