let io = null;

/** Holds the Socket.IO instance. Emit helpers are called ONLY after the DB write succeeded. */
module.exports = {
  setIo(instance) {
    io = instance;
  },
  publishQueueState(managerId, state) {
    if (!io) return;
    try {
      io.to(`queue:${state.queue.id}`).emit('queue:updated', state);
      io.to(`manager:${managerId}`).emit('queues:changed', { queueId: state.queue.id });
    } catch (e) {
      console.error('[socket] emit failed:', e.message);
    }
  },
  publishQueuesChanged(managerId, queueId) {
    if (!io) return;
    io.to(`manager:${managerId}`).emit('queues:changed', { queueId });
  },
  publishQueueDeleted(managerId, queueId) {
    if (!io) return;
    io.to(`queue:${queueId}`).emit('queue:deleted', { queueId });
    io.to(`manager:${managerId}`).emit('queues:changed', { queueId });
  },
};
