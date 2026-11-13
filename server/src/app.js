const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const mongoose = require('mongoose');
const { env } = require('./config/env');
const routes = require('./routes');
const { requireDb, notFound, errorHandler } = require('./middleware/error');

const app = express();
app.set('trust proxy', 1); // behind Render's proxy: correct client IPs for rate limiting

app.use(helmet());
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || env.clientOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '10kb' }));
app.use(mongoSanitize()); // strips $ and . operators -> NoSQL injection protection
if (env.nodeEnv !== 'test') app.use(morgan(':method :url :status :response-time ms')); // never logs bodies/headers

app.get('/health', (_req, res) =>
  res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'up' : 'down' })
);
app.use('/api', requireDb, routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
