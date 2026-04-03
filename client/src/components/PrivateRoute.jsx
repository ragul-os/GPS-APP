import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function PrivateRoute({ children }) {
  const { dispatcher } = useAuth();
  const location = useLocation();

  console.log('[PrivateRoute] dispatcher:', dispatcher?.username || 'none', '| path:', location.pathname);

  if (!dispatcher) {
    // Save where they were trying to go, redirect back after login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}