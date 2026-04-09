import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MedicineBoxOutlined,
  FireOutlined,
  SafetyOutlined,
  AlertOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  NodeIndexOutlined,
  CloseCircleOutlined,
  SendOutlined,
  EnvironmentOutlined,
  AimOutlined,
  ApartmentOutlined,
  UnorderedListOutlined,
  AppstoreOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { API_BASE_URL } from '../config/apiConfig';

const UCFG = {
  ambulance: { icon: <MedicineBoxOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} />, label: 'Ambulance', barColor: '#E53935' },
  fire: { icon: <FireOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} />, label: 'Fire Engine', barColor: '#FF6D00' },
  police: { icon: <SafetyOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} />, label: 'Police Unit', barColor: '#1565C0' },
  rescue: { icon: <AlertOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} />, label: 'Rescue', barColor: '#9C27B0' },
  hazmat: { icon: <WarningOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} />, label: 'Hazmat', barColor: '#F57F17' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'ambulance', label: <><MedicineBoxOutlined style={{ marginRight: 4 }} /> Ambulance</> },
  { key: 'fire', label: <><FireOutlined style={{ marginRight: 4 }} /> Fire</> },
  { key: 'police', label: <><SafetyOutlined style={{ marginRight: 4 }} /> Police</> },
  { key: 'rescue', label: <><AlertOutlined style={{ marginRight: 4 }} /> Rescue</> },
  { key: 'hazmat', label: <><WarningOutlined style={{ marginRight: 4 }} /> Hazmat</> },
];

const SEV_COLORS = { critical: '#E53935', high: '#FF6D00', medium: '#F9A825', low: '#34A853' };
const STATUS_CFG = {
  pending: { label: 'Pending', icon: <ClockCircleOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />, color: '#F9A825', bg: 'rgba(249,168,37,.12)' },
  accepted: { label: 'Accepted', icon: <CheckCircleOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />, color: '#34A853', bg: 'rgba(52,168,83,.12)' },
  dispatched: { label: 'Dispatched', icon: <NodeIndexOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />, color: '#1A73E8', bg: 'rgba(26,115,232,.12)' },
  completed: { label: 'Completed', icon: <CheckCircleOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />, color: '#34A853', bg: 'rgba(52,168,83,.12)' },
  rejected: { label: 'Rejected', icon: <CloseCircleOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />, color: '#E53935', bg: 'rgba(229,57,53,.12)' },
  en_route: {
    label: 'En Route',
    icon: <MedicineBoxOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />,
    color: '#1A73E8',
    bg: 'rgba(26,115,232,.12)'
  },
  arrived: {
    label: 'Arrived',
    icon: <EnvironmentOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />,
    color: '#34A853',
    bg: 'rgba(52,168,83,.12)'
  },
  on_action: {
    label: 'On Action',
    icon: <SendOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />,
    color: '#FF6D00',
    bg: 'rgba(255,109,0,.12)'
  },
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('card'); // 'card' or 'list'
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
        status: a.status || 'pending',
        severity: a.severity || 'medium',
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
          const res = await fetch(`${API_BASE_URL}/unit-location/${a.assignedUnit}`);
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


  // Grouping logic: multiple alerts for the same ticket should show as one card
  const groupedAlerts = React.useMemo(() => {
    const groups = {};
    alerts.forEach(a => {
      const key = a.agentTicketId || a.id;
      if (!groups[key]) {
        groups[key] = { ...a, assignedUnits: a.assignedUnit ? [a.assignedUnit] : [] };
      } else {
        if (a.assignedUnit && !groups[key].assignedUnits.includes(a.assignedUnit)) {
          groups[key].assignedUnits.push(a.assignedUnit);
        }
      }
    });
    return Object.values(groups);
  }, [alerts]);

  const visibleAlerts = groupedAlerts.filter(a => {
    const matchesFilter = filter === 'all' || a.vehicleType === filter;
    const q = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery ||
      (a.name || '').toLowerCase().includes(q) ||
      (a.address || '').toLowerCase().includes(q) ||
      (a.id || '').toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  const counts = {};
  FILTERS.forEach(f => {
    counts[f.key] = f.key === 'all'
      ? groupedAlerts.length
      : groupedAlerts.filter(a => a.vehicleType === f.key).length;
  });

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.pageHeader}>
        <div style={s.title}><ApartmentOutlined style={{ color: "#1A73E8", fontSize: '20px', verticalAlign: 'middle', marginRight: 8 }} /> Dispatched Incidents</div>
        <div style={{ fontSize: 11, color: '#8B949E', marginTop: 2 }}>
          {alerts.length} total · Click a ticket to open live tracking
        </div>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ position: 'relative' }}>
            <SearchOutlined style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#8B949E', fontSize: 14 }} />
            <input
              type="text"
              placeholder="Search incidents..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ background: '#0D1117', border: '1px solid #30363D', borderRadius: 8, color: '#E6EDF3', padding: '6px 12px 6px 32px', fontSize: 12, width: 220, outline: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', background: '#0D1117', borderRadius: 8, padding: 2, border: '1px solid #30363D' }}>
            <button onClick={() => setViewMode('card')} style={{ ...s.viewBtn, ...(viewMode === 'card' ? s.viewBtnActive : {}) }}><AppstoreOutlined /></button>
            <button onClick={() => setViewMode('list')} style={{ ...s.viewBtn, ...(viewMode === 'list' ? s.viewBtnActive : {}) }}><UnorderedListOutlined /></button>
          </div>
        </div>
      </div>

      {/* Cards / List */}
      {visibleAlerts.length === 0 ? (
        <div style={s.empty}>
          <div style={s.emptyIcon}>{filter === 'all' ? <ApartmentOutlined /> : (UCFG[filter]?.icon || <ApartmentOutlined />)}</div>
          <div style={s.emptyMsg}>
            {filter === 'all' ? 'No incidents dispatched yet' : `No ${UCFG[filter]?.label || filter} incidents`}
          </div>
          <div style={s.emptySub}>Dispatch from the Dispatch tab</div>
        </div>
      ) : (
        <div style={viewMode === 'card' ? s.grid : s.listStack}>
          {visibleAlerts.map(a => {
            const cfg = UCFG[a.vehicleType] || UCFG.ambulance;
            const t = new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const statusToUse = liveStatusMap[a.id] || a.status;
            const stCfg = STATUS_CFG[statusToUse] || STATUS_CFG.pending;
            const sevColor = SEV_COLORS[a.severity] || '#8B949E';

            if (viewMode === 'list') {
              return (
                <div key={a.id} style={s.listItem} onClick={() => navigate(`/live/${a.id}`, { state: { alert: a } })}>
                  <div style={{ ...s.listBar, background: cfg.barColor }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `${cfg.barColor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{cfg.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#E6EDF3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || 'Unknown'}</div>
                      <div style={{ fontSize: 10, color: '#8B949E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.address || '—'}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: stCfg.bg, color: stCfg.color }}>{stCfg.label}</span>
                      <span style={{ fontSize: 9, color: '#8B949E', fontFamily: 'JetBrains Mono, monospace' }}>{t}</span>
                    </div>
                    <div style={{ width: 80, textAlign: 'right' }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: sevColor }}>{a.severity?.toUpperCase()}</span>
                    </div>
                    <div style={{ width: 120, textAlign: 'right' }}>
                      {a.assignedUnits && a.assignedUnits.length > 0 ? (
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#82B4FF' }}>{a.assignedUnits.length} Unit{a.assignedUnits.length > 1 ? 's' : ''}</span>
                      ) : (
                        <span style={{ fontSize: 9, color: '#30363D' }}>No units</span>
                      )}
                    </div>
                    <button style={s.listOpenBtn}>Live Tracking →</button>
                  </div>
                </div>
              );
            }

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
                      <span style={{ fontSize: 18, display: 'flex', alignItems: 'center' }}>{cfg.icon}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: cfg.barColor }}>
                        {cfg.label}
                      </span>
                    </div>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#8B949E' }}>{t}</span>
                  </div>

                  {/* Patient name */}
                  <div style={s.ticketName}>{a.name || 'Unknown'}</div>

                  {/* Address */}
                  <div style={s.ticketAddr}><EnvironmentOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} /> {a.address || '—'}</div>

                  {/* Assigned unit(s) chip */}
                  {a.assignedUnits && a.assignedUnits.length > 0 && (
                    <div style={{ fontSize: 10, color: '#82B4FF', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <MedicineBoxOutlined style={{ fontSize: '12px' }} />
                      <span style={{ fontWeight: 700 }}>Assigned:</span> {a.assignedUnits.join(', ')}
                    </div>
                  )}

                  {/* Coordinates */}
                  {a.destination?.latitude && (
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#1A73E8', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AimOutlined style={{ fontSize: '12px' }} /> {a.destination.latitude.toFixed(5)}, {a.destination.longitude.toFixed(5)}
                    </div>
                  )}

                  {/* Footer */}
                  <div style={s.ticketFooter}>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {/* Severity chip */}
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 7,
                        textTransform: 'uppercase',
                        background: `${sevColor}18`,
                        color: sevColor
                      }}>{a.severity}</span>

                      {/* Status chip */}
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 7,
                        background: stCfg.bg, color: stCfg.color,
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                        {stCfg.icon} {stCfg.label}
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
  page: { padding: '20px 28px', maxWidth: 1200, margin: '0 auto' },
  pageHeader: { marginBottom: 18 },
  title: { fontSize: 19, fontWeight: 800 },
  filterRow: { display: 'flex', gap: 7, marginBottom: 16, flexWrap: 'wrap' },
  fltBtn: {
    display: 'inline-flex', alignItems: 'center',
    padding: '5px 13px', borderRadius: 16, fontSize: 11, fontWeight: 600,
    border: '1px solid #30363D', background: '#0D1117', color: '#8B949E',
    cursor: 'pointer', fontFamily: 'Sora, sans-serif', transition: 'all .15s',
  },
  fltActive: { borderColor: '#8B949E', color: '#E6EDF3', background: 'rgba(139,148,158,.08)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 12 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: '#8B949E', textAlign: 'center', gap: 10 },
  emptyIcon: { fontSize: 48, opacity: .22 },
  emptyMsg: { fontSize: 14, fontWeight: 700 },
  emptySub: { fontSize: 11, opacity: .6 },
  ticket: {
    background: '#161B22', border: '1px solid #30363D', borderRadius: 13,
    padding: '14px 16px', cursor: 'pointer', transition: 'border-color .2s, box-shadow .2s',
    position: 'relative', overflow: 'hidden',
  },
  ticketBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, borderRadius: '13px 0 0 13px' },
  ticketInner: { paddingLeft: 6 },
  ticketTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  ticketName: { fontSize: 15, fontWeight: 800, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  ticketAddr: { fontSize: 11, color: '#8B949E', marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  ticketFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, flexWrap: 'wrap', gap: 6 },
  openBtn: {
    fontSize: 10, fontWeight: 700, color: '#1A73E8',
    background: 'rgba(26,115,232,.1)', border: '1px solid rgba(26,115,232,.2)',
    borderRadius: 7, padding: '4px 10px', cursor: 'pointer',
    fontFamily: 'Sora, sans-serif', flexShrink: 0,
  },

  /* List View Styles */
  listStack: { display: 'flex', flexDirection: 'column', gap: 8 },
  listItem: { background: '#161B22', border: '1px solid #30363D', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', position: 'relative', overflow: 'hidden', transition: 'all .15s' },
  listBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  listOpenBtn: { background: 'rgba(26,115,232,.1)', border: '1px solid rgba(26,115,232,.2)', color: '#1A73E8', borderRadius: 6, padding: '4px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'Sora, sans-serif' },

  viewBtn: { background: 'transparent', border: 'none', color: '#8B949E', width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, transition: 'all .15s' },
  viewBtnActive: { background: '#30363D', color: '#fff' },
};