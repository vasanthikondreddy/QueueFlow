const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const { signToken } = require('../middleware/auth');

// Compared against when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO5mHk7y3lJ1e0m3lq6o1v8m8n3z0X8aK';

exports.register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (await User.exists({ email })) throw new ApiError(409, 'An account with this email already exists.', 'EMAIL_TAKEN');
  let user;
  try {
    user = await User.create({ name, email, password });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'An account with this email already exists.', 'EMAIL_TAKEN');
    throw err;
  }
  res.status(201).json(ok({ user, token: signToken(user.id) }));
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  const valid = user ? await user.comparePassword(password) : await require('bcrypt').compare(password, DUMMY_HASH).then(() => false);
  if (!valid) throw new ApiError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
  res.json(ok({ user, token: signToken(user.id) }));
});

exports.me = asyncHandler(async (req, res) => res.json(ok({ user: req.user })));

exports.updateMe = asyncHandler(async (req, res) => {
  req.user.name = req.body.name;
  await req.user.save();
  res.json(ok({ user: req.user }));
});

exports.changePassword = asyncHandler(async (req, res) => {
  const user = await require('../models/User').findById(req.user.id).select('+password');
  if (!(await user.comparePassword(req.body.currentPassword))) {
    throw new ApiError(400, 'Current password is incorrect.', 'WRONG_PASSWORD');
  }
  user.password = req.body.newPassword;
  await user.save();
  res.json(ok({ message: 'Password updated' }));
});
