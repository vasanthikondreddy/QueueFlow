const request = require('supertest');
const h = require('./helpers');
const Token = require('../src/models/Token');

beforeAll(h.startDb);
afterAll(h.stopDb);
beforeEach(h.clearDb);

const get = (token, path) => request(h.app()).get(`/api/analytics/${path}`).set(h.authed(token));

describe('Analytics', () => {
  test('returns zeros and nulls (not errors) for a manager with no data', async () => {
    const m = await h.registerManager();
    const o = await get(m.token, 'overview?range=7d');
    expect(o.status).toBe(200);
    expect(o.body.data).toMatchObject({ totalQueues: 0, tokensCreated: 0, waiting: 0, serving: 0, completed: 0, cancelled: 0, avgWaitMs: null });
    const t = await get(m.token, 'trends?range=7d');
    expect(t.body.data.series.length).toBeGreaterThanOrEqual(7);
    expect(t.body.data.series.every((p) => p.created === 0 && p.avgWaitMs === null)).toBe(true);
    expect((await get(m.token, 'queues')).body.data.queues).toEqual([]);
  });

  test('validates the query string', async () => {
    const m = await h.registerManager();
    expect((await get(m.token, 'overview?range=1y')).status).toBe(400);
    expect((await get(m.token, 'overview?queueId=bad')).status).toBe(400);
  });

  test('waiting time = servingAt - createdAt, service duration = completedAt - servingAt', async () => {
    const m = await h.registerManager();
    const q = await h.createQueue(m.token);
    const now = Date.now();
    const mk = (seq, over) => ({ queueId: q.id, managerId: m.user.id, seq, tokenNumber: `Q00${seq}`, personName: `P${seq}`, ...over });
    await Token.collection.insertMany(
      [
        mk(1, { status: 'COMPLETED', createdAt: new Date(now - 30 * 60000), servingAt: new Date(now - 20 * 60000), completedAt: new Date(now - 15 * 60000) }), // wait 10m, service 5m
        mk(2, { status: 'COMPLETED', createdAt: new Date(now - 25 * 60000), servingAt: new Date(now - 5 * 60000), completedAt: new Date(now - 1 * 60000) }), // wait 20m, service 4m
        mk(3, { status: 'COMPLETED', createdAt: new Date(now - 10 * 60000), servingAt: new Date(now - 20 * 60000), completedAt: new Date(now - 1 * 60000) }), // invalid: served before created -> ignored
        mk(4, { status: 'CANCELLED', createdAt: new Date(now - 9 * 60000), cancelledAt: new Date(now - 8 * 60000) }),
        mk(5, { status: 'WAITING', position: 1, createdAt: new Date(now - 2 * 60000) }),
      ].map((d) => ({ ...d, queueId: new (require('mongoose').Types.ObjectId)(d.queueId), managerId: new (require('mongoose').Types.ObjectId)(d.managerId) }))
    );
    const o = (await get(m.token, 'overview?range=today')).body.data;
    expect(o).toMatchObject({ totalQueues: 1, completed: 3, cancelled: 1, waiting: 1, samples: 2 });
    expect(o.avgWaitMs).toBe(15 * 60000);
    expect(o.avgServiceMs).toBe(4.5 * 60000);
    const cmp = (await get(m.token, 'queues?range=today')).body.data.queues[0];
    expect(cmp).toMatchObject({ name: 'Front Desk', completed: 3, cancelled: 1, waiting: 1, avgWaitMs: 15 * 60000 });
  });

  test("queue length trend is built from QueueEvents and ignores other managers' data", async () => {
    const a = await h.registerManager();
    const b = await h.registerManager();
    const qa = await h.createQueue(a.token, 'A');
    const qb = await h.createQueue(b.token, 'B');
    await h.addPerson(a.token, qa.id, 'x');
    await h.addPerson(a.token, qa.id, 'y');
    await h.addPerson(b.token, qb.id, 'z');
    const t = (await get(a.token, 'trends?range=today')).body.data;
    expect(t.series.reduce((s, p) => s + p.created, 0)).toBe(2);
    expect(t.series[t.series.length - 1].queueLength).toBe(2);
    expect(Math.max(...t.series.map((p) => p.peakQueueLength))).toBe(2);
  });
});
