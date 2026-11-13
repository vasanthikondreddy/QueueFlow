const asyncHandler = require('../utils/asyncHandler');
const realtime = require('../utils/realtime');
const { ok } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const Queue = require('../models/Queue');
const svc = require('../services/tokenService');

const publish = (req, state) => realtime.publishQueueState(req.user.id, state);

exports.list = asyncHandler(async (req, res) => {
  if (!(await Queue.exists({ _id: req.params.queueId, managerId: req.user._id }))) {
    throw new ApiError(404, 'Queue not found', 'QUEUE_NOT_FOUND');
  }
  res.json(ok(await svc.getQueueState(req.params.queueId)));
});

exports.add = asyncHandler(async (req, res) => {
  const { token, state, duplicate } = await svc.addToken(req.params.queueId, req.user._id, req.body.personName, req.body.requestId);
  if (!duplicate) publish(req, state);
  res.status(duplicate ? 200 : 201).json(ok({ token, state, duplicate }));
});

exports.reorder = asyncHandler(async (req, res) => {
  const { state } = await svc.reorder(req.params.queueId, req.user._id, req.body);
  publish(req, state);
  res.json(ok({ state }));
});

exports.serveNext = asyncHandler(async (req, res) => {
  const { token, state } = await svc.serveNext(req.params.queueId, req.user._id);
  publish(req, state);
  res.json(ok({ token, state }));
});

exports.complete = asyncHandler(async (req, res) => {
  const { token, state } = await svc.complete(req.params.queueId, req.user._id, req.params.tokenId);
  publish(req, state);
  res.json(ok({ token, state }));
});

exports.cancel = asyncHandler(async (req, res) => {
  const { token, state } = await svc.cancel(req.params.queueId, req.user._id, req.params.tokenId);
  publish(req, state);
  res.json(ok({ token, state }));
});
