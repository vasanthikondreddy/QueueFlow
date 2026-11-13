const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const { fail } = require('../utils/response');

exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json(fail('Too many attempts. Please try again in a few minutes.', 'RATE_LIMITED')),
});
