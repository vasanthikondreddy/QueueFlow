const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema(
  {
    queueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Queue', required: true },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    seq: { type: Number, required: true },
    tokenNumber: { type: String, required: true }, // Q001, Q002 ...
    personName: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    status: { type: String, enum: ['WAITING', 'SERVING', 'COMPLETED', 'CANCELLED'], default: 'WAITING' },
    position: { type: Number, default: null, min: 1 }, // only WAITING tokens have a position (1..n, contiguous)
    requestId: { type: String, maxlength: 64 }, // client idempotency key
    servingAt: Date,
    completedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Unique token number within a queue (never reused, even after cancel/complete)
tokenSchema.index({ queueId: 1, tokenNumber: 1 }, { unique: true });
// Idempotency: the same client request can never create two tokens
tokenSchema.index(
  { queueId: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } }
);
// DB-level guarantee: at most ONE serving token per queue
tokenSchema.index(
  { queueId: 1 },
  { unique: true, partialFilterExpression: { status: 'SERVING' }, name: 'one_serving_per_queue' }
);
// Fast waiting-list / status lookups
tokenSchema.index({ queueId: 1, status: 1, position: 1 });
// Analytics
tokenSchema.index({ managerId: 1, createdAt: 1 });
tokenSchema.index({ managerId: 1, status: 1, completedAt: 1 });
tokenSchema.index({ managerId: 1, status: 1, cancelledAt: 1 });

tokenSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    ret.queueId = ret.queueId.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.managerId;
    delete ret.requestId;
    // Waiting time = servingAt - createdAt | Service duration = completedAt - servingAt
    ret.waitTimeMs = ret.servingAt ? new Date(ret.servingAt) - new Date(ret.createdAt) : null;
    ret.serviceTimeMs = ret.completedAt && ret.servingAt ? new Date(ret.completedAt) - new Date(ret.servingAt) : null;
    return ret;
  },
});

module.exports = mongoose.model('Token', tokenSchema);
