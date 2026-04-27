import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getStatus } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { ROLE_TABS, ROLE_LABEL } from '../config/rbac';
import {
  LogoutOutlined,
  UserOutlined,
  FileTextOutlined,
  BarChartOutlined,
  AlertOutlined,
  RightOutlined,
  LeftOutlined,
} from '@ant-design/icons';

// ── Static nav item registry ─────────────────────────────────────────────────
const NAV_ITEMS = [
  { key: 'agent', label: 'Agent', Icon: UserOutlined, path: '/agent' },
  {
    key: 'dispatch',
    label: 'Dispatch',
    Icon: FileTextOutlined,
    path: '/dispatch',
  },
  {
    key: 'alerts',
    label: 'Monitoring',
    Icon: BarChartOutlined,
    path: '/alerts',
  },
];

const COLLAPSED_W = 64;
const EXPANDED_W = 220;

export default function Header({ collapsed, setCollapsed }) {
  const [connected, setConnected] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const { logout, dispatcher } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const role = dispatcher?.role ?? 'dispatcher';
  const username = dispatcher?.username ?? 'User';
  const canSee = ROLE_TABS[role] ?? [];
  const visible = NAV_ITEMS.filter((i) => canSee.includes(i.key));
  const w = collapsed ? COLLAPSED_W : EXPANDED_W;

  // ── Connection poll ────────────────────────────────────────────────────────
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
    const iv = setInterval(check, 60000);
    return () => clearInterval(iv);
  }, []);

  // ── Alert / ticket count syncs from localStorage ──────────────────────────
  useEffect(() => {
    const sync = () =>
      setAlertCount(
        JSON.parse(localStorage.getItem('alertHistory') || '[]').length,
      );
    sync();
    window.addEventListener('alertHistoryChange', sync);
    return () => window.removeEventListener('alertHistoryChange', sync);
  }, []);

  useEffect(() => {
    const sync = () =>
      setPendingCount(
        JSON.parse(localStorage.getItem('agentTickets') || '[]').filter(
          (t) => t.status === 'pending',
        ).length,
      );
    sync();
    window.addEventListener('agentTicketsChange', sync);
    return () => window.removeEventListener('agentTicketsChange', sync);
  }, []);

  const handleLogout = () => {
    localStorage.clear();
    logout();
    navigate('/login');
  };

  // ── Badge helper ──────────────────────────────────────────────────────────
  const badgeFor = (key) => {
    if (key === 'dispatch' && pendingCount > 0) return pendingCount;
    if (key === 'alerts' && alertCount > 0) return alertCount;
    return null;
  };

  return (
    <aside style={s.sidebar(w)}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

      {/* ── Logo — click to expand when collapsed ─────────────────────────── */}
      <div
        style={s.logoArea(collapsed)}
        onClick={() => collapsed && setCollapsed(false)}
        title={collapsed ? 'Expand sidebar' : undefined}
      >
        <AlertOutlined
          style={{ color: '#ef4444', fontSize: 20, flexShrink: 0 }}
        />
        {!collapsed && <span style={s.logoText}>EMS</span>}
        {/* Connection dot — always right-aligned */}
        <span
          title={connected ? 'Connected' : 'Disconnected'}
          style={{
            marginLeft: 'auto',
            width: 8,
            height: 8,
            borderRadius: '50%',
            flexShrink: 0,
            background: connected ? '#34A853' : '#E53935',
            animation: connected ? 'none' : 'pulse 1.2s infinite',
          }}
        />
      </div>

      {/* ── Nav items ─────────────────────────────────────────────────────── */}
      <nav style={s.nav}>
        {visible.map(({ key, label, Icon, path }) => {
          const active = location.pathname.startsWith(path);
          const badge = badgeFor(key);
          return (
            <button
              key={key}
              title={collapsed ? label : undefined}
              onClick={() => navigate(path)}
              style={s.navItem(active, collapsed)}
            >
              <span style={{ position: 'relative', flexShrink: 0 }}>
                <Icon
                  style={{
                    fontSize: 18,
                    color: active ? '#ef4444' : '#64748b',
                  }}
                />
                {badge && collapsed && <span style={s.dotBadge} />}
              </span>
              {!collapsed && <span style={s.navLabel(active)}>{label}</span>}
              {!collapsed && badge && (
                <span style={s.badge(key === 'alerts')}>{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Spacer ────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1 }} />

      {/* ── Bottom section ────────────────────────────────────────────────── */}
      <div style={s.bottom}>
        {collapsed ? (
          /* ── Collapsed: logout icon only, centered ── */
          <button
            onClick={handleLogout}
            title='Logout'
            style={s.logoutBtnCollapsed}
          >
            <LogoutOutlined style={{ fontSize: 16, color: '#ef4444' }} />
          </button>
        ) : (
          /* ── Expanded: avatar + name/role + logout, then collapse arrow ── */
          <>
            <div style={s.userRow}>
              <div
                style={s.avatar}
                title={username}
              >
                <UserOutlined style={{ fontSize: 14, color: '#94a3b8' }} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={s.userName}>{username}</div>
                <div style={s.userRole}>{ROLE_LABEL[role] ?? role}</div>
              </div>
              <button
                onClick={handleLogout}
                title='Logout'
                style={s.logoutBtnInline}
              >
                <LogoutOutlined style={{ fontSize: 15, color: '#ef4444' }} />
              </button>
            </div>

            <div style={s.divider} />

            <button
              onClick={() => setCollapsed(true)}
              style={s.toggleBtn}
              title='Collapse sidebar'
            >
              <LeftOutlined style={{ fontSize: 11, color: '#475569' }} />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  sidebar: (w) => ({
    width: w,
    minWidth: w,
    height: '100vh',
    background: '#0d1117',
    borderRight: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
    transition: 'width 0.25s ease, min-width 0.25s ease',
    overflow: 'hidden',
    position: 'sticky',
    top: 0,
    flexShrink: 0,
    zIndex: 50,
  }),
  logoArea: (collapsed) => ({
    height: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    padding: collapsed ? '0 12px' : '0 18px',
    gap: 10,
    borderBottom: '1px solid #1e293b',
    flexShrink: 0,
    cursor: collapsed ? 'pointer' : 'default',
    userSelect: 'none',
  }),
  logoText: {
    fontFamily: "'Rajdhani', sans-serif",
    fontWeight: 700,
    fontSize: 17,
    letterSpacing: '0.12em',
    color: '#f1f5f9',
    whiteSpace: 'nowrap',
  },
  nav: {
    padding: '10px 0',
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  navItem: (active, collapsed) => ({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: collapsed ? '13px 0' : '11px 16px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    background: active ? 'rgba(239,68,68,0.1)' : 'transparent',
    borderTop: 'none',
    borderRight: 'none',
    borderBottom: 'none',
    borderLeft: active ? '3px solid #ef4444' : '3px solid transparent',
    cursor: 'pointer',
    transition: 'background 0.2s',
    outline: 'none',
    whiteSpace: 'nowrap',
    marginBottom: 2,
  }),
  navLabel: (active) => ({
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? '#f1f5f9' : '#64748b',
    fontFamily: "'Sora', sans-serif",
    flex: 1,
    textAlign: 'left',
  }),
  badge: (isAlert) => ({
    background: isAlert ? 'rgba(229,57,53,.2)' : 'rgba(249,168,37,.2)',
    color: isAlert ? '#FF8A80' : '#F9A825',
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 10,
    marginLeft: 'auto',
    flexShrink: 0,
  }),
  dotBadge: {
    position: 'absolute',
    top: -2,
    right: -3,
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#ef4444',
    display: 'block',
  },
  bottom: {
    borderTop: '1px solid #1e293b',
    flexShrink: 0,
    paddingTop: 8,
  },
  divider: {
    height: 1,
    background: '#1e293b',
    margin: '4px 0',
  },
  // expanded state only
  userRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 16px',
    overflow: 'hidden',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: '#1e293b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  userName: {
    fontSize: 12,
    fontWeight: 600,
    color: '#f1f5f9',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userRole: {
    fontSize: 10,
    color: '#ef4444',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    whiteSpace: 'nowrap',
  },
  // logout inside expanded user row
  logoutBtnInline: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
    padding: '6px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    outline: 'none',
    flexShrink: 0,
  },
  // logout when collapsed — full-width centered
  logoutBtnCollapsed: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 0',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    outline: 'none',
  },
  // collapse arrow — expanded only
  toggleBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 0',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    outline: 'none',
  },
};
