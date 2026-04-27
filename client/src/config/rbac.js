/**
 * rbac.js — Centralized Role-Based Access Control configuration.
 *
 * This is the SINGLE SOURCE OF TRUTH for all role permissions.
 * Add new roles or adjust access here; every other file reads from this.
 *
 * Roles (backend-assigned from public.ems_users):
 *   agent      → field responders
 *   dispatcher → dispatch operators + monitoring access
 *   admin      → full access to all modules
 */

// ── Default landing page per role after login ────────────────────────────────
export const ROLE_HOME = {
  agent: '/agent',
  dispatcher: '/dispatch',
  admin: '/agent',
};

// ── Nav tabs visible per role ─────────────────────────────────────────────────
// Values match the keys used in Header.jsx tab rendering
export const ROLE_TABS = {
  agent: ['agent'],
  dispatcher: ['dispatch', 'alerts'],
  admin: ['agent', 'dispatch', 'alerts'],
};

// ── Routes each role may access ───────────────────────────────────────────────
// Key = route prefix.  admin always bypasses (handled in RoleRoute).
export const ROUTE_ROLES = {
  '/agent': ['agent', 'admin'],
  '/dispatch': ['dispatcher', 'admin'],
  '/alerts': ['dispatcher', 'admin'],
  '/live': ['agent', 'dispatcher', 'admin'],
  '/replay': ['agent', 'dispatcher', 'admin'],
};

// ── Display labels shown in the header role badge ────────────────────────────
export const ROLE_LABEL = {
  agent: 'Agent',
  dispatcher: 'Dispatcher',
  admin: 'Admin',
};

// ── Helper: return home path for a role ──────────────────────────────────────
export function roleHome(role) {
  return ROLE_HOME[role] ?? '/agent';
}
