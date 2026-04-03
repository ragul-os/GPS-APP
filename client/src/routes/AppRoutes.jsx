import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import PrivateRoute from '../components/PrivateRoute';
import Header from '../components/Header';
import LoginPage from '../pages/LoginPage';
import DispatchPage from '../pages/DispatchPage';
import AlertsPage from '../pages/AlertsPage';
import LiveTrackingPage from '../pages/LiveTrackingPage';
import AgentPage from '../pages/AgentPage';

function ProtectedLayout() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/"         element={<Navigate to="/agent" replace />} />
        <Route path="/agent"    element={<AgentPage />} />
        <Route path="/dispatch" element={<DispatchPage />} />
        <Route path="/alerts"   element={<AlertsPage />} />
        <Route path="/live/:id" element={<LiveTrackingPage />} />
        <Route path="*"         element={<Navigate to="/agent" replace />} />
      </Routes>
    </>
  );
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public route — no header, no auth needed */}
          <Route path="/login" element={<LoginPage />} />

          {/* All other routes — protected, show header */}
          <Route
            path="/*"
            element={
              <PrivateRoute>
                <ProtectedLayout />
              </PrivateRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}