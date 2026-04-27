import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getTicketTimeline } from '../api/api';

// ── Constants ─────────────────────────────────────────────────────────────────
const CARD_W      = 320;
const CARD_H      = 110;  // slightly taller to fit ticket_details overflow
const ROW_GAP     = 16;
const DOT_SIZE    = 14;
const SPINE_W     = 2;
const GAP_TO_CARD = 18;

// ── Palettes ──────────────────────────────────────────────────────────────────
const PALETTES = [
  { a: '#1A73E8', b: '#0D47A1', light: '#82B4FF' },
  { a: '#7C3AED', b: '#4C1D95', light: '#C4B5FD' },
  { a: '#059669', b: '#064E3B', light: '#6EE7B7' },
  { a: '#D97706', b: '#78350F', light: '#FCD34D' },
  { a: '#DC2626', b: '#7F1D1D', light: '#FCA5A5' },
  { a: '#0891B2', b: '#164E63', light: '#67E8F9' },
];

// ── Event config — maps event column value → label + heroicon path ────────────
const EVENT_CFG = {
  CREATED:             { label: 'Ticket Created',       icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  UPDATED_INFO:        { label: 'Info Updated',         icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
  ASSIGNED_DISPATCHER: { label: 'Dispatcher Assigned',  icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
  ASSIGNED_UNITS:      { label: 'Units Assigned',       icon: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM3 9h14M3 5h18v4H3z' },
  ACKNOWLEDGED:        { label: 'Acknowledged',         icon: 'M5 13l4 4L19 7' },
  REJECTED:            { label: 'Rejected',             icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z' },
  EN_ROUTE:            { label: 'En Route',             icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4' },
  ENROUTE:             { label: 'En Route',             icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4' },
  ARRIVED:             { label: 'Arrived',              icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z' },
  ON_ACTION:           { label: 'On Action',            icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  COMPLETED:           { label: 'Completed',            icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  CLOSED:              { label: 'Ticket Closed',        icon: 'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9' },
  DISPATCHED:          { label: 'Dispatched',           icon: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8' },
  UPDATED:             { label: 'Updated',              icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
  ESCALATED:           { label: 'Escalated',            icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  NOTE_ADDED:          { label: 'Note Added',           icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
  STATUS_CHANGED:      { label: 'Status Changed',       icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
};

// ── Source → badge color ──────────────────────────────────────────────────────
const SOURCE_COLORS = {
  system:     '#64748B',
  agent:      '#38BDF8',
  dispatcher: '#A78BFA',
  unit:       '#34D399',
  user:       '#FB923C',
  webhook:    '#F472B6',
};

// ── ticket_status → human stage label ────────────────────────────────────────
// Handles both "Stage N" DB values AND raw status strings
function stageLabel(status) {
  const MAP = {
    'Stage 1': 'Intake',
    'Stage 2': 'Dispatched',
    'Stage 3': 'Response',
    'Stage 4': 'Closed',
    'stage 1': 'Intake',
    'stage 2': 'Dispatched',
    'stage 3': 'Response',
    'stage 4': 'Closed',
    open:       'Intake',
    pending:    'Intake',
    dispatched: 'Dispatched',
    accepted:   'Dispatched',
    en_route:   'Response',
    on_action:  'Response',
    arrived:    'Response',
    completed:  'Closed',
    closed:     'Closed',
    rejected:   'Closed',
    abandoned:  'Closed',
  };
  return MAP[status] || status || 'Unknown';
}

// ── Stable sort key so stages appear in logical order ────────────────────────
function stageOrder(status) {
  const ORDER = {
    'Stage 1': 1, 'stage 1': 1, open: 1,      pending: 1,
    'Stage 2': 2, 'stage 2': 2, dispatched: 2, accepted: 2,
    'Stage 3': 3, 'stage 3': 3, en_route: 3,   on_action: 3, arrived: 3,
    'Stage 4': 4, 'stage 4': 4, completed: 4,  closed: 4,    rejected: 4, abandoned: 4,
  };
  return ORDER[status] ?? 99;
}

// ── Unit chip color pool ──────────────────────────────────────────────────────
const UNIT_PALETTE = ['#38BDF8','#F472B6','#34D399','#FBBF24','#A78BFA','#FB923C'];
function unitColor(uid, map) {
  if (!map[uid]) map[uid] = UNIT_PALETTE[Object.keys(map).length % UNIT_PALETTE.length];
  return map[uid];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (isNaN(d)) return '—';
    let h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} ${ap}`;
  } catch { return '—'; }
}
function fmtDate(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return ''; }
}
// Safely parse a value that might be a JSON string, plain object, or null
function safeObj(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    try {
      const p = JSON.parse(val);
      return typeof p === 'object' && !Array.isArray(p) ? p : null;
    } catch { return null; }
  }
  return typeof val === 'object' && !Array.isArray(val) ? val : null;
}

// ── Inline SVG icon ───────────────────────────────────────────────────────────
function Icon({ path, size = 13, color = 'currentColor', sw = 1.5 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block' }}>
      <path d={path} />
    </svg>
  );
}

// ── EventCard ─────────────────────────────────────────────────────────────────
function EventCard({ ev, side, palette, colorMap, index }) {
  // Normalize event key — DB may store lowercase or mixed case
  const eventKey = (ev.event || '').toUpperCase().replace(/\s+/g, '_');
  const cfg      = EVENT_CFG[eventKey] || { label: ev.event || 'Event', icon: EVENT_CFG.CREATED.icon };
  const srcColor = SOURCE_COLORS[(ev.event_source || '').toLowerCase()] || '#64748B';
  const accent   = side === 'left' ? palette.light : palette.a;

  // Flatten nested objects safely
  const unitsObj   = safeObj(ev.unit_details);
  const remarksObj = safeObj(ev.remarks);
  const locObj     = safeObj(ev.location);
  const teamObj    = safeObj(ev.team_details);

  const hasUnits = unitsObj && Object.keys(unitsObj).length > 0;

  // Detail line: remarks → location → team info → nothing
  let detailText = null;
  if (remarksObj && Object.keys(remarksObj).length > 0) {
    detailText = Object.entries(remarksObj)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ')
      .slice(0, 80); // cap so it doesn't overflow
  } else if (locObj && (locObj.lat || locObj.latitude)) {
    const lat = locObj.lat ?? locObj.latitude;
    const lng = locObj.lng ?? locObj.longitude;
    detailText = `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`;
  } else if (teamObj?.name) {
    detailText = `Team: ${teamObj.name}`;
  }

  // Priority badge
  const priority = ev.priority;
  const PRIORITY_COLOR = { high: '#EF4444', medium: '#F9A825', low: '#34D399', critical: '#DC2626' };
  const priColor = PRIORITY_COLOR[(priority || '').toLowerCase()] || null;

  return (
    <div style={{
      width: '100%',
      height: CARD_H,
      minHeight: CARD_H,
      maxHeight: CARD_H,
      overflow: 'hidden',
      boxSizing: 'border-box',
      background: `linear-gradient(145deg, #161B22 0%, ${palette.b}55 100%)`,
      border: `1px solid ${palette.a}40`,
      borderTop: `2px solid ${palette.a}`,
      borderRadius: 6,
      padding: '8px 10px 6px',
      position: 'relative',
      animationName: side === 'left' ? 'slideL' : 'slideR',
      animationDuration: '.35s',
      animationTimingFunction: 'ease',
      animationFillMode: 'both',
      animationDelay: `${index * 0.06}s`,
    }}>

      {/* Row 1: icon + label + source badge */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
        <div style={{
          width:22, height:22, borderRadius:4, flexShrink:0,
          background:`${palette.a}20`, display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <Icon path={cfg.icon} size={12} color={palette.light} sw={1.8}/>
        </div>
        <span style={{
          fontSize:11, fontWeight:700, color:'#E6EDF3',
          flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
        }}>{cfg.label}</span>
        {priColor && (
          <span style={{
            fontSize:7, fontWeight:800, padding:'1px 5px', borderRadius:3,
            background:`${priColor}18`, color:priColor,
            border:`1px solid ${priColor}35`, textTransform:'uppercase',
            letterSpacing:.5, flexShrink:0,
          }}>{priority}</span>
        )}
        <span style={{
          fontSize:7, fontWeight:700, padding:'2px 5px', borderRadius:3,
          background:`${srcColor}18`, color:srcColor,
          border:`1px solid ${srcColor}35`, textTransform:'uppercase',
          letterSpacing:.4, flexShrink:0, whiteSpace:'nowrap',
        }}>{ev.event_source || 'system'}</span>
      </div>

      {/* Row 2: source name + source id */}
      <div style={{
        display:'flex', alignItems:'center', gap:5,
        marginBottom: detailText || hasUnits ? 5 : 0,
        overflow:'hidden',
      }}>
        <span style={{ width:4, height:4, borderRadius:'50%', background:accent, flexShrink:0 }}/>
        <span style={{
          fontSize:10, color:accent, fontWeight:600,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1,
        }}>
          {ev.source_name && ev.source_name !== 'NA'
            ? ev.source_name
            : (ev.event_source || 'system')}
        </span>
        {ev.source_id && ev.source_id !== 'NA' && (
          <span style={{
            fontSize:8, color:'#4A5568', fontFamily:'monospace', flexShrink:0,
            overflow:'hidden', textOverflow:'ellipsis', maxWidth:90, whiteSpace:'nowrap',
          }}>{ev.source_id}</span>
        )}
      </div>

      {/* Row 3: remarks / location / team */}
      {detailText && (
        <div style={{
          fontSize:9, color:'#4A5568',
          marginBottom: hasUnits ? 5 : 0,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
          paddingLeft:9,
        }}>{detailText}</div>
      )}

      {/* Row 4: unit chips */}
      {hasUnits && (
        <div style={{ display:'flex', gap:4, overflow:'hidden', flexWrap:'nowrap' }}>
          {Object.values(unitsObj).filter(Boolean).slice(0,3).map((v, i) => (
            <span key={i} style={{
              fontSize:8, fontFamily:'monospace',
              background:`${unitColor(String(v), colorMap)}15`,
              color:unitColor(String(v), colorMap),
              border:`1px solid ${unitColor(String(v), colorMap)}40`,
              padding:'1px 5px', borderRadius:3, flexShrink:0,
              overflow:'hidden', textOverflow:'ellipsis', maxWidth:84, whiteSpace:'nowrap',
            }}>{v}</span>
          ))}
          {Object.values(unitsObj).filter(Boolean).length > 3 && (
            <span style={{ fontSize:8, color:'#4A5568', alignSelf:'center' }}>
              +{Object.values(unitsObj).filter(Boolean).length - 3}
            </span>
          )}
        </div>
      )}

      {/* Bottom-right: event_type chip */}
      <div style={{ position:'absolute', bottom:5, right:8 }}>
        <span style={{
          fontSize:7, fontWeight:700, padding:'1px 5px', borderRadius:2,
          background:`${palette.a}12`, color:`${palette.light}99`,
          border:`1px solid ${palette.a}25`, textTransform:'uppercase', letterSpacing:.4,
        }}>{ev.event_type || 'event'}</span>
      </div>

    </div>
  );
}

// ── TimelineRow ───────────────────────────────────────────────────────────────
function TimelineRow({ ev, side, palette, colorMap, index }) {
  const ts     = ev.created_at || ev.timestamp;
  const dotTop = Math.floor((CARD_H - DOT_SIZE) / 2);

  return (
    <div style={{ position:'relative', height:CARD_H, width:'100%', marginBottom:ROW_GAP }}>

      {/* Dot */}
      <div style={{
        position:'absolute', left:'50%', top:dotTop,
        transform:'translateX(-50%)',
        width:DOT_SIZE, height:DOT_SIZE, borderRadius:'50%',
        background:`radial-gradient(circle at 35% 35%, ${palette.light}, ${palette.a})`,
        border:`2px solid #0D1117`,
        boxShadow:`0 0 0 3px ${palette.a}30`,
        zIndex:4, flexShrink:0,
      }}/>

      {/* Card */}
      <div style={{
        position:'absolute', top:0, width:CARD_W, height:CARD_H,
        ...(side === 'right'
          ? { left:`calc(50% + ${GAP_TO_CARD}px)` }
          : { right:`calc(50% + ${GAP_TO_CARD}px)` }),
        overflow:'hidden',
      }}>
        <EventCard ev={ev} side={side} palette={palette} colorMap={colorMap} index={index}/>
      </div>

      {/* Time stamp on opposite side */}
      <div style={{
        position:'absolute', top:0, bottom:0,
        ...(side === 'right'
          ? { left:0, right:`calc(50% + ${GAP_TO_CARD}px)` }
          : { left:`calc(50% + ${GAP_TO_CARD}px)`, right:0 }),
        display:'flex', alignItems:'center',
        justifyContent: side === 'right' ? 'flex-end' : 'flex-start',
        paddingRight: side === 'right' ? 14 : 0,
        paddingLeft:  side === 'left'  ? 14 : 0,
        overflow:'hidden', pointerEvents:'none',
      }}>
        <div style={{ textAlign: side === 'right' ? 'right' : 'left' }}>
          <div style={{
            fontSize:13, fontWeight:700, color:palette.light,
            fontFamily:'monospace', whiteSpace:'nowrap',
          }}>{fmtTime(ts)}</div>
          <div style={{ fontSize:9, color:'#4A5568', marginTop:2, whiteSpace:'nowrap' }}>
            {fmtDate(ts)}
          </div>
        </div>
      </div>

    </div>
  );
}

// ── StageSection ──────────────────────────────────────────────────────────────
function StageSection({ stageKey, label, events, paletteIdx, colorMap }) {
  const palette     = PALETTES[paletteIdx % PALETTES.length];
  const spineTop    = CARD_H / 2;
  const spineHeight = events.length > 1
    ? (events.length - 1) * (CARD_H + ROW_GAP)
    : 0;

  return (
    <div style={{ marginBottom:48 }}>

      {/* Stage header */}
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1, height:1, background:`linear-gradient(90deg,transparent,${palette.a}40)` }}/>
        <div style={{
          padding:'7px 22px', borderRadius:20, margin:'0 16px',
          background:`linear-gradient(135deg,${palette.a},${palette.b})`,
          display:'flex', alignItems:'center', gap:8,
        }}>
          <span style={{ fontSize:10, fontWeight:800, color:'#fff', letterSpacing:1.2, textTransform:'uppercase' }}>
            {label}
          </span>
          <span style={{
            fontSize:8, padding:'1px 7px', borderRadius:8,
            background:'rgba(255,255,255,.18)', color:'#fff', fontWeight:700,
          }}>{events.length}</span>
        </div>
        {/* Show raw status key as sub-label if it differs from the human label */}
        {stageKey !== label && (
          <span style={{
            fontSize:8, color:'#4A5568', fontFamily:'monospace',
            marginLeft:6, whiteSpace:'nowrap',
          }}>{stageKey}</span>
        )}
        <div style={{ flex:1, height:1, background:`linear-gradient(90deg,${palette.a}40,transparent)` }}/>
      </div>

      {/* Rows + spine */}
      <div style={{ position:'relative' }}>
        {events.length > 1 && (
          <div style={{
            position:'absolute', left:'50%',
            transform:`translateX(-${SPINE_W / 2}px)`,
            top:spineTop, height:spineHeight,
            width:SPINE_W,
            background:`linear-gradient(180deg, ${palette.a}80 0%, ${palette.a}20 100%)`,
            zIndex:1, pointerEvents:'none',
          }}/>
        )}
        {events.map((ev, i) => (
          <TimelineRow
            key={`${ev.id || i}-${ev.event}-${i}`}
            ev={ev}
            side={i % 2 === 0 ? 'right' : 'left'}
            palette={palette}
            colorMap={colorMap}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}

// ── TimelinePage ──────────────────────────────────────────────────────────────
export default function TimelinePage() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const alertObj = location.state?.alert || null;

  // Ongoing = not closed/completed → auto-poll every 15s
  const isOngoing = !['completed','closed'].includes(
    (alertObj?.status || '').toLowerCase()
  );

  const [events,      setEvents]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const colorMap = useRef({}).current;
  const pollRef  = useRef(null);

  const load = (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    getTicketTimeline(id)
      .then(res => {
        const raw  = res.data;
        // Handle both array response and { events: [...] } shape
        const data = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.events)
            ? raw.events
            : [];
        setEvents(data);
        setLastRefresh(new Date());
        if (!silent) setLoading(false);
      })
      .catch(err => {
        setError(err.response?.data?.error || err.message);
        if (!silent) setLoading(false);
      });
  };

  useEffect(() => { load(); }, [id]);

  // Auto-poll for live incidents
  useEffect(() => {
    if (!isOngoing) return;
    pollRef.current = setInterval(() => load(true), 5000);
    return () => clearInterval(pollRef.current);
  }, [id, isOngoing]);

  // Group events by ticket_status, sorted in logical stage order
  const grouped = useMemo(() => {
    const map = new Map();
    events.forEach(ev => {
      const key = ev.ticket_status || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    });
    return [...map.entries()].sort(
      ([a], [b]) => stageOrder(a) - stageOrder(b)
    );
  }, [events]);

  // Stats for top bar
  const unitSet  = new Set(
    events
      .filter(e => (e.event_source || '').toLowerCase() === 'unit' && e.source_id)
      .map(e => e.source_id)
  );
  const isClosed = events.some(e =>
    ['CLOSED','COMPLETED'].includes((e.event || '').toUpperCase())
  );

  const BACK_ICO    = 'M10 19l-7-7m0 0l7-7m-7 7h18';
  const REFRESH_ICO = 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15';
  const ALERT_ICO   = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';

  return (
    <div style={S.root}>
      <style>{KF}</style>

      {/* ── Top bar ── */}
      <div style={S.topBar}>
        <button style={S.backBtn} onClick={() => navigate(-1)}>
          <Icon path={BACK_ICO} size={12} color="#E6EDF3" sw={2}/> Back
        </button>
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:'#E6EDF3' }}>Incident Timeline</div>
          <div style={{ fontSize:9, color:'#4A5568', fontFamily:'monospace', marginTop:1 }}>{id}</div>
        </div>
        <div style={{ flex:1 }}/>
        <div style={{ display:'flex', gap:7, alignItems:'center', flexWrap:'wrap' }}>
          {[
            { t:`${events.length} Events`, c:'#38BDF8' },
            { t:`${unitSet.size} Units`,   c:'#F472B6' },
            { t:`${grouped.length} Stages`,c:'#34D399' },
            isClosed  ? { t:'Closed',  c:'#34D399' } : null,
            isOngoing ? { t:'Live',    c:'#F9A825' } : null,
          ].filter(Boolean).map(x => (
            <span key={x.t} style={{
              fontSize:9, fontWeight:700, padding:'3px 10px', borderRadius:20,
              background:`${x.c}15`, color:x.c, border:`1px solid ${x.c}40`,
            }}>{x.t}</span>
          ))}
          {lastRefresh && (
            <span style={{ fontSize:8, color:'#4A5568', fontFamily:'monospace' }}>
              {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button style={S.iconBtn} onClick={() => load()}>
            <Icon path={REFRESH_ICO} size={11} color="#556070" sw={2}/>
          </button>
        </div>
      </div>

      {/* ── Incident strip ── */}
      {alertObj && (
        <div style={S.strip}>
          <Icon path={ALERT_ICO} size={11} color="#38BDF8" sw={2}/>
          <span style={{ fontSize:10, color:'#4A5568', marginLeft:6 }}>
            <span style={{ color:'#E6EDF3', fontWeight:700 }}>
              {alertObj.name || alertObj.patientName || '—'}
            </span>
            {alertObj.address  ? ` · ${alertObj.address}`                  : ''}
            {alertObj.severity ? ` · ${alertObj.severity.toUpperCase()}`   : ''}
            {alertObj.status   ? ` · ${alertObj.status.toUpperCase()}`     : ''}
          </span>
        </div>
      )}

      {/* ── Body ── */}
      <div style={S.body}>
        {loading && (
          <div style={S.center}>
            <div style={{ fontSize:12, color:'#4A5568' }}>Loading timeline…</div>
          </div>
        )}
        {error && (
          <div style={S.center}>
            <div style={{ fontSize:12, color:'#E53935', marginBottom:8 }}>{error}</div>
            <button style={S.backBtn} onClick={() => load()}>Retry</button>
          </div>
        )}
        {!loading && !error && events.length === 0 && (
          <div style={S.center}>
            <div style={{ fontSize:12, color:'#4A5568' }}>No events found for this ticket.</div>
            <div style={{ fontSize:10, color:'#30363D', marginTop:4, fontFamily:'monospace' }}>{id}</div>
          </div>
        )}
        {!loading && !error && grouped.map(([stageKey, evs], si) => (
          <StageSection
            key={stageKey}
            stageKey={stageKey}
            label={stageLabel(stageKey)}
            events={evs}
            paletteIdx={si}
            colorMap={colorMap}
          />
        ))}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  root: {
    position:'fixed', inset:0, zIndex:100, background:'#0D1117',
    display:'flex', flexDirection:'column',
    fontFamily:"'Inter',system-ui,sans-serif", color:'#E6EDF3',
  },
  topBar: {
    display:'flex', alignItems:'center', gap:12, flexShrink:0,
    padding:'10px 24px', background:'#0D1117',
    borderBottom:'1px solid #1E2530',
  },
  strip: {
    display:'flex', alignItems:'center', flexShrink:0,
    padding:'6px 24px', background:'rgba(56,189,248,.04)',
    borderBottom:'1px solid rgba(56,189,248,.12)',
  },
  body: { flex:1, overflowY:'auto', padding:'32px 40px' },
  center: {
    display:'flex', flexDirection:'column', alignItems:'center',
    justifyContent:'center', minHeight:'50vh', gap:10,
  },
  backBtn: {
    display:'flex', alignItems:'center', gap:5, padding:'6px 12px',
    borderRadius:7, background:'#161B22', border:'1px solid #1E2530',
    color:'#E6EDF3', fontSize:11, fontWeight:700, cursor:'pointer', flexShrink:0,
  },
  iconBtn: {
    padding:'6px 9px', borderRadius:7, background:'#161B22',
    border:'1px solid #1E2530', cursor:'pointer', lineHeight:1, color:'#556070',
  },
};

const KF = `
@keyframes slideR { from{opacity:0;transform:translateX(-16px)} to{opacity:1;transform:translateX(0)} }
@keyframes slideL { from{opacity:0;transform:translateX(16px)}  to{opacity:1;transform:translateX(0)} }
*{box-sizing:border-box}
::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:#0D1117}
::-webkit-scrollbar-thumb{background:#1E2530;border-radius:3px}
`;