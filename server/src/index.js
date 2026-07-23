import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { logger } from './lib/logger.js';
import { notFound, errorHandler } from './middleware/error.js';
import { startSchedulers } from './jobs/queue.js';
import { usingMockLLM } from './llm/provider.js';
import { usingMockEmbeddings } from './llm/embeddings.js';

import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import clientsRoutes from './routes/clients.routes.js';
import documentsRoutes from './routes/documents.routes.js';
import integrationsRoutes from './routes/integrations.routes.js';
import chatRoutes from './routes/chat.routes.js';
import briefsRoutes from './routes/briefs.routes.js';
import insightsRoutes from './routes/insights.routes.js';
import reelsRoutes from './routes/reels.routes.js';
import voiceRoutes from './routes/voice.routes.js';
import metricsRoutes from './routes/metrics.routes.js';
import adsRoutes from './routes/ads.routes.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/api/health', (req, res) =>
  res.json({
    ok: true,
    service: 'rocky',
    time: new Date().toISOString(),
    llm: env.LLM_PROVIDER,
    mockLLM: usingMockLLM(),
    mockEmbeddings: usingMockEmbeddings(),
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/briefs', briefsRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/reels', reelsRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/ads', adsRoutes);

app.use(notFound);
app.use(errorHandler);

async function start() {
  await connectDb();
  startSchedulers();
  app.listen(env.PORT, () => {
    logger.info(`[rocky] server on :${env.PORT} (env=${env.NODE_ENV}, llm=${env.LLM_PROVIDER})`);
    if (usingMockLLM()) logger.warn('[rocky] running with MOCK LLM — set LLM_PROVIDER + API key for full analysis');
  });
}

start().catch((err) => {
  logger.error({ err }, '[rocky] failed to start');
  process.exit(1);
});