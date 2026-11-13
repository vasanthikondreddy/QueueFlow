const request = require('supertest');
const h = require('./helpers');

beforeAll(h.startDb);
afterAll(h.stopDb);
beforeEach(h.clearDb);

describe('Authentication', () => {
  test('registers a manager and never returns the password', async () => {
    const res = await request(h.app()).post('/api/auth/register').send({ name: 'Asha', email: 'Asha@Example.com', password: 'Passw0rdOK' });
    expect(res.status).toBe(201);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe('asha@example.com');
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  test('stores a bcrypt hash, not the plain password', async () => {
    await h.registerManager({ email: 'hash@example.com' });
    const user = await require('../src/models/User').findOne({ email: 'hash@example.com' }).select('+password');
    expect(user.password).not.toBe('Passw0rdOK');
    expect(user.password).toMatch(/^\$2[aby]\$/);
  });

  test('rejects duplicate registration with 409', async () => {
    const { body } = await h.registerManager({ email: 'dup@example.com' });
    const res = await request(h.app()).post('/api/auth/register').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  test('rejects weak passwords and invalid email', async () => {
    const weak = await request(h.app()).post('/api/auth/register').send({ name: 'Bob', email: 'bob@example.com', password: 'short' });
    expect(weak.status).toBe(400);
    const bad = await request(h.app()).post('/api/auth/register').send({ name: 'Bob', email: 'nope', password: 'Passw0rdOK' });
    expect(bad.status).toBe(400);
  });

  test('logs in with correct credentials', async () => {
    const { body } = await h.registerManager();
    const res = await request(h.app()).post('/api/auth/login').send({ email: body.email, password: body.password });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
  });

  test('rejects an invalid password and an unknown email with the same message', async () => {
    const { body } = await h.registerManager();
    const wrong = await request(h.app()).post('/api/auth/login').send({ email: body.email, password: 'WrongPass1' });
    const unknown = await request(h.app()).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'WrongPass1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  test('blocks protected routes without a token, with a bad token and with an expired token', async () => {
    expect((await request(h.app()).get('/api/queues')).status).toBe(401);
    expect((await request(h.app()).get('/api/queues').set('Authorization', 'Bearer garbage')).status).toBe(401);
    const { user } = await h.registerManager();
    const res = await request(h.app()).get('/api/auth/me').set(h.authed(h.expiredToken(user.id)));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  test('GET /auth/me returns the current user', async () => {
    const { token, user } = await h.registerManager();
    const res = await request(h.app()).get('/api/auth/me').set(h.authed(token));
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
  });

  test('ignores NoSQL operator injection in login', async () => {
    await h.registerManager();
    const res = await request(h.app()).post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } });
    expect(res.status).toBe(400);
  });
});
