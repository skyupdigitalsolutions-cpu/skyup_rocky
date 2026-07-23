import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../models/User.js';
import { signToken, COOKIE_NAME, cookieOptions } from '../lib/jwt.js';
import { permissionsForRole } from '../config/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    if (!user || !user.isActive) throw new HttpError(401, 'Invalid email or password');

    const ok = await user.verifyPassword(password);
    if (!ok) throw new HttpError(401, 'Invalid email or password');

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken({ sub: String(user._id), role: user.role });
    res.cookie(COOKIE_NAME, token, cookieOptions());
    await audit(req, 'auth.login', { targetType: 'user', targetId: user._id });

    res.json({
      token, // also returned for non-cookie clients
      user: user.toSafeJSON(),
      permissions: permissionsForRole(user.role),
    });
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      user: req.user.toSafeJSON(),
      permissions: [...req.permissions],
    });
  })
);

export default router;
