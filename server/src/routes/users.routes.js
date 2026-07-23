import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { ROLES, ROLE_PERMISSIONS } from '../config/rbac.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { audit } from '../middleware/audit.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/roles',
  asyncHandler(async (req, res) => {
    res.json({ roles: Object.values(ROLES), rolePermissions: ROLE_PERMISSIONS });
  })
);

router.get(
  '/',
  requirePermission(PERMISSIONS.USER_MANAGE),
  asyncHandler(async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ users: users.map((u) => u.toSafeJSON()) });
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum([ROLES.ADMIN, ROLES.MEMBER]).default(ROLES.MEMBER),
  assignedClients: z.array(z.string()).default([]),
});

router.post(
  '/',
  requirePermission(PERMISSIONS.USER_MANAGE),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const exists = await User.findOne({ email: body.email.toLowerCase() });
    if (exists) throw new HttpError(409, 'A user with that email already exists');
    const user = new User({ name: body.name, email: body.email, role: body.role, assignedClients: body.assignedClients });
    await user.setPassword(body.password);
    await user.save();
    await audit(req, 'user.create', { targetType: 'user', targetId: user._id, meta: { role: user.role } });
    res.status(201).json({ user: user.toSafeJSON() });
  })
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum([ROLES.ADMIN, ROLES.MEMBER]).optional(),
  assignedClients: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.USER_MANAGE),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const user = await User.findById(req.params.id).select('+passwordHash');
    if (!user) throw new HttpError(404, 'User not found');
    if (body.name != null) user.name = body.name;
    if (body.role != null) user.role = body.role;
    if (body.assignedClients != null) user.assignedClients = body.assignedClients;
    if (body.isActive != null) user.isActive = body.isActive;
    if (body.password) await user.setPassword(body.password);
    await user.save();
    await audit(req, 'user.update', { targetType: 'user', targetId: user._id });
    res.json({ user: user.toSafeJSON() });
  })
);

export default router;
