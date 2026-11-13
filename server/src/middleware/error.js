const mongoose = require('mongoose');
const { fail } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { env } = require('../config/env');

/** Rejects API calls early (503) while MongoDB is unreachable. */
exports.requireDb = (_req, _res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return next(new ApiError(503, 'Service temporarily unavailable. Please try again shortly.', 'DB_UNAVAILABLE'));
  }
  next();
};

exports.notFound = (req, _res, next) => next(new ApiError(404, `Route not found: ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND'));

// eslint-disable-next-line no-unused-vars
exports.errorHandler = (err, _req, res, _next) => {
  let { status, message, code, details } = err;

  if (err instanceof mongoose.Error.CastError) {
    status = 400; code = 'INVALID_ID'; message = 'Invalid identifier';
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400; code = 'VALIDATION_ERROR'; message = Object.values(err.errors)[0]?.message || 'Invalid data';
  } else if (err.code === 11000) {
    status = 409; code = 'DUPLICATE'; message = 'A record with these details already exists';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; code = 'BAD_JSON'; message = 'Malformed JSON body';
  } else if (err.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body too large';
  } else if (/ECONNREFUSED|MongoServerSelectionError|MongoNetworkError|MongoNotConnectedError/.test(`${err.name}${err.message}`)) {
    status = 503; code = 'DB_UNAVAILABLE'; message = 'Service temporarily unavailable. Please try again shortly.';
  } else if (!err.isOperational) {
    console.error('[error]', err.name, err.message, env.nodeEnv !== 'production' ? err.stack : '');
    status = 500; code = 'INTERNAL_ERROR'; message = 'Something went wrong on our side. Please try again.';
  }

  res.status(status || 500).json(fail(message, code, details));
};
