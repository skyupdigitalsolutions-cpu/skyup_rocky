import { ROLES } from '../config/rbac.js';

// Gate a route on one or more permissions.
export function requirePermission(...needed) {
  return (req, res, next) => {
    if (!req.permissions) return res.status(401).json({ error: 'Not authenticated' });
    const ok = needed.every((p) => req.permissions.has(p));
    if (!ok) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

// Returns true if the user may access the given clientId.
// Admins => all clients. Members => only clients in assignedClients.
export function canAccessClient(user, clientId) {
  if (!clientId) return true; // "All Clients" aggregate view
  if (user.role === ROLES.ADMIN) return true;
  return (user.assignedClients || []).some((c) => String(c) === String(clientId));
}

// Returns the list of client ids a user is permitted to see (null => all).
export function scopedClientFilter(user) {
  if (user.role === ROLES.ADMIN) return null;
  return { _id: { $in: user.assignedClients || [] } };
}

// Express guard: 403 if the :clientId param is out of scope.
export function requireClientScope(paramName = 'clientId') {
  return (req, res, next) => {
    const clientId = req.params[paramName] || req.body?.clientId || req.query?.clientId;
    if (!canAccessClient(req.user, clientId)) {
      return res.status(403).json({ error: 'Client not in your scope' });
    }
    next();
  };
}
