import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { generateMorningBrief } from './morningBrief.js';
import { syncAllMetrics } from './syncMetrics.js';
import { processDuePosts } from './reelsScheduler.js';
import { startFolderWatcher } from './folderWatcher.js';

// Lightweight in-process scheduler. For higher scale, swap this module for a
// BullMQ/Redis-backed queue without changing the job implementations.
export function startSchedulers() {
  if (cron.validate(env.MORNING_BRIEF_CRON)) {
    cron.schedule(
      env.MORNING_BRIEF_CRON,
      async () => {
        logger.info('[cron] running morning brief');
        try {
          await generateMorningBrief();
        } catch (err) {
          logger.error({ err }, '[cron] morning brief failed');
        }
      },
      { timezone: env.BRIEF_TIMEZONE }
    );
    logger.info(`[cron] morning brief scheduled: ${env.MORNING_BRIEF_CRON} ${env.BRIEF_TIMEZONE}`);
  }

  if (cron.validate(env.METRIC_SYNC_CRON)) {
    cron.schedule(env.METRIC_SYNC_CRON, async () => {
      logger.info('[cron] running metric sync');
      try {
        await syncAllMetrics();
      } catch (err) {
        logger.error({ err }, '[cron] metric sync failed');
      }
    });
    logger.info(`[cron] metric sync scheduled: ${env.METRIC_SYNC_CRON}`);
  }

  // Reels scheduler — polls Mongo for due posts and publishes them. Guarded so
  // overlapping ticks can't run concurrently on a slow publish.
  if (cron.validate(env.REELS_SCHEDULER_CRON)) {
    let running = false;
    cron.schedule(env.REELS_SCHEDULER_CRON, async () => {
      if (running) return;
      running = true;
      try {
        await processDuePosts();
      } catch (err) {
        logger.error({ err }, '[cron] reels scheduler failed');
      } finally {
        running = false;
      }
    });
    logger.info(`[cron] reels scheduler running: ${env.REELS_SCHEDULER_CRON}${env.PUBLISH_DRY_RUN ? ' (DRY_RUN)' : ''}`);
  }

  // Watch-folder automation: drop named videos in a local folder and Rocky
  // uploads + schedules them automatically.
  startFolderWatcher();
}