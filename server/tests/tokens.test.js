const request = require('supertest');
const h = require('./helpers');

beforeAll(h.startDb);
afterAll(h.stopDb);
beforeEach(h.clearDb);

const api = (token) => ({
  state: (qid) => request(h.app()).get(`/api/queues/${qid}/tokens`).set(h.authed(token)),
  serve: (qid) => request(h.app()).post(`/api/queues/${qid}/serve-next`).set(h.authed(token)),
  complete: (qid, tid) => request(h.app()).post(`/api/queues/${qid}/tokens/${tid}/complete`).set(h.authed(token)),
  cancel: (qid, tid) => request(h.app()).post(`/api/queues/${qid}/tokens/${tid}/cancel`).set(h.authed(token)),
  move: (qid, tokenId, direction) => request(h.app()).patch(`/api/queues/${qid}/tokens/reorder`).set(h.authed(token)).send({ tokenId, direction }),
});

async function setup(names = ['Ann', 'Ben', 'Cy']) {
  const m = await h.registerManager();
  const q = await h.createQueue(m.token);
  const tokens = [];
  for (const n of names) tokens.push((await h.addPerson(m.token, q.id, n)).body.data.token);
  return { m, q, tokens, a: api(m.token) };
}
const order = (res) => res.body.data.waiting.map((t) => t.personName);
const positions = (res) => res.body.data.waiting.map((t) => t.position);

describe('Adding people', () => {
  test('creates sequential tokens Q001.. with WAITING status and contiguous positions', async () => {
    const { tokens, a, q } = await setup();
    expect(tokens.map((t) => t.tokenNumber)).toEqual(['Q001', 'Q002', 'Q003']);
    expect(tokens.every((t) => t.status === 'WAITING')).toBe(true);
    expect(positions(await a.state(q.id))).toEqual([1, 2, 3]);
  });

  test('rejects an empty or too-long name', async () => {
    const { m, q } = await setup([]);
    expect((await h.addPerson(m.token, q.id, '   ')).status).toBe(400);
    expect((await h.addPerson(m.token, q.id, 'x'.repeat(61))).status).toBe(400);
    expect((await request(h.app()).post(`/api/queues/${q.id}/tokens`).set(h.authed(m.token)).send({})).status).toBe(400);
  });

  test('20 concurrent additions produce unique token numbers and positions 1..20', async () => {
    const { m, q, a } = await setup([]);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => h.addPerson(m.token, q.id, `P${i}`)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const nums = results.map((r) => r.body.data.token.tokenNumber);
    expect(new Set(nums).size).toBe(20);
    expect(positions(await a.state(q.id))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  test('a repeated request with the same requestId does not create a duplicate token', async () => {
    const { m, q, a } = await setup([]);
    const send = () => request(h.app()).post(`/api/queues/${q.id}/tokens`).set(h.authed(m.token)).send({ personName: 'Dup', requestId: 'req-1' });
    const [r1, r2] = await Promise.all([send(), send()]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect((await a.state(q.id)).body.data.counts.total).toBe(1);
  });

  test('token numbers are never reused after cancellation', async () => {
    const { m, q, tokens, a } = await setup(['Ann', 'Ben']);
    await a.cancel(q.id, tokens[1].id);
    const next = (await h.addPerson(m.token, q.id, 'Cy')).body.data.token;
    expect(next.tokenNumber).toBe('Q003');
  });
});

describe('Reordering', () => {
  test('moves a token up and down and persists the order', async () => {
    const { q, tokens, a } = await setup();
    await a.move(q.id, tokens[2].id, 'up');
    expect(order(await a.state(q.id))).toEqual(['Ann', 'Cy', 'Ben']);
    await a.move(q.id, tokens[0].id, 'down');
    const res = await a.state(q.id);
    expect(order(res)).toEqual(['Cy', 'Ann', 'Ben']);
    expect(positions(res)).toEqual([1, 2, 3]);
  });

  test('blocks moving the first token up and the last token down', async () => {
    const { q, tokens, a } = await setup();
    const up = await a.move(q.id, tokens[0].id, 'up');
    const down = await a.move(q.id, tokens[2].id, 'down');
    expect(up.status).toBe(409);
    expect(down.status).toBe(409);
    expect(up.body.error.code).toBe('MOVE_OUT_OF_BOUNDS');
  });

  test('cannot move serving, completed or cancelled tokens', async () => {
    const { q, tokens, a } = await setup();
    await a.serve(q.id); // Ann is serving
    expect((await a.move(q.id, tokens[0].id, 'down')).status).toBe(409);
    await a.complete(q.id, tokens[0].id);
    expect((await a.move(q.id, tokens[0].id, 'down')).status).toBe(409);
    await a.cancel(q.id, tokens[2].id);
    expect((await a.move(q.id, tokens[2].id, 'up')).status).toBe(409);
  });

  test('rejects a stale queue version', async () => {
    const { q, tokens, m } = await setup();
    const res = await request(h.app()).patch(`/api/queues/${q.id}/tokens/reorder`).set(h.authed(m.token)).send({ tokenId: tokens[1].id, direction: 'up', version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_QUEUE');
  });

  test('concurrent reorders keep positions contiguous and unique', async () => {
    const { q, tokens, a } = await setup(['A', 'B', 'C', 'D', 'E']);
    await Promise.all([a.move(q.id, tokens[4].id, 'up'), a.move(q.id, tokens[3].id, 'up'), a.move(q.id, tokens[0].id, 'down'), a.move(q.id, tokens[2].id, 'up')]);
    const res = await a.state(q.id);
    expect(positions(res)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(order(res)).size).toBe(5);
  });
});

describe('Serving', () => {
  test('call next serves the first waiting token and shifts the rest up', async () => {
    const { q, a } = await setup();
    const res = await a.serve(q.id);
    expect(res.status).toBe(200);
    expect(res.body.data.token).toMatchObject({ personName: 'Ann', status: 'SERVING', position: null });
    expect(res.body.data.token.servingAt).toBeTruthy();
    const s = await a.state(q.id);
    expect(order(s)).toEqual(['Ben', 'Cy']);
    expect(positions(s)).toEqual([1, 2]);
    expect(s.body.data.serving.personName).toBe('Ann');
  });

  test('cannot call next while someone is being served', async () => {
    const { q, a } = await setup();
    await a.serve(q.id);
    const res = await a.serve(q.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_SERVING');
  });

  test('two simultaneous call-next requests serve exactly one token', async () => {
    const { q, a } = await setup();
    const [r1, r2] = await Promise.all([a.serve(q.id), a.serve(q.id)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const s = await a.state(q.id);
    expect(s.body.data.counts.serving).toBe(1);
    expect(s.body.data.waiting).toHaveLength(2);
  });

  test('calling next on an empty queue returns QUEUE_EMPTY', async () => {
    const { q, a } = await setup([]);
    const res = await a.serve(q.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_EMPTY');
  });

  test('completing records completedAt and lets the next token be served', async () => {
    const { q, tokens, a } = await setup();
    await a.serve(q.id);
    const done = await a.complete(q.id, tokens[0].id);
    expect(done.status).toBe(200);
    expect(done.body.data.token.status).toBe('COMPLETED');
    expect(done.body.data.token.completedAt).toBeTruthy();
    expect(done.body.data.token.serviceTimeMs).toBeGreaterThanOrEqual(0);
    expect((await a.serve(q.id)).body.data.token.personName).toBe('Ben');
  });

  test('cannot complete a waiting token or complete twice', async () => {
    const { q, tokens, a } = await setup();
    expect((await a.complete(q.id, tokens[1].id)).status).toBe(409);
    await a.serve(q.id);
    await a.complete(q.id, tokens[0].id);
    expect((await a.complete(q.id, tokens[0].id)).status).toBe(409);
  });
});

describe('Cancelling', () => {
  test('cancels a waiting token and closes the gap', async () => {
    const { q, tokens, a } = await setup();
    const res = await a.cancel(q.id, tokens[1].id);
    expect(res.status).toBe(200);
    expect(res.body.data.token).toMatchObject({ status: 'CANCELLED', position: null });
    expect(res.body.data.token.cancelledAt).toBeTruthy();
    const s = await a.state(q.id);
    expect(order(s)).toEqual(['Ann', 'Cy']);
    expect(positions(s)).toEqual([1, 2]);
  });

  test('cannot cancel completed, already-cancelled or serving tokens', async () => {
    const { q, tokens, a } = await setup();
    await a.serve(q.id);
    const serving = await a.cancel(q.id, tokens[0].id);
    expect(serving.status).toBe(409);
    expect(serving.body.error.code).toBe('CANNOT_CANCEL_SERVING');
    await a.complete(q.id, tokens[0].id);
    expect((await a.cancel(q.id, tokens[0].id)).status).toBe(409);
    await a.cancel(q.id, tokens[1].id);
    expect((await a.cancel(q.id, tokens[1].id)).status).toBe(409);
  });

  test('unknown token id returns 404, malformed id returns 400', async () => {
    const { q, a } = await setup();
    expect((await a.cancel(q.id, '64b7f0f0f0f0f0f0f0f0f0f0')).status).toBe(404);
    expect((await a.cancel(q.id, 'xyz')).status).toBe(400);
  });
});
