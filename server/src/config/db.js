const mongoose = require('mongoose');
const { env } = require('./env');

mongoose.set('strictQuery', true);

async function connectDb(uri = env.mongoUri) {
  mongoose.connection.on('disconnected', () => console.error('[db] MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  console.log('[db] MongoDB connected');
}

module.exports = { connectDb };
