import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROUTE_ROLES, roleHome } from '../config/rbac';

/**
 * PrivateRoute — authentication guard.
 * Wraps the entire ProtectedLayout.  If the user is not logged in at all,
 * redirect to /login.  Role-level access is handled by RoleRoute below.
 */
export default function PrivateRoute({ children }) {
  const { dispatcher } = useAuth();
  const location = useLocation();

  if (!dispatcher) {
    return (
      <Navigate
        to='/login'
        state={{ from: location }}
        replace
      />
    );
  }

  return children;
}

/**
 * RoleRoute — authorisation guard.
 * Checks whether the logged-in user's role is in the allowedRoles list.
 * Admin always bypasses the check.
 * Unauthorized users are redirected to their own role's home page.
 *
 * Usage:
 *   <RoleRoute path='/dispatch'>
 *     <DispatchPage />
 *   </RoleRoute>
 *
 * Provide either `allowedRoles` explicitly, or let it auto-resolve from
 * ROUTE_ROLES using the current pathname.
 */
export function RoleRoute({ children, allowedRoles }) {
  const { dispatcher } = useAuth();
  const location = useLocation();

  // Not logged in → back to login (belt-and-suspenders)
  if (!dispatcher) {
    return (
      <Navigate
        to='/login'
        state={{ from: location }}
        replace
      />
    );
  }

  const role = dispatcher.role ?? 'dispatcher';

  // Admin sees everything — no further checks needed
  if (role === 'admin') return children;

  // Resolve allowed roles from explicit prop OR from ROUTE_ROLES config
  const allowed =
    allowedRoles ??
    Object.entries(ROUTE_ROLES).find(([prefix]) =>
      location.pathname.startsWith(prefix),
    )?.[1] ??
    [];

  if (!allowed.includes(role)) {
    // Redirect to their own home page gracefully
    return (
      <Navigate
        to={roleHome(role)}
        replace
      />
    );
  }

  return children;
}

// Re-export roleHome so callers don't need a second import
export { roleHome };
