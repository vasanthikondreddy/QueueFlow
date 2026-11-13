const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const jwt = require('jsonwebtoken');

let mongod;

async function startDb() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const models = ['User', 'Queue', 'Token', 'QueueEvent'].map((m) => require(`../src/models/${m}`));
  await Promise.all(models.map((m) => m.init())); // build unique + partial indexes
}
async function stopDb() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}
async function clearDb() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
}

const app = () => require('../src/app');
let counter = 0;
async function registerManager(overrides = {}) {
  counter += 1;
  const body = { name: 'Test Manager', email: `manager${counter}-${Date.now()}@example.com`, password: 'Passw0rdOK', ...overrides };
  const res = await request(app()).post('/api/auth/register').send(body);
  return { token: res.body.data.token, user: res.body.data.user, body };
}
const authed = (token) => ({ Authorization: `Bearer ${token}` });
async function createQueue(token, name = 'Front Desk') {
  const res = await request(app()).post('/api/queues').set(authed(token)).send({ name });
  return res.body.data.queue;
}
async function addPerson(token, queueId, personName) {
  return request(app()).post(`/api/queues/${queueId}/tokens`).set(authed(token)).send({ personName });
}
const expiredToken = (userId) => jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: -10 });

module.exports = { startDb, stopDb, clearDb, app, registerManager, authed, createQueue, addPerson, expiredToken };
