exports.ok = (data) => ({ success: true, data });
exports.fail = (message, code, details) => ({
  success: false,
  error: { message, code, ...(details ? { details } : {}) },
});
