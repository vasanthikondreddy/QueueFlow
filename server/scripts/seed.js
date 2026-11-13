/* Demo data: node scripts/seed.js  ->  login demo@queueflow.dev / Demo1234 */
const mongoose = require('mongoose');
const { env, assertEnv } = require('../src/config/env');
const User = require('../src/models/User');
const Queue = require('../src/models/Queue');
const Token = require('../src/models/Token');
const QueueEvent = require('../src/models/QueueEvent');

const NAMES = ['Aarav', 'Diya', 'Kavya', 'Rohan', 'Ishita', 'Vikram', 'Meera', 'Arjun', 'Sneha', 'Karthik', 'Lakshmi', 'Nikhil', 'Pooja', 'Rahul', 'Ananya', 'Suresh'];
const rnd = (a, b) => a + Math.random() * (b - a);
const MIN = 60000;

async function main() {
  assertEnv();
  await mongoose.connect(env.mongoUri);
  await Promise.all([User, Queue, Token, QueueEvent].map((m) => m.init()));
  await User.deleteOne({ email: 'demo@queueflow.dev' });
  const user = await User.create({ name: 'Demo Manager', email: 'demo@queueflow.dev', password: 'Demo1234' });
  const defs = [['Front Desk', 1], ['Pharmacy Counter', 1.5], ['Billing', 0.7]];
  const now = Date.now();

  for (const [name, load] of defs) {
    const queue = await Queue.create({ name, managerId: user._id });
    const tokens = [];
    let seq = 0;
    for (let d = 14; d >= 0; d--) {
      const dayStart = new Date(now - d * 86400000);
      dayStart.setHours(9, 0, 0, 0);
      const n = Math.round(rnd(8, 18) * load);
      for (let i = 0; i < n; i++) {
        const createdAt = new Date(dayStart.getTime() + rnd(0, 8 * 60) * MIN);
        if (createdAt.getTime() > now - 45 * MIN) continue;
        seq += 1;
        const t = { queueId: queue._id, managerId: user._id, seq, tokenNumber: `Q${String(seq).padStart(3, '0')}`, personName: NAMES[seq % NAMES.length], createdAt };
        if (Math.random() < 0.12) Object.assign(t, { status: 'CANCELLED', cancelledAt: new Date(createdAt.getTime() + rnd(2, 15) * MIN) });
        else {
          const servingAt = new Date(createdAt.getTime() + rnd(3, 28) * MIN * (d === 0 ? 1 : 1 + Math.sin(d) * 0.3));
          Object.assign(t, { status: 'COMPLETED', servingAt, completedAt: new Date(servingAt.getTime() + rnd(3, 12) * MIN) });
        }
        tokens.push(t);
      }
    }
    // a few people waiting right now
    for (let i = 0; i < 4; i++) {
      seq += 1;
      tokens.push({ queueId: queue._id, managerId: user._id, seq, tokenNumber: `Q${String(seq).padStart(3, '0')}`, personName: NAMES[(seq + 3) % NAMES.length], status: 'WAITING', position: i + 1, createdAt: new Date(now - (30 - i * 7) * MIN) });
    }
    await Token.insertMany(tokens);
    await Queue.updateOne({ _id: queue._id }, { $set: { nextTokenNumber: seq + 1 } });

    const raw = [];
    tokens.forEach((t) => {
      raw.push({ at: t.createdAt, type: 'TOKEN_ADDED', d: 1 });
      if (t.servingAt) raw.push({ at: t.servingAt, type: 'TOKEN_SERVING', d: -1 });
      if (t.completedAt) raw.push({ at: t.completedAt, type: 'TOKEN_COMPLETED', d: 0 });
      if (t.cancelledAt) raw.push({ at: t.cancelledAt, type: 'TOKEN_CANCELLED', d: -1 });
    });
    raw.sort((a, b) => a.at - b.at);
    let waiting = 0;
    await QueueEvent.insertMany(raw.map((e) => ({ queueId: queue._id, managerId: user._id, eventType: e.type, waitingCount: (waiting = Math.max(0, waiting + e.d)), timestamp: e.at })));
  }
  console.log('Seeded. Login: demo@queueflow.dev / Demo1234');
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
