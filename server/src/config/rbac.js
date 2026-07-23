// Deterministic permission catalogue. Per PRD Section 9, authorization is
// handled in application logic, never delegated to the LLM.

export const PERMISSIONS = {
  CLIENT_READ: 'client:read',
  CLIENT_WRITE: 'client:write',
  DOCUMENT_READ: 'document:read',
  DOCUMENT_WRITE: 'document:write',
  INTEGRATION_READ: 'integration:read',
  INTEGRATION_WRITE: 'integration:write',
  CHAT_USE: 'chat:use',
  BRIEF_READ: 'brief:read',
  REELS_READ: 'reels:read',
  REELS_WRITE: 'reels:write',
  USER_MANAGE: 'user:manage',
  ADS_MANAGE: 'ads:manage',
  SETTINGS_MANAGE: 'settings:manage',
  AUDIT_READ: 'audit:read',
};

export const ROLES = {
  ADMIN: 'admin',
  MEMBER: 'member',
};

// Admin/Owner => everything. Team Member => read + chat, scoped to assigned clients.
export const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: Object.values(PERMISSIONS),
  [ROLES.MEMBER]: [
    PERMISSIONS.CLIENT_READ,
    PERMISSIONS.DOCUMENT_READ,
    PERMISSIONS.INTEGRATION_READ,
    PERMISSIONS.CHAT_USE,
    PERMISSIONS.BRIEF_READ,
    PERMISSIONS.REELS_READ,
  ],
};

export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}