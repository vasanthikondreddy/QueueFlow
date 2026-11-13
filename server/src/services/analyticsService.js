const mongoose = require('mongoose');
const Queue = require('../models/Queue');
const Token = require('../models/Token');
const QueueEvent = require('../models/QueueEvent');

const HOUR = 3600000;
const DAY = 86400000;
const oid = (id) => new mongoose.Types.ObjectId(id);

/**
 * Calculation rules
 *   waiting time     = servingAt   - createdAt
 *   service duration = completedAt - servingAt
 * Averages only use COMPLETED tokens whose timestamps are present and ordered
 * (createdAt <= servingAt <= completedAt).
 */
const VALID_TIMES = {
  servingAt: { $type: 'date' },
  completedAt: { $type: 'date' },
  $expr: { $and: [{ $gte: ['$servingAt', '$createdAt'] }, { $gte: ['$completedAt', '$servingAt'] }] },
};
const WAIT_MS = { $subtract: ['$servingAt', '$createdAt'] };
const SERVICE_MS = { $subtract: ['$completedAt', '$servingAt'] };

/** tzOffsetMin follows Date#getTimezoneOffset(): minutes to ADD to local time to get UTC. */
function resolveRange(range = '7d', tzOffsetMin = 0) {
  const now = new Date();
  const localNow = new Date(now.getTime() - tzOffsetMin * 60000);
  const startOfLocalDay = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
  const days = range === 'today' ? 0 : range === '30d' ? 29 : 6;
  const start = new Date(startOfLocalDay - days * DAY + tzOffsetMin * 60000);
  return { start, end: now, granularity: range === 'today' ? 'hour' : 'day', tzOffsetMin };
}

function tzString(offsetMin) {
  const local = -offsetMin; // minutes ahead of UTC
  const sign = local >= 0 ? '+' : '-';
  const abs = Math.abs(local);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function bucketKey(date, { granularity, tzOffsetMin }) {
  const iso = new Date(date.getTime() - tzOffsetMin * 60000).toISOString();
  return granularity === 'hour' ? iso.slice(0, 13) : iso.slice(0, 10);
}

function bucketSkeleton(r) {
  const step = r.granularity === 'hour' ? HOUR : DAY;
  const keys = [];
  for (let t = r.start.getTime(); t <= r.end.getTime(); t += step) keys.push(bucketKey(new Date(t), r));
  return [...new Set(keys)];
}

const scope = (managerId, queueId) => ({ managerId, ...(queueId ? { queueId: oid(queueId) } : {}) });
const bucketExpr = (field, r) => ({
  $dateToString: { format: r.granularity === 'hour' ? '%Y-%m-%dT%H' : '%Y-%m-%d', date: field, timezone: tzString(r.tzOffsetMin) },
});

async function overview(managerId, { range, tzOffset, queueId }) {
  const r = resolveRange(range, tzOffset);
  const base = scope(managerId, queueId);

  const [totalQueues, created, current, completed, cancelled, avg] = await Promise.all([
    Queue.countDocuments({ managerId, ...(queueId ? { _id: queueId } : {}) }),
    Token.countDocuments({ ...base, createdAt: { $gte: r.start } }),
    Token.aggregate([{ $match: { ...base, status: { $in: ['WAITING', 'SERVING'] } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Token.countDocuments({ ...base, status: 'COMPLETED', completedAt: { $gte: r.start } }),
    Token.countDocuments({ ...base, status: 'CANCELLED', cancelledAt: { $gte: r.start } }),
    Token.aggregate([
      { $match: { ...base, status: 'COMPLETED', ...VALID_TIMES, completedAt: { $gte: r.start, $type: 'date' } } },
      { $group: { _id: null, avgWaitMs: { $avg: WAIT_MS }, avgServiceMs: { $avg: SERVICE_MS }, samples: { $sum: 1 } } },
    ]),
  ]);
  const cur = Object.fromEntries(current.map((c) => [c._id, c.n]));
  return {
    range,
    since: r.start,
    totalQueues,
    tokensCreated: created,
    waiting: cur.WAITING || 0,
    serving: cur.SERVING || 0,
    completed,
    cancelled,
    avgWaitMs: avg[0] ? Math.round(avg[0].avgWaitMs) : null,
    avgServiceMs: avg[0] ? Math.round(avg[0].avgServiceMs) : null,
    samples: avg[0]?.samples || 0,
  };
}

async function trends(managerId, { range, tzOffset, queueId }) {
  const r = resolveRange(range, tzOffset);
  const base = scope(managerId, queueId);

  const [created, completed, cancelled, events, seed] = await Promise.all([
    Token.aggregate([
      { $match: { ...base, createdAt: { $gte: r.start } } },
      { $group: { _id: bucketExpr('$createdAt', r), n: { $sum: 1 } } },
    ]),
    Token.aggregate([
      { $match: { ...base, status: 'COMPLETED', ...VALID_TIMES, completedAt: { $gte: r.start, $type: 'date' } } },
      { $group: { _id: bucketExpr('$completedAt', r), n: { $sum: 1 }, avgWaitMs: { $avg: WAIT_MS }, avgServiceMs: { $avg: SERVICE_MS } } },
    ]),
    Token.aggregate([
      { $match: { ...base, status: 'CANCELLED', cancelledAt: { $gte: r.start } } },
      { $group: { _id: bucketExpr('$cancelledAt', r), n: { $sum: 1 } } },
    ]),
    QueueEvent.find({ ...base, timestamp: { $gte: r.start } }).sort({ timestamp: 1 }).select('queueId waitingCount timestamp').lean(),
    // Last known length of every queue just before the range starts (so the chart does not begin at 0)
    QueueEvent.aggregate([
      { $match: { ...base, timestamp: { $lt: r.start } } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$queueId', waitingCount: { $first: '$waitingCount' } } },
    ]),
  ]);

  const toMap = (rows) => new Map(rows.map((x) => [x._id, x]));
  const cMap = toMap(created), dMap = toMap(completed), xMap = toMap(cancelled);

  const state = new Map(seed.map((s) => [String(s._id), s.waitingCount]));
  const sum = () => [...state.values()].reduce((a, b) => a + b, 0);
  const evByBucket = new Map();
  events.forEach((e) => {
    const k = bucketKey(e.timestamp, r);
    if (!evByBucket.has(k)) evByBucket.set(k, []);
    evByBucket.get(k).push(e);
  });

  const series = bucketSkeleton(r).map((bucket) => {
    let peak = sum();
    (evByBucket.get(bucket) || []).forEach((e) => {
      state.set(String(e.queueId), e.waitingCount);
      peak = Math.max(peak, sum());
    });
    const d = dMap.get(bucket);
    return {
      bucket,
      created: cMap.get(bucket)?.n || 0,
      completed: d?.n || 0,
      cancelled: xMap.get(bucket)?.n || 0,
      avgWaitMs: d ? Math.round(d.avgWaitMs) : null,
      avgServiceMs: d ? Math.round(d.avgServiceMs) : null,
      queueLength: sum(),
      peakQueueLength: peak,
    };
  });
  return { range, granularity: r.granularity, series };
}

async function queueComparison(managerId, { range, tzOffset }) {
  const r = resolveRange(range, tzOffset);
  const [queues, created, finished, cancelled, waiting] = await Promise.all([
    Queue.find({ managerId }).sort({ createdAt: 1 }),
    Token.aggregate([{ $match: { managerId, createdAt: { $gte: r.start } } }, { $group: { _id: '$queueId', n: { $sum: 1 } } }]),
    Token.aggregate([
      { $match: { managerId, status: 'COMPLETED', ...VALID_TIMES, completedAt: { $gte: r.start, $type: 'date' } } },
      { $group: { _id: '$queueId', n: { $sum: 1 }, avgWaitMs: { $avg: WAIT_MS }, avgServiceMs: { $avg: SERVICE_MS } } },
    ]),
    Token.aggregate([{ $match: { managerId, status: 'CANCELLED', cancelledAt: { $gte: r.start } } }, { $group: { _id: '$queueId', n: { $sum: 1 } } }]),
    Token.aggregate([{ $match: { managerId, status: 'WAITING' } }, { $group: { _id: '$queueId', n: { $sum: 1 } } }]),
  ]);
  const m = (rows) => new Map(rows.map((x) => [String(x._id), x]));
  const cr = m(created), fi = m(finished), ca = m(cancelled), wa = m(waiting);
  return {
    range,
    queues: queues.map((q) => {
      const id = q._id.toString();
      const f = fi.get(id);
      return {
        queueId: id,
        name: q.name,
        status: q.status,
        created: cr.get(id)?.n || 0,
        completed: f?.n || 0,
        cancelled: ca.get(id)?.n || 0,
        waiting: wa.get(id)?.n || 0,
        avgWaitMs: f ? Math.round(f.avgWaitMs) : null,
        avgServiceMs: f ? Math.round(f.avgServiceMs) : null,
      };
    }),
  };
}

module.exports = { overview, trends, queueComparison, resolveRange };
