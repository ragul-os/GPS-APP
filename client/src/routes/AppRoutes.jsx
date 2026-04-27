import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import PrivateRoute from '../components/PrivateRoute';
import Header from '../components/Header';
import LoginPage from '../pages/LoginPage';
import DispatchPage from '../pages/DispatchPage';
import AlertsPage from '../pages/AlertsPage';
import LiveTrackingPage from '../pages/LiveTrackingPage';
import AgentPage from '../pages/AgentPage';
import GlobalChatPanel, { ChatTriggerButton } from '../components/GlobalChatPanel';
import RouteReplayPage from '../pages/RouteReplayPage';
import TimelinePage from '../pages/TimelinePage';

function ProtectedLayout() {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  // Extract alertId if on live tracking page
  const liveMatch = location.pathname.match(/^\/live\/([^/]+)/);
  const alertId = liveMatch ? liveMatch[1] : null;

  // Determine primaryTicketId based on the current URL
  const [primaryTicketId, setPrimaryTicketId] = useState('');

  useEffect(() => {
    if (alertId) {
      // Find the primaryTicketId from alertHistory or agentTickets
      const alertHistory = JSON.parse(localStorage.getItem('alertHistory') || '[]');
      const agentTickets = JSON.parse(localStorage.getItem('agentTickets') || '[]');
      
      const ticket = agentTickets.find(t => t.id === alertId || (t.alertIds || []).includes(alertId));
      if (ticket) {
        setPrimaryTicketId(ticket.id);
      } else {
        const alert = alertHistory.find(a => a.id === alertId);
        setPrimaryTicketId(alert?.agentTicketId || '');
      }
    } else {
      setPrimaryTicketId('');
    }
  }, [alertId, location.pathname]);

  return (
    <>
      <Header />
      <Routes>
        <Route path="/"         element={<Navigate to="/agent" replace />} />
        <Route path="/agent"    element={<AgentPage />} />
        <Route path="/dispatch" element={<DispatchPage />} />
        <Route path="/alerts"   element={<AlertsPage />} />
        <Route path="/live/:id" element={<LiveTrackingPage />} />
         <Route path="/replay/:id" element={<RouteReplayPage />} />
         <Route path="/timeline/:id" element={<TimelinePage />} />
        <Route path="*"         element={<Navigate to="/agent" replace />} />
      </Routes>

      {/* ── Global Chat Bubble (Bottom Left) ── */}
      <div style={{ position: 'fixed', bottom: 20, left: 16, zIndex: 500, pointerEvents: 'auto' }}>
        <ChatTriggerButton open={chatOpen} onClick={() => setChatOpen(true)} unread={chatUnread} />
      </div>

      <GlobalChatPanel 
        open={chatOpen} 
        onClose={() => setChatOpen(false)} 
        onUnreadChange={setChatUnread} 
        primaryTicketId={primaryTicketId}
        onTicketClick={(aid) => navigate(`/live/${aid}`)}
      />

      <style>{`@keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.6)}}`}</style>
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