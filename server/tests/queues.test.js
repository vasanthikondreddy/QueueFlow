const request = require('supertest');
const h = require('./helpers');

beforeAll(h.startDb);
afterAll(h.stopDb);
beforeEach(h.clearDb);

describe('Queues', () => {
  test('creates and lists only my queues', async () => {
    const a = await h.registerManager();
    const b = await h.registerManager();
    await h.createQueue(a.token, 'Alpha');
    await h.createQueue(b.token, 'Bravo');
    const res = await request(h.app()).get('/api/queues').set(h.authed(a.token));
    expect(res.status).toBe(200);
    expect(res.body.data.queues).toHaveLength(1);
    expect(res.body.data.queues[0]).toMatchObject({ name: 'Alpha', status: 'ACTIVE', nextTokenNumber: 1, version: 0 });
  });

  test('validates the queue name and rejects duplicates per manager', async () => {
    const a = await h.registerManager();
    expect((await request(h.app()).post('/api/queues').set(h.authed(a.token)).send({ name: '   ' })).status).toBe(400);
    await h.createQueue(a.token, 'Billing');
    const dup = await request(h.app()).post('/api/queues').set(h.authed(a.token)).send({ name: 'billing' });
    expect(dup.status).toBe(409);
  });

  test("another manager cannot read, modify or delete my queue (404)", async () => {
    const a = await h.registerManager();
    const b = await h.registerManager();
    const q = await h.createQueue(a.token);
    const get = await request(h.app()).get(`/api/queues/${q.id}`).set(h.authed(b.token));
    const put = await request(h.app()).put(`/api/queues/${q.id}`).set(h.authed(b.token)).send({ name: 'Hacked' });
    const del = await request(h.app()).delete(`/api/queues/${q.id}`).set(h.authed(b.token));
    const toks = await request(h.app()).get(`/api/queues/${q.id}/tokens`).set(h.authed(b.token));
    const add = await h.addPerson(b.token, q.id, 'Intruder');
    [get, put, del, toks, add].forEach((r) => expect(r.status).toBe(404));
  });

  test('handles invalid and unknown ids', async () => {
    const a = await h.registerManager();
    expect((await request(h.app()).get('/api/queues/not-an-id').set(h.authed(a.token))).status).toBe(400);
    expect((await request(h.app()).get('/api/queues/64b7f0f0f0f0f0f0f0f0f0f0').set(h.authed(a.token))).status).toBe(404);
  });

  test('renames and deactivates a queue; inactive queues refuse new people', async () => {
    const a = await h.registerManager();
    const q = await h.createQueue(a.token);
    const renamed = await request(h.app()).put(`/api/queues/${q.id}`).set(h.authed(a.token)).send({ name: 'Pharmacy' });
    expect(renamed.body.data.queue.name).toBe('Pharmacy');
    await request(h.app()).put(`/api/queues/${q.id}`).set(h.authed(a.token)).send({ status: 'INACTIVE' });
    const add = await h.addPerson(a.token, q.id, 'Late Larry');
    expect(add.status).toBe(409);
    expect(add.body.error.code).toBe('QUEUE_INACTIVE');
  });

  test('cannot delete a queue with active tokens, can once it is clear', async () => {
    const a = await h.registerManager();
    const q = await h.createQueue(a.token);
    const t = (await h.addPerson(a.token, q.id, 'Sam')).body.data.token;
    const blocked = await request(h.app()).delete(`/api/queues/${q.id}`).set(h.authed(a.token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('QUEUE_NOT_EMPTY');
    await request(h.app()).post(`/api/queues/${q.id}/tokens/${t.id}/cancel`).set(h.authed(a.token));
    const ok = await request(h.app()).delete(`/api/queues/${q.id}`).set(h.authed(a.token));
    expect(ok.status).toBe(200);
    expect((await request(h.app()).get(`/api/queues/${q.id}`).set(h.authed(a.token))).status).toBe(404);
  });
});
