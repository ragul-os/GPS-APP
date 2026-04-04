import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const UCFG = {
  ambulance: { icon: '🚑', label: 'Ambulance',  barColor: '#E53935' },
  fire:      { icon: '🚒', label: 'Fire Engine', barColor: '#FF6D00' },
  police:    { icon: '🚔', label: 'Police Unit', barColor: '#1565C0' },
  rescue:    { icon: '🚁', label: 'Rescue',      barColor: '#9C27B0' },
  hazmat:    { icon: '☢️',  label: 'Hazmat',      barColor: '#F57F17' },
};

const FILTERS = [
  { key: 'all',       label: 'All'          },
  { key: 'ambulance', label: '🚑 Ambulance' },
  { key: 'fire',      label: '🚒 Fire'      },
  { key: 'police',    label: '🚔 Police'    },
  { key: 'rescue',    label: '🚁 Rescue'    },
  { key: 'hazmat',    label: '☢️ Hazmat'    },
];

const SEV_COLORS  = { critical: '#E53935', high: '#FF6D00', medium: '#F9A825', low: '#34A853' };
const STATUS_CFG  = {
  pending:    { label: '⏳ Pending',    color: '#F9A825', bg: 'rgba(249,168,37,.12)'  },
  accepted:   { label: '✅ Accepted',   color: '#34A853', bg: 'rgba(52,168,83,.12)'   },
  dispatched: { label: '🚨 Dispatched', color: '#1A73E8', bg: 'rgba(26,115,232,.12)' },
  completed:  { label: '✅ Completed',  color: '#34A853', bg: 'rgba(52,168,83,.12)'   },
  rejected:   { label: '❌ Rejected',   color: '#E53935', bg: 'rgba(229,57,53,.12)'   },
  en_route: {
  label: '🚗 En Route',
  color: '#1A73E8',
  bg: 'rgba(26,115,232,.12)'
},
on_action: {
  label: '⚡ On Action',
  color: '#FF6D00',
  bg: 'rgba(255,109,0,.12)'
},
arrived: {
  label: '📍 Arrived',
  color: '#34A853',
  bg: 'rgba(52,168,83,.12)'
},
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [liveStatusMap, setLiveStatusMap] = useState({});
  const navigate = useNavigate();
  const alertsRef = React.useRef([]); // stable ref to avoid restarting interval on every render

  useEffect(() => {
    const loadAlerts = () => {
      const raw = JSON.parse(localStorage.getItem('alertHistory') || '[]');
      // Normalise: ensure vehicleType always exists (fall back to 'ambulance' if missing)
      const normalised = raw.map(a => ({
        ...a,
        vehicleType: a.vehicleType || 'ambulance',
        status:      a.status      || 'pending',
        severity:    a.severity    || 'medium',
      }));
      setAlerts(normalised);
      alertsRef.current = normalised; // keep ref in sync for the polling interval
    };
    loadAlerts();
    window.addEventListener('alertHistoryChange', loadAlerts);
    return () => window.removeEventListener('alertHistoryChange', loadAlerts);
  }, []);

  useEffect(() => {
    const fetchStatuses = async () => {
      const currentAlerts = alertsRef.current;
      if (!currentAlerts.length) return;

      const map = {};
      for (const a of currentAlerts) {
        if (!a.assignedUnit) continue;
        try {
          const res = await fetch(`http://localhost:5000/unit-location/${a.assignedUnit}`);
          const data = await res.json();
          map[a.id] = data.tripStatus;
        } catch { /* ignore */ }
      }
      setLiveStatusMap(map);
    };

    fetchStatuses();
    const interval = setInterval(fetchStatuses, 10000); // 10s — status updates are not critical
    return () => clearInterval(interval);
  }, []); // run once — reads from alertsRef, not alerts state


  const visibleAlerts = filter === 'all'
    ? alerts
    : alerts.filter(a => a.vehicleType === filter);

  const counts = {};
  FILTERS.forEach(f => {
    counts[f.key] = f.key === 'all'
      ? alerts.length
      : alerts.filter(a => a.vehicleType === f.key).length;
  });

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.pageHeader}>
        <div style={s.title}>📡 Dispatched Incidents</div>
        <div style={{ fontSize: 11, color: '#8B949E', marginTop: 2 }}>
          {alerts.length} total · Click a ticket to open live tracking
        </div>
      </div>

      {/* Filter row */}
      <div style={s.filterRow}>
        {FILTERS.map(f => {
          const isActive = filter === f.key;
          const cfg = UCFG[f.key];
          return (
            <button
              key={f.key}
              style={{
                ...s.fltBtn,
                ...(isActive ? { ...s.fltActive, ...(cfg ? { borderColor: cfg.barColor, color: cfg.barColor } : {}) } : {}),
              }}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {counts[f.key] > 0 && (
                <span style={{
                  marginLeft: 5, fontSize: 9, fontWeight: 800,
                  padding: '1px 6px', borderRadius: 9,
                  background: isActive ? `${cfg?.barColor || '#8B949E'}25` : 'rgba(139,148,158,.12)',
                  color: isActive ? (cfg?.barColor || '#E6EDF3') : '#8B949E',
                }}>
                  {counts[f.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Cards */}
      {visibleAlerts.length === 0 ? (
        <div style={s.empty}>
          <div style={s.emptyIcon}>{filter === 'all' ? '📡' : (UCFG[filter]?.icon || '📡')}</div>
          <div style={s.emptyMsg}>
            {filter === 'all' ? 'No incidents dispatched yet' : `No ${UCFG[filter]?.label || filter} incidents`}
          </div>
          <div style={s.emptySub}>Dispatch from the Dispatch tab</div>
        </div>
      ) : (
        <div style={s.grid}>
          {visibleAlerts.map(a => {
            const cfg   = UCFG[a.vehicleType] || UCFG.ambulance;
            const t     = new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const isMonitoringPage = true; // this file is monitoring only

            const statusToUse = isMonitoringPage
              ? (liveStatusMap[a.id] || a.status) // ✅ live status
              : a.status; // (not used here but safe)

            const stCfg = STATUS_CFG[statusToUse] || STATUS_CFG.pending;

            return (
              <div
                key={a.id}
                style={s.ticket}
                onClick={() => navigate(`/live/${a.id}`, { state: { alert: a } })}
              >
                {/* Left color bar */}
                <div style={{ ...s.ticketBar, background: cfg.barColor }} />

                <div style={s.ticketInner}>
                  {/* Top row: icon + label + time */}
                  <div style={s.ticketTop}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 18 }}>{cfg.icon}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: cfg.barColor }}>
                        {cfg.label}
                      </span>
                    </div>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#8B949E' }}>{t}</span>
                  </div>

                  {/* Patient name */}
                  <div style={s.ticketName}>{a.name || 'Unknown'}</div>

                  {/* Address */}
                  <div style={s.ticketAddr}>📍 {a.address || '—'}</div>

                  {/* Assigned unit chip */}
                  {a.assignedUnit && (
                    <div style={{ fontSize: 10, color: '#82B4FF', marginBottom: 5 }}>
                      🚑 Assigned: {a.assignedUnit}
                    </div>
                  )}

                  {/* Coordinates */}
                  {a.destination?.latitude && (
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#1A73E8', marginBottom: 5 }}>
                      🌐 {a.destination.latitude.toFixed(5)}, {a.destination.longitude.toFixed(5)}
                    </div>
                  )}

                  {/* Footer */}
                  <div style={s.ticketFooter}>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {/* Severity chip */}
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 7,
                        textTransform: 'uppercase',
                        background: `${SEV_COLORS[a.severity] || '#8B949E'}18`,
                        color: SEV_COLORS[a.severity] || '#8B949E',
                      }}>
                        {a.severity}
                      </span>

                      {/* Status chip */}
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 7,
                        background: stCfg.bg, color: stCfg.color,
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                        {stCfg.label}
                      </span>
                    </div>

                    <button style={s.openBtn}>Live →</button>
                  </div>

                  {/* Alert ID */}
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#30363D', marginTop: 6 }}>
                    {a.id}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const s = {
  page:        { padding: '20px 28px', maxWidth: 1200, margin: '0 auto' },
  pageHeader:  { marginBottom: 18 },
  title:       { fontSize: 19, fontWeight: 800 },
  filterRow:   { display: 'flex', gap: 7, marginBottom: 16, flexWrap: 'wrap' },
  fltBtn: {
    display: 'inline-flex', alignItems: 'center',
    padding: '5px 13px', borderRadius: 16, fontSize: 11, fontWeight: 600,
    border: '1px solid #30363D', background: '#0D1117', color: '#8B949E',
    cursor: 'pointer', fontFamily: 'Sora, sans-serif', transition: 'all .15s',
  },
  fltActive:   { borderColor: '#8B949E', color: '#E6EDF3', background: 'rgba(139,148,158,.08)' },
  grid:        { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 12 },
  empty:       { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: '#8B949E', textAlign: 'center', gap: 10 },
  emptyIcon:   { fontSize: 48, opacity: .22 },
  emptyMsg:    { fontSize: 14, fontWeight: 700 },
  emptySub:    { fontSize: 11, opacity: .6 },
  ticket: {
    background: '#161B22', border: '1px solid #30363D', borderRadius: 13,
    padding: '14px 16px', cursor: 'pointer', transition: 'border-color .2s, box-shadow .2s',
    position: 'relative', overflow: 'hidden',
  },
  ticketBar:   { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, borderRadius: '13px 0 0 13px' },
  ticketInner: { paddingLeft: 6 },
  ticketTop:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  ticketName:  { fontSize: 15, fontWeight: 800, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  ticketAddr:  { fontSize: 11, color: '#8B949E', marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  ticketFooter:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, flexWrap: 'wrap', gap: 6 },
  openBtn: {
    fontSize: 10, fontWeight: 700, color: '#1A73E8',
    background: 'rgba(26,115,232,.1)', border: '1px solid rgba(26,115,232,.2)',
    borderRadius: 7, padding: '4px 10px', cursor: 'pointer',
    fontFamily: 'Sora, sans-serif', flexShrink: 0,
  },
};