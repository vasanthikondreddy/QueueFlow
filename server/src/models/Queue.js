const mongoose = require('mongoose');

const queueSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    nameKey: { type: String, required: true }, // lower-cased name -> unique per manager
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    nextTokenNumber: { type: Number, default: 1, min: 1 }, // atomic counter ($inc)
    version: { type: Number, default: 0 }, // bumped on every mutation (optimistic concurrency)
    lockedUntil: { type: Date, default: null },
    lockId: { type: String, default: null },
  },
  { timestamps: true }
);

queueSchema.index({ managerId: 1, createdAt: -1 });
queueSchema.index({ managerId: 1, nameKey: 1 }, { unique: true });

queueSchema.pre('validate', function setKey(next) {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
  next();
});

queueSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    ret.managerId = ret.managerId.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.nameKey;
    delete ret.lockedUntil;
    delete ret.lockId;
    return ret;
  },
});

module.exports = mongoose.model('Queue', queueSchema);
