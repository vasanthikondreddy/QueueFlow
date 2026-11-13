const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const svc = require('../services/analyticsService');

const opts = (req) => ({
  range: req.query.range || '7d',
  tzOffset: req.query.tzOffset !== undefined ? Number(req.query.tzOffset) : 0,
  queueId: req.query.queueId,
});

exports.overview = asyncHandler(async (req, res) => res.json(ok(await svc.overview(req.user._id, opts(req)))));
exports.trends = asyncHandler(async (req, res) => res.json(ok(await svc.trends(req.user._id, opts(req)))));
exports.queues = asyncHandler(async (req, res) => res.json(ok(await svc.queueComparison(req.user._id, opts(req)))));
