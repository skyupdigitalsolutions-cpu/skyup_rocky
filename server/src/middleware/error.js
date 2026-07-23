import { logger } from '../lib/logger.js';
import { isProd } from '../config/env.js';

// Wrap async route handlers so thrown errors reach the error middleware.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) logger.error({ err }, '[error] unhandled');
  res.status(status).json({
    error: err.publicMessage || err.message || 'Internal server error',
    ...(isProd ? {} : { stack: err.stack }),
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}
