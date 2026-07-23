import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

export const COOKIE_NAME = 'rocky_session';

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    maxAge: 1000 * 60 * 60 * 12, // 12h
    path: '/',
  };
}
