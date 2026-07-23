import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

mongoose.set('strictQuery', true);

export async function connectDb() {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 30000,
    });
    logger.info(`[db] connected to ${env.MONGODB_DB_NAME}`);
  } catch (err) {
    logger.error({ err }, '[db] connection failed');
    throw err;
  }

  mongoose.connection.on('disconnected', () => logger.warn('[db] disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('[db] reconnected'));
}

export async function disconnectDb() {
  await mongoose.connection.close();
}
