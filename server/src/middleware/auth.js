import { verifyToken, COOKIE_NAME } from '../lib/jwt.js';
import { User } from '../models/User.js';
import { permissionsForRole } from '../config/rbac.js';

// Requires a valid session. Attaches req.user (lean-ish) + req.permissions.
export async function requireAuth(req, res, next) {
  try {
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    const token = req.cookies?.[COOKIE_NAME] || bearer;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) return res.status(401).json({ error: 'Session invalid' });

    req.user = user;
    req.permissions = new Set(permissionsForRole(user.role));
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }
}
