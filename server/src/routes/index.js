const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const auth = require('../controllers/authController');
const queues = require('../controllers/queueController');
const tokens = require('../controllers/tokenController');
const analytics = require('../controllers/analyticsController');

const router = express.Router();

const str = (field, { min = 1, max = 60, label = field } = {}) =>
  body(field)
    .isString().withMessage(`${label} must be text`)
    .bail()
    .trim()
    .isLength({ min, max }).withMessage(min <= 1 ? `${label} is required (max ${max} characters)` : `${label} must be ${min}-${max} characters`);

const queueId = param('queueId').isMongoId().withMessage('Invalid queue id');
const tokenId = param('tokenId').isMongoId().withMessage('Invalid token id');
const password = (field) =>
  body(field).isString().isLength({ min: 8, max: 72 }).withMessage('Password must be 8-72 characters')
    .matches(/[A-Za-z]/).withMessage('Password must contain a letter').matches(/\d/).withMessage('Password must contain a number');
const email = body('email').isString().trim().toLowerCase().isEmail().withMessage('Enter a valid email address').isLength({ max: 254 });

// ---- Auth ----
router.post('/auth/register', authLimiter, str('name', { min: 2, label: 'Name' }), email, password('password'), validate, auth.register);
router.post('/auth/login', authLimiter, email, body('password').isString().notEmpty().withMessage('Password is required'), validate, auth.login);
router.get('/auth/me', authenticate, auth.me);
router.put('/auth/me', authenticate, str('name', { min: 2, label: 'Name' }), validate, auth.updateMe);
router.post('/auth/change-password', authenticate, authLimiter, body('currentPassword').isString().notEmpty(), password('newPassword'), validate, auth.changePassword);

// Everything below requires a valid JWT
router.use(authenticate);

// ---- Queues ----
router.post('/queues', str('name', { label: 'Queue name', max: 80 }), validate, queues.create);
router.get('/queues', queues.list);
router.get('/queues/:queueId', queueId, validate, queues.get);
router.put(
  '/queues/:queueId',
  queueId,
  body('name').optional().isString().trim().isLength({ min: 1, max: 80 }).withMessage('Queue name is required (max 80 characters)'),
  body('status').optional().isIn(['ACTIVE', 'INACTIVE']).withMessage('Status must be ACTIVE or INACTIVE'),
  validate,
  queues.update
);
router.delete('/queues/:queueId', queueId, validate, queues.remove);

// ---- Tokens ----
router.post(
  '/queues/:queueId/tokens',
  queueId,
  str('personName', { label: 'Name', max: 60 }),
  body('requestId').optional().isString().isLength({ max: 64 }),
  validate,
  tokens.add
);
router.get('/queues/:queueId/tokens', queueId, validate, tokens.list);
router.patch(
  '/queues/:queueId/tokens/reorder',
  queueId,
  body('tokenId').isMongoId().withMessage('Invalid token id'),
  body('direction').isIn(['up', 'down']).withMessage('Direction must be "up" or "down"'),
  body('version').optional().isInt({ min: 0 }).toInt(),
  validate,
  tokens.reorder
);
router.post('/queues/:queueId/serve-next', queueId, validate, tokens.serveNext);
router.post('/queues/:queueId/tokens/:tokenId/complete', queueId, tokenId, validate, tokens.complete);
router.post('/queues/:queueId/tokens/:tokenId/cancel', queueId, tokenId, validate, tokens.cancel);

// ---- Analytics ----
const analyticsQuery = [
  query('range').optional().isIn(['today', '7d', '30d']).withMessage('range must be today, 7d or 30d'),
  query('tzOffset').optional().isInt({ min: -840, max: 840 }).withMessage('Invalid tzOffset'),
  query('queueId').optional().isMongoId().withMessage('Invalid queue id'),
  validate,
];
router.get('/analytics/overview', analyticsQuery, analytics.overview);
router.get('/analytics/trends', analyticsQuery, analytics.trends);
router.get('/analytics/queues', analyticsQuery, analytics.queues);

module.exports = router;
