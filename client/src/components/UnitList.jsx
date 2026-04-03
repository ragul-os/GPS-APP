import React, { useState, useEffect, useCallback } from 'react';
import { getUnits, getNearestUnits, registerUnit, updateUnitLoc } from '../api/api';

const UCFG = {
  ambulance: { icon: '🚑', label: 'Ambulance',  color: '#E53935' },
  fire:      { icon: '🚒', label: 'Fire Engine', color: '#FF6D00' },
  police:    { icon: '🚔', label: 'Police Unit', color: '#1565C0' },
  rescue:    { icon: '🚁', label: 'Rescue',      color: '#9C27B0' },
  hazmat:    { icon: '☢️',  label: 'Hazmat',      color: '#F57F17' },
};

const MOCK_DEFS = [
  { id: 'MOCK-AMB-01',  name: 'Ambulance Alpha', type: 'ambulance', baseLat: 11.0200, baseLng: 76.9500 },
  { id: 'MOCK-AMB-02',  name: 'Ambulance Beta',  type: 'ambulance', baseLat: 11.0350, baseLng: 76.9700 },
  { id: 'MOCK-FIRE-01', name: 'Fire Unit 1',      type: 'fire',      baseLat: 11.0100, baseLng: 76.9650 },
  { id: 'MOCK-POL-01',  name: 'Police Car 1',     type: 'police',    baseLat: 11.0280, baseLng: 76.9400 },
  { id: 'MOCK-RES-01',  name: 'Rescue Heli 1',    type: 'rescue',    baseLat: 11.0450, baseLng: 76.9550 },
  { id: 'MOCK-HAZ-01',  name: 'Hazmat Team 1',    type: 'hazmat',    baseLat: 10.9900, baseLng: 76.9600 },
];

function haversineMetres(la1, lo1, la2, lo2) {
  const R = 6371000, φ1 = la1 * Math.PI / 180, φ2 = la2 * Math.PI / 180;
  const dφ = (la2 - la1) * Math.PI / 180, dλ = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }

/* ─────────────────────────────────────────────────────────────────
   Props
   • pickedLat / pickedLng  – destination coords (for distance sort)
   • selectedUnitIds        – string[]  (controlled from parent)
   • onToggleUnit           – (id: string) => void
   • onUnitListChange       – (units: Unit[]) => void
   • activeTab              – 'units' | 'resources' | 'mock'  (optional, for tabbed layout)
───────────────────────────────────────────────────────────────── */
export default function UnitList({
  pickedLat,
  pickedLng,
  selectedUnitIds = [],
  onToggleUnit,
  onUnitListChange,
}) {
  const [units,     setUnits]     = useState([]);
  const [mockUnits, setMockUnits] = useState({});
 

  /* ── Fetch & merge ── */
  const fetchAll = useCallback(async () => {
    try {
      const res  = await getUnits();
      const real = res.data?.data || [];
      const mArr = Object.values(mockUnits);
      let merged = [...mArr, ...real.filter(u => !mockUnits[u.id])];

      if (pickedLat != null && pickedLng != null) {
        merged = merged.map(u => ({
          ...u,
          distanceM: u.location?.latitude
            ? Math.round(haversineMetres(
                pickedLat, pickedLng,
                parseFloat(u.location.latitude),
                parseFloat(u.location.longitude),
              ))
            : null,
        })).sort((a, b) => {
          if (a.distanceM != null && b.distanceM != null) return a.distanceM - b.distanceM;
          if (a.distanceM != null) return -1;
          if (b.distanceM != null) return 1;
          return 0;
        });
      }

      setUnits(merged);
      onUnitListChange?.(merged);

      const online = merged.filter(u => u.isOnline).length;
      const el = document.getElementById('hdr-units');
      if (el) el.textContent = online + ' units online';
    } catch { /* server offline — silently ignore */ }
  }, [mockUnits, pickedLat, pickedLng, onUnitListChange]);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 3000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  /* ── Mock helpers ── */
  const toggleMock = async (def) => {
    if (mockUnits[def.id]) {
      const next = { ...mockUnits };
      delete next[def.id];
      setMockUnits(next);
      try { await registerUnit({ unitId: def.id, name: def.name, type: def.type, status: 'offline' }); } catch { }
    } else {
      const jLa = (Math.random() - .5) * .02, jLg = (Math.random() - .5) * .02;
      const lat = def.baseLat + jLa, lng = def.baseLng + jLg;
      const unit = {
        id: def.id, name: def.name, type: def.type, status: 'available',
        isOnline: true, lastSeen: Date.now(), secondsAgo: 0,
        _isMock: true, distanceM: null,
        location: { latitude: lat, longitude: lng, heading: 0, speed: 0, updatedAt: Date.now() },
      };
      setMockUnits(prev => ({ ...prev, [def.id]: unit }));
      try {
        await registerUnit({ unitId: def.id, name: def.name, type: def.type });
        await updateUnitLoc({ unitId: def.id, latitude: lat, longitude: lng, heading: 0, speed: 0 });
      } catch { }
    }
  };

  const clearAllMocks = () => {
    Object.keys(mockUnits).forEach(id =>
      registerUnit({ unitId: id, name: id, type: 'ambulance', status: 'offline' }).catch(() => {}),
    );
    setMockUnits({});
  };

  const findNearest = async () => {
    if (pickedLat == null || pickedLng == null) return;
    try {
      const res  = await getNearestUnits(pickedLat, pickedLng, null, 10);
      const data = res.data?.data || [];
      if (data.length && onToggleUnit) onToggleUnit(data[0].id);
    } catch { }
  };

  const onlineUnits  = units.filter(u => u.isOnline);
  const mockCount    = Object.keys(mockUnits).length;

  /* ════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════ */
  return (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

    {/* ════════ MOCK UNITS BOX ════════ */}
    <div style={s.wrap}>
      <div style={s.boxHeader}>
        <span>🧪 Mock Units</span>
        {Object.keys(mockUnits).length > 0 && (
          <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 9,
            background: 'rgba(249,168,37,.15)', color: '#F9A825' }}>
            {Object.keys(mockUnits).length} active
          </span>
        )}
      </div>
      <div style={s.tabBody}>
        <div style={s.tabHint}>
          Toggle mock units online/offline to simulate a live fleet for testing.
        </div>
        <div style={s.mockGrid}>
          {MOCK_DEFS.map(def => {
            const active = !!mockUnits[def.id];
            const cfg    = UCFG[def.type] || UCFG.ambulance;
            return (
              <button
                key={def.id}
                style={{
                  ...s.mockBtn,
                  ...(active ? { borderColor: cfg.color, background: `${cfg.color}12`, color: cfg.color } : {}),
                }}
                onClick={() => toggleMock(def)}
              >
                <span style={{ fontSize: 18 }}>{cfg.icon}</span>
                <div style={{ textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {def.name}
                  </div>
                  <div style={{ fontSize: 8, opacity: .6, marginTop: 1 }}>{def.id}</div>
                </div>
                <span style={{
                  marginLeft: 'auto', flexShrink: 0,
                  fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                  background: active ? `${cfg.color}25` : 'rgba(139,148,158,.1)',
                  color: active ? cfg.color : '#8B949E',
                }}>
                  {active ? 'ONLINE' : 'OFF'}
                </span>
              </button>
            );
          })}
        </div>
        <button style={s.clearAllMockBtn} onClick={clearAllMocks}>
          🗑️ Clear All Mock Units
        </button>
      </div>
    </div>

    {/* ════════ ONLINE UNITS BOX ════════ */}
    <div style={s.wrap}>
      <div style={s.boxHeader}>
        <span>📡 Online Units</span>
        {onlineUnits.length > 0 && (
          <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 9,
            background: 'rgba(52,168,83,.15)', color: '#34A853' }}>
            {onlineUnits.length} online
          </span>
        )}
      </div>
      <div style={s.tabBody}>
        <div style={s.tabHint}>
          {selectedUnitIds.length > 0
            ? `${selectedUnitIds.length} unit(s) selected — all will be dispatched together`
            : 'Click to select units. Multiple units can be dispatched simultaneously.'}
        </div>

        <button style={s.nearestBtn} onClick={findNearest}>
          🔍 Auto-select Nearest Available
        </button>

        {selectedUnitIds.length > 0 && (
          <div style={s.selBanner}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#82B4FF' }}>
              ✅ {selectedUnitIds.length} unit(s) queued for dispatch
            </span>
            <button
              style={s.clearBtn}
              onClick={() => selectedUnitIds.slice().forEach(id => onToggleUnit?.(id))}
            >
              Clear all
            </button>
          </div>
        )}

        {onlineUnits.length === 0 ? (
          <div style={s.emptyMsg}>
            <div style={{ fontSize: 30, marginBottom: 7 }}>📵</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>No units online</div>
            <div style={{ fontSize: 10, marginTop: 3, opacity: .6 }}>
              Use the Mock Units panel above to add test units
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {onlineUnits.map(u => {
              const isSel  = selectedUnitIds.includes(u.id);
              const isBusy = u.status === 'busy';
              const cfg    = UCFG[u.type] || UCFG.ambulance;
              return (
                <div
                  key={u.id}
                  style={{
                    ...s.unitCard,
                    ...(isSel  ? { borderColor: cfg.color, background: `${cfg.color}12`, boxShadow: `0 0 0 1px ${cfg.color}30` } : {}),
                    ...(isBusy ? { opacity: .6 } : { cursor: 'pointer' }),
                  }}
                  onClick={() => !isBusy && onToggleUnit?.(u.id)}
                  title={isBusy ? 'Unit is busy on active incident' : ''}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                    border: `2px solid ${isSel ? cfg.color : '#30363D'}`,
                    background: isSel ? cfg.color : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all .15s',
                  }}>
                    {isSel && <span style={{ fontSize: 10, color: '#fff', fontWeight: 900 }}>✓</span>}
                  </div>

                  <span style={{ fontSize: 22, flexShrink: 0 }}>{cfg.icon}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#E6EDF3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u.name}
                      </span>
                      {u._isMock && (
                        <span style={{ fontSize: 8, background: 'rgba(249,168,37,.15)', color: '#F9A825', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                          MOCK
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: '#8B949E', marginTop: 1 }}>
                      {u.id} · {u.isOnline ? (u.secondsAgo + 's ago') : 'Offline'}
                      {u.location?.latitude ? ' · 📡 GPS' : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 6,
                      background: isBusy ? 'rgba(249,168,37,.15)' : 'rgba(52,168,83,.15)',
                      color: isBusy ? '#F9A825' : '#34A853',
                    }}>
                      {isBusy ? 'Busy' : 'Available'}
                    </span>
                    {u.distanceM != null && (
                      <span style={{ fontSize: 9, color: '#82B4FF', fontWeight: 700 }}>
                        📍 {fmtDist(u.distanceM)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>

  </div>
);
}

const s = {
  boxHeader: {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: '1px solid #30363D',
  background: '#0D1117',
  fontSize: 12,
  fontWeight: 700,
  color: '#E6EDF3',
  fontFamily: 'Sora, sans-serif',
},
  wrap: {
    background: '#161B22',
    border: '1px solid #30363D',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 16,
  },

  /* Tab bar */
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid #30363D',
    background: '#0D1117',
  },
  tab: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '10px 12px',
    fontSize: 11,
    fontWeight: 700,
    color: '#8B949E',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'Sora, sans-serif',
    borderBottom: '2px solid transparent',
    transition: 'all .15s',
  },
  tabActive: {
    color: '#E6EDF3',
    borderBottomColor: '#1A73E8',
    background: 'rgba(26,115,232,.06)',
  },
  tabBadge: {
    fontSize: 9, fontWeight: 800,
    padding: '1px 6px', borderRadius: 9,
  },

  tabBody: {
    padding: 14,
  },
  tabHint: {
    fontSize: 10,
    color: '#8B949E',
    marginBottom: 10,
    lineHeight: 1.5,
  },

  /* Online units */
  nearestBtn: {
    width: '100%', padding: 8, borderRadius: 9, border: '1px solid rgba(26,115,232,.3)',
    background: 'rgba(26,115,232,.08)', color: '#82B4FF',
    fontFamily: 'Sora, sans-serif', fontSize: 11, fontWeight: 700,
    cursor: 'pointer', marginBottom: 10,
  },
  selBanner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'rgba(26,115,232,.08)', border: '1px solid rgba(26,115,232,.2)',
    borderRadius: 9, padding: '7px 11px', marginBottom: 10,
  },
  clearBtn: {
    fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 7,
    border: '1px solid #30363D', background: '#0D1117', color: '#8B949E',
    cursor: 'pointer', fontFamily: 'Sora, sans-serif',
  },
  emptyMsg: {
    textAlign: 'center', padding: '24px 18px', color: '#8B949E',
  },
  unitCard: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: '#0D1117', border: '2px solid #30363D',
    borderRadius: 11, padding: '10px 12px',
    transition: 'all .15s', userSelect: 'none', cursor: 'pointer',
  },

  /* Mock units */
  mockGrid: {
    display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10,
  },
  mockBtn: {
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '9px 12px', borderRadius: 10,
    border: '1.5px solid #30363D', background: '#0D1117',
    cursor: 'pointer', color: '#8B949E',
    fontFamily: 'Sora, sans-serif', transition: 'all .15s',
    textAlign: 'left', width: '100%',
  },
  clearAllMockBtn: {
    width: '100%', padding: 8, borderRadius: 9,
    border: '1px solid rgba(229,57,53,.3)',
    background: 'rgba(229,57,53,.07)', color: '#FF8A80',
    fontFamily: 'Sora, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer',
  },
};