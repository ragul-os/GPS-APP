import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getStatus } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { 
  LogoutOutlined, 
  UserOutlined, 
  FileTextOutlined, 
  BarChartOutlined, 
  AlertOutlined,
  CheckCircleFilled,
  ExclamationCircleFilled
} from '@ant-design/icons';

const styles = {
  header: {
    background: '#161B22', 
    borderBottom: '1px solid #30363D',
    padding: '14px 28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: 0,
    zIndex: 50,
  },
  logo: { fontSize: 20, fontWeight: 800, fontFamily: 'Sora, sans-serif' },
  right: { display: 'flex', alignItems: 'center', gap: 12 },
  unitsBadge: {
    background: 'rgba(26,115,232,.18)', color: '#82B4FF',
    fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 20,
  },
  pill: (connected) => ({
    padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: 6,
    background: connected ? 'rgba(52,168,83,.2)' : 'rgba(229,57,53,.2)',
    color: connected ? '#34A853' : '#E53935',
  }),
  logoutBtn: {
    padding: '6px 12px', borderRadius: 8, background: 'rgba(229,57,53,.1)',
    border: '1px solid rgba(229,57,53,.2)', color: '#E53935',
    fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex',
    alignItems: 'center', gap: 6, transition: 'all .2s',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #30363D',
    padding: '0 28px',
    background: '#161B22',
  },
  tab: (active) => ({
    padding: '13px 22px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    color: active ? '#1A73E8' : '#8B949E',
    borderBottom: active ? '3px solid #1A73E8' : '3px solid transparent',
    transition: 'all .2s', display: 'flex', alignItems: 'center', gap: 8,
    background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
    fontFamily: 'Sora, sans-serif', outline: 'none',
  }),
  badge: {
    background: 'rgba(229,57,53,.2)', color: '#FF8A80',
    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
  },
  badgeWarning: {
    background: 'rgba(249,168,37,.2)', color: '#F9A825',
    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
  },
};

export default function Header() {
  const [connected,     setConnected]     = useState(false);
  const [alertCount,    setAlertCount]    = useState(0);
  const [pendingCount,  setPendingCount]  = useState(0);
  const { logout } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  useEffect(() => {
    const check = async () => {
      try {
        await getStatus();
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    check();
    const iv = setInterval(check, 60000); // 60s
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const sync = () => {
      const stored = JSON.parse(localStorage.getItem('alertHistory') || '[]');
      setAlertCount(stored.length);
    };
    sync();
    window.addEventListener('alertHistoryChange', sync);
    return () => window.removeEventListener('alertHistoryChange', sync);
  }, []);

  useEffect(() => {
    const sync = () => {
      const tickets = JSON.parse(localStorage.getItem('agentTickets') || '[]');
      setPendingCount(tickets.filter(t => t.status === 'pending').length);
    };
    sync();
    window.addEventListener('agentTicketsChange', sync);
    return () => window.removeEventListener('agentTicketsChange', sync);
  }, []);

  const handleLogout = () => {
    localStorage.clear();
    logout();
    navigate('/login');
  };

  const isDispatch = location.pathname.startsWith('/dispatch');
  const isAlerts   = location.pathname.startsWith('/alerts');
  const isAgent    = location.pathname.startsWith('/agent');

  return (
    <>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      <header style={styles.header}>
        <div style={{ ...styles.logo, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertOutlined style={{ color: "#E53935", fontSize: '20px', verticalAlign: 'middle' }} /> 
          <span>Emergency Control System</span>
        </div>
        <div style={styles.right}>
          <div style={styles.unitsBadge} id="hdr-units">0 units online</div>
          <div style={styles.pill(connected)}>
            {connected ? (
              <CheckCircleFilled style={{ color: '#52c41a', fontSize: '16px', verticalAlign: 'middle' }} />
            ) : (
              <ExclamationCircleFilled style={{ color: '#ff4d4f', fontSize: '16px', verticalAlign: 'middle', animation: 'pulse 1.2s infinite' }} />
            )}
            <span>{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <button 
            style={styles.logoutBtn} 
            onClick={handleLogout}
          >
            <LogoutOutlined style={{ fontSize: '20px', verticalAlign: 'middle' }} /> Logout
          </button>
        </div>
      </header>
      <nav style={styles.tabs}>
        <button
          style={styles.tab(isAgent)}
          onClick={() => navigate('/agent')}
        >
          <UserOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} /> Agent
        </button>

        <button
          style={styles.tab(isDispatch)}
          onClick={() => navigate('/dispatch')}
        >
          <FileTextOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} /> Dispatch
          {pendingCount > 0 && (
            <span style={styles.badgeWarning}>{pendingCount} new</span>
          )}
        </button>

        <button
          style={styles.tab(isAlerts)}
          onClick={() => navigate('/alerts')}
        >
          <BarChartOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} /> Monitoring
          <span style={styles.badge}>{alertCount}</span>
        </button>
      </nav>
    </>
  );
}
