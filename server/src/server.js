const http = require('http');
const { env, assertEnv } = require('./config/env');
const { connectDb } = require('./config/db');

async function main() {
  assertEnv();
  const app = require('./app');
  const { initSockets } = require('./sockets');
  // Make sure unique / partial indexes exist before accepting traffic
  await connectDb();
  await Promise.all(['User', 'Queue', 'Token', 'QueueEvent'].map((m) => require(`./models/${m}`).init()));

  const server = http.createServer(app);
  initSockets(server);
  server.listen(env.port, () => console.log(`[server] QueueFlow API listening on :${env.port}`));

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err?.message));
main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
