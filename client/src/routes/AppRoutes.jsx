import React, { useState, useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { AuthProvider, useAuth } from '../context/AuthContext';
import PrivateRoute, { RoleRoute } from '../components/PrivateRoute';
import { roleHome } from '../config/rbac';
import Header from '../components/Header';
import LoginPage from '../pages/LoginPage';
import DispatchPage from '../pages/DispatchPage';
import AlertsPage from '../pages/AlertsPage';
import LiveTrackingPage from '../pages/LiveTrackingPage';
import AgentPage from '../pages/AgentPage';
import GlobalChatPanel, {
  ChatTriggerButton,
} from '../components/GlobalChatPanel';
import RouteReplayPage from '../pages/RouteReplayPage';
import TimelinePage from '../pages/TimelinePage';


function ProtectedLayout() {
  const { dispatcher } = useAuth();
  const userRole = dispatcher?.role ?? 'dispatcher';
  const isAgent = userRole === 'agent'; // no chat bubble for agents

  const [collapsed, setCollapsed] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  // Extract alertId if on live tracking page
  const liveMatch = location.pathname.match(/^\/live\/([^/]+)/);
  const alertId = liveMatch ? liveMatch[1] : null;

  const [primaryTicketId, setPrimaryTicketId] = useState('');

  useEffect(() => {
    if (alertId) {
      const alertHistory = JSON.parse(
        localStorage.getItem('alertHistory') || '[]',
      );
      const agentTickets = JSON.parse(
        localStorage.getItem('agentTickets') || '[]',
      );
      const ticket = agentTickets.find(
        (t) => t.id === alertId || (t.alertIds || []).includes(alertId),
      );
      if (ticket) {
        setPrimaryTicketId(ticket.id);
      } else {
        const alert = alertHistory.find((a) => a.id === alertId);
        setPrimaryTicketId(alert?.agentTicketId || '');
      }
    } else {
      setPrimaryTicketId('');
    }
  }, [alertId, location.pathname]);

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: '#060910',
      }}
    >
      {/* ── Sidebar (collapsible) ── */}
      <Header
        collapsed={collapsed}
        setCollapsed={setCollapsed}
      />

      {/* ── Main content area ── */}
      <div
        style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
        <Routes>
          {/* Root → role's designated home */}
          <Route
            path='/'
            element={
              <Navigate
                to={roleHome(userRole)}
                replace
              />
            }
          />
          {/* Agent */}
          <Route
            path='/agent'
            element={
              <RoleRoute allowedRoles={['agent', 'admin']}>
                <AgentPage />
              </RoleRoute>
            }
          />
          {/* Dispatch */}
          <Route
            path='/dispatch'
            element={
              <RoleRoute allowedRoles={['dispatcher', 'admin']}>
                <DispatchPage />
              </RoleRoute>
            }
          />
          {/* Monitoring */}
          <Route
            path='/alerts'
            element={
              <RoleRoute allowedRoles={['dispatcher', 'admin']}>
                <AlertsPage />
              </RoleRoute>
            }
          />
          {/* Live tracking & replay — all authenticated roles */}
          <Route
            path='/live/:id'
            element={<LiveTrackingPage />}
          />
          <Route
            path='/replay/:id'
            element={<RouteReplayPage />}
          />
           <Route path="/timeline/:id" element={<TimelinePage />} />
        <Route
            path='/timeline/:id'
            element={<TimelinePage />}
          />
          ;{/* Catch-all */}
          <Route
            path='*'
            element={
              <Navigate
                to={roleHome(userRole)}
                replace
              />
            }
          />
        </Routes>
      </div>

      {/* ── Global Chat Bubble — hidden for agents ── */}
      {!isAgent && (
        <>
          <div
            style={{
              position: 'fixed',
              bottom: 20,
              left: collapsed ? 80 : 236,
              zIndex: 500,
              pointerEvents: 'auto',
              transition: 'left 0.25s ease',
            }}
          >
            <ChatTriggerButton
              open={chatOpen}
              onClick={() => setChatOpen(true)}
              unread={chatUnread}
            />
          </div>
          <GlobalChatPanel
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            onUnreadChange={setChatUnread}
            primaryTicketId={primaryTicketId}
            onTicketClick={(aid) => navigate(`/live/${aid}`)}
          />
        </>
      )}

      <style>{`@keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.6)}}`}</style>
    </div>
  );
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public route — no header, no auth needed */}
          <Route
            path='/login'
            element={<LoginPage />}
          />

          {/* All other routes — protected, show header */}
          <Route
            path='/*'
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
