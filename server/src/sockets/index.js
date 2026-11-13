const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Queue = require('../models/Queue');
const realtime = require('../utils/realtime');
const { env } = require('../config/env');

function initSockets(httpServer) {
  const io = new Server(httpServer, { cors: { origin: env.clientOrigins, credentials: true } });

  // Every connection must present a valid JWT in the handshake
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('AUTH_REQUIRED'));
      const payload = jwt.verify(token, env.jwtSecret);
      const user = await User.findById(payload.sub).select('_id');
      if (!user) return next(new Error('AUTH_INVALID'));
      socket.data.userId = user.id;
      next();
    } catch (err) {
      next(new Error(err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'AUTH_INVALID'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`manager:${socket.data.userId}`);

    // Rooms are joined only after the DB confirms the queue belongs to this manager
    socket.on('queue:join', async (queueId, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!mongoose.isValidObjectId(queueId)) return reply({ ok: false, error: 'Invalid queue id' });
        const owned = await Queue.exists({ _id: queueId, managerId: socket.data.userId });
        if (!owned) return reply({ ok: false, error: 'Queue not found' });
        await socket.join(`queue:${queueId}`);
        reply({ ok: true });
      } catch (err) {
        reply({ ok: false, error: 'Unable to join queue' });
      }
    });

    socket.on('queue:leave', (queueId) => {
      if (typeof queueId === 'string') socket.leave(`queue:${queueId}`);
    });
  });

  realtime.setIo(io);
  return io;
}

module.exports = { initSockets };
