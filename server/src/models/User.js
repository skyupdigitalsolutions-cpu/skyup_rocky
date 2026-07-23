import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from '../config/rbac.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.MEMBER },
    // Client-level authorization: members only see clients in this list.
    // Admins ignore this list (full access). Empty + admin => all clients.
    assignedClients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Client' }],
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const { _id, name, email, role, assignedClients, isActive, lastLoginAt, createdAt } = this;
  return { id: _id, name, email, role, assignedClients, isActive, lastLoginAt, createdAt };
};

export const User = mongoose.model('User', userSchema);
