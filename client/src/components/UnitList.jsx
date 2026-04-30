import React, { useState, useEffect, useCallback } from 'react';
import { 
  MedicineBoxOutlined, 
  FireOutlined, 
  SafetyOutlined, 
  AlertOutlined, 
  WarningOutlined, 
  ExperimentOutlined, 
  DeleteOutlined, 
  WifiOutlined, 
  SearchOutlined, 
  CheckCircleOutlined, 
  EnvironmentOutlined,
  ApartmentOutlined,
  LockOutlined
} from '@ant-design/icons';
import { getUnits, getUnitsFromDb, getNearestUnits, registerUnit, updateUnitLoc } from '../api/api';

const UCFG = {
  ambulance: { icon: <MedicineBoxOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} />, label: 'Ambulance',  color: '#E53935' },
  fire:      { icon: <FireOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} />, label: 'Fire Engine', color: '#FF6D00' },
  police:    { icon: <SafetyOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} />, label: 'Police Unit', color: '#1565C0' },
  rescue:    { icon: <AlertOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} />, label: 'Rescue',      color: '#9C27B0' },
  hazmat:    { icon: <WarningOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} />,  label: 'Hazmat',      color: '#F57F17' },
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

export default function UnitList({
  pickedLat,
  pickedLng,
  selectedUnitIds = [],
  onToggleUnit,
  onUnitListChange,
  refreshTrigger,
}) {
  const [units,     setUnits]     = useState([]);
  const [mockUnits, setMockUnits] = useState({});

  /* ── Fetch & merge ──
     DB is the authority for unit_status (available / busy).
     Live (/units) is the authority for isOnline, location, secondsAgo.
     Units only in DB (server restarted, unit offline) are still shown
     so dispatcher can see their last-known status.
  ── */
  const fetchAll = useCallback(async () => {
    try {
      console.log('[UnitList] fetchAll → getUnits() + getUnitsFromDb()');

      const [liveRes, dbRes] = await Promise.allSettled([getUnits(), getUnitsFromDb()]);

      const liveUnits = liveRes.status === 'fulfilled' ? (liveRes.value.data?.data || []) : [];
      const dbUnits   = dbRes.status  === 'fulfilled' ? (dbRes.value.data?.data  || []) : [];

      console.log('[UnitList] live:', liveUnits.length, '| db:', dbUnits.length);

      if (liveRes.status === 'rejected') console.warn('[UnitList] getUnits() failed:', liveRes.reason);
      if (dbRes.status  === 'rejected') console.warn('[UnitList] getUnitsFromDb() failed:', dbRes.reason);

      const liveMap = Object.fromEntries(liveUnits.map(u => [u.id, u]));
      const dbMap   = Object.fromEntries(dbUnits.map(u => [u.id, u]));

      // Union: DB is the master registry of known units
      const allIds = new Set([...dbUnits.map(u => u.id), ...liveUnits.map(u => u.id)]);

      const mergedLive = Array.from(allIds).map(id => {
        const live = liveMap[id];
        const db   = dbMap[id];

        // DB wins for status — this is the persistent truth
        const finalStatus = db?.status || live?.status || 'available';

        // isOnline: live heartbeat is authoritative
        const isOnline = live
          ? (live.isOnline === true)
          : (db?.device_status === 'online');

        console.log(`[UnitList] ${id} → db.status=${db?.status} live.status=${live?.status} final=${finalStatus} online=${isOnline}`);

        return {
          ...(live || {}),
          id,
          name:          live?.name          || db?.name  || id,
          type:          live?.type          || db?.type  || 'ambulance',
          status:        finalStatus,                        // ← DB wins
          device_status: db?.device_status   || 'offline',
          isOnline,
          secondsAgo:    live?.secondsAgo    ?? null,
        };
      });

      const mArr = Object.values(mockUnits);
      let merged = [...mArr, ...mergedLive.filter(u => !mockUnits[u.id])];

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

      console.log('[UnitList] merged:', merged.map(u => ({ id: u.id, status: u.status, isOnline: u.isOnline })));
      setUnits(merged);
      onUnitListChange?.(merged);

      const online = merged.filter(u => u.isOnline).length;
      const el = document.getElementById('hdr-units');
      if (el) el.textContent = online + ' units online';
    } catch (err) {
      console.error('[UnitList] fetchAll error:', err.message);
    }
  }, [mockUnits, pickedLat, pickedLng, onUnitListChange]);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 10000); // 10s for faster busy/available reflection
    return () => clearInterval(iv);
  }, [fetchAll]);

  useEffect(() => {
    if (refreshTrigger) {
      console.log('[UnitList] refreshTrigger:', refreshTrigger);
      fetchAll();
    }
  }, [refreshTrigger, fetchAll]);

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
      // Only auto-select if unit is not busy in our merged list
      const firstAvailable = data.find(u => {
        const inList = units.find(x => x.id === u.id);
        return !inList || inList.status !== 'busy';
      });
      if (firstAvailable && onToggleUnit) onToggleUnit(firstAvailable.id);
    } catch (err) {
      console.error('[UnitList] findNearest error:', err.message);
    }
  };

  const realUnits    = units.filter(u => !u._isMock);
  const onlineUnits  = realUnits.filter(u => u.isOnline);
  const offlineUnits = realUnits.filter(u => !u.isOnline);
  const mockArr      = Object.values(mockUnits);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ════════ MOCK UNITS BOX ════════ */}
      <div style={s.wrap}>
        <div style={s.boxHeader}>
          <span><ExperimentOutlined style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 6 }} /> Mock Units</span>
          {mockArr.length > 0 && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 9,
              background: 'rgba(249,168,37,.15)', color: '#F9A825' }}>
              {mockArr.length} active
            </span>
          )}
        </div>
        <div style={s.tabBody}>
          <div style={s.tabHint}>Toggle mock units online/offline to simulate a live fleet for testing.</div>
          <div style={s.mockGrid}>
            {MOCK_DEFS.map(def => {
              const active = !!mockUnits[def.id];
              const cfg    = UCFG[def.type] || UCFG.ambulance;
              return (
                <button key={def.id} style={{ ...s.mockBtn, ...(active ? { borderColor: cfg.color, background: `${cfg.color}12`, color: cfg.color } : {}) }} onClick={() => toggleMock(def)}>
                  <span style={{ fontSize: 18, display: 'flex', alignItems: 'center' }}>{cfg.icon}</span>
                  <div style={{ textAlign: 'left', minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def.name}</div>
                    <div style={{ fontSize: 8, opacity: .6, marginTop: 1 }}>{def.id}</div>
                  </div>
                  <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: active ? `${cfg.color}25` : 'rgba(139,148,158,.1)', color: active ? cfg.color : '#8B949E' }}>
                    {active ? 'ONLINE' : 'OFF'}
                  </span>
                </button>
              );
            })}
          </div>
          <button style={s.clearAllMockBtn} onClick={clearAllMocks}>
            <DeleteOutlined style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 6 }} /> Clear All Mock Units
          </button>
        </div>
      </div>

      {/* ════════ UNITS BOX ════════ */}
      <div style={s.wrap}>
        <div style={s.boxHeader}>
          <span><ApartmentOutlined style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 6 }} /> Units</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {onlineUnits.length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 9, background: 'rgba(52,168,83,.15)', color: '#34A853' }}>
                {onlineUnits.length} online
              </span>
            )}
            {onlineUnits.filter(u => u.status === 'busy').length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 9, background: 'rgba(249,168,37,.15)', color: '#F9A825' }}>
                {onlineUnits.filter(u => u.status === 'busy').length} busy
              </span>
            )}
          </div>
        </div>
        <div style={s.tabBody}>
          <div style={s.tabHint}>
            {selectedUnitIds.length > 0
              ? `${selectedUnitIds.length} unit(s) selected — all will be dispatched together`
              : 'Click to select available units. Busy units cannot be dispatched.'}
          </div>

          <button style={s.nearestBtn} onClick={findNearest}>
            <SearchOutlined style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 6 }} /> Auto-select Nearest Available
          </button>

          {selectedUnitIds.length > 0 && (
            <div style={s.selBanner}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#82B4FF' }}>
                <CheckCircleOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 6 }} /> {selectedUnitIds.length} unit(s) queued for dispatch
              </span>
              <button style={s.clearBtn} onClick={() => selectedUnitIds.slice().forEach(id => onToggleUnit?.(id))}>
                Clear all
              </button>
            </div>
          )}

          {/* Mock units section */}
          {mockArr.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={s.sectionLabel}>Mock Units</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {mockArr.map(u => <UnitRow key={u.id} u={u} isSel={selectedUnitIds.includes(u.id)} onToggleUnit={onToggleUnit} />)}
              </div>
            </div>
          )}

          {/* Online real units */}
          {onlineUnits.length === 0 && mockArr.length === 0 ? (
            <div style={s.emptyMsg}>
              <div style={{ fontSize: 30, marginBottom: 7 }}><WifiOutlined style={{ opacity: .2 }} /></div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>No units online</div>
              <div style={{ fontSize: 10, marginTop: 3, opacity: .6 }}>Use the Mock Units panel above to add test units</div>
            </div>
          ) : onlineUnits.length > 0 ? (
            <div style={{ marginBottom: offlineUnits.length > 0 ? 14 : 0 }}>
              <div style={s.sectionLabel}>Online</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {onlineUnits.map(u => (
                  <UnitRow key={u.id} u={u} isSel={selectedUnitIds.includes(u.id)} onToggleUnit={onToggleUnit} />
                ))}
              </div>
            </div>
          ) : null}

          {/* Offline units — shown so dispatcher can see their last DB status */}
          {offlineUnits.length > 0 && (
            <div>
              <div style={{ ...s.sectionLabel, color: '#30363D' }}>Offline</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {offlineUnits.map(u => <UnitRow key={u.id} u={u} isSel={false} onToggleUnit={null} dimmed />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Reusable unit row ── */
function UnitRow({ u, isSel, onToggleUnit, dimmed = false }) {
  const isBusy      = u.status === 'busy';   // DB-authoritative
  const isClickable = !isBusy && !dimmed && !!onToggleUnit;
  const cfg         = UCFG[u.type] || UCFG.ambulance;

  return (
    <div
      style={{
        ...s.unitCard,
        ...(isSel  ? { borderColor: cfg.color, background: `${cfg.color}12`, boxShadow: `0 0 0 1px ${cfg.color}30` } : {}),
        ...(isBusy && !dimmed ? { borderColor: 'rgba(249,168,37,.35)', background: 'rgba(249,168,37,.04)' } : {}),
        ...(dimmed ? { opacity: .4 } : {}),
        cursor: isClickable ? 'pointer' : 'default',
      }}
      onClick={() => isClickable && onToggleUnit?.(u.id)}
      title={isBusy ? 'Unit is busy on active incident' : dimmed ? 'Unit is offline' : ''}
    >
      {/* Checkbox for available+online units */}
      {!dimmed && !isBusy && (
        <div style={{
          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
          border: `2px solid ${isSel ? cfg.color : '#30363D'}`,
          background: isSel ? cfg.color : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all .15s',
        }}>
          {isSel && <span style={{ fontSize: 10, color: '#fff', fontWeight: 900 }}>✓</span>}
        </div>
      )}

      {/* Lock icon for busy units */}
      {isBusy && !dimmed && (
        <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, background: 'rgba(249,168,37,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LockOutlined style={{ fontSize: 10, color: '#F9A825' }} />
        </div>
      )}

      <span style={{ fontSize: 22, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{cfg.icon}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#E6EDF3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {u.name}
          </span>
          {u._isMock && (
            <span style={{ fontSize: 8, background: 'rgba(249,168,37,.15)', color: '#F9A825', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>MOCK</span>
          )}
        </div>
        <div style={{ fontSize: 9, color: '#8B949E', marginTop: 1 }}>
          {u.id}
          {u.isOnline && u.secondsAgo != null ? ` · ${u.secondsAgo}s ago` : ''}
          {!u.isOnline && !u._isMock ? ' · Offline' : ''}
          {u.location?.latitude ? <><ApartmentOutlined style={{ fontSize: '10px', verticalAlign: 'middle', marginLeft: 4 }} /> GPS</> : ''}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        {/* Status badge — always from DB */}
        <span style={{
          fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 6,
          background: isBusy ? 'rgba(249,168,37,.15)' : dimmed ? 'rgba(139,148,158,.1)' : 'rgba(52,168,83,.15)',
          color:      isBusy ? '#F9A825'              : dimmed ? '#8B949E'               : '#34A853',
        }}>
          {isBusy ? 'Busy' : 'Available'}
        </span>
        {u.distanceM != null && (
          <span style={{ fontSize: 9, color: '#82B4FF', fontWeight: 700 }}>
            <EnvironmentOutlined style={{ fontSize: '10px', verticalAlign: 'middle', marginRight: 4 }} />{fmtDist(u.distanceM)}
          </span>
        )}
      </div>
    </div>
  );
}

const s = {
  boxHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #30363D', background: '#0D1117', fontSize: 12, fontWeight: 700, color: '#E6EDF3', fontFamily: 'Sora, sans-serif' },
  wrap:      { background: '#161B22', border: '1px solid #30363D', borderRadius: 14, overflow: 'hidden', marginBottom: 16 },
  tabBody:   { padding: 14 },
  tabHint:   { fontSize: 10, color: '#8B949E', marginBottom: 10, lineHeight: 1.5 },
  sectionLabel: { fontSize: 9, fontWeight: 800, color: '#8B949E', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 7 },
  nearestBtn:   { width: '100%', padding: 8, borderRadius: 9, border: '1px solid rgba(26,115,232,.3)', background: 'rgba(26,115,232,.08)', color: '#82B4FF', fontFamily: 'Sora, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer', marginBottom: 10 },
  selBanner:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(26,115,232,.08)', border: '1px solid rgba(26,115,232,.2)', borderRadius: 9, padding: '7px 11px', marginBottom: 10 },
  clearBtn:     { fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 7, border: '1px solid #30363D', background: '#0D1117', color: '#8B949E', cursor: 'pointer', fontFamily: 'Sora, sans-serif' },
  emptyMsg:     { textAlign: 'center', padding: '24px 18px', color: '#8B949E' },
  unitCard:     { display: 'flex', alignItems: 'center', gap: 10, background: '#0D1117', border: '2px solid #30363D', borderRadius: 11, padding: '10px 12px', transition: 'all .15s', userSelect: 'none' },
  mockGrid:     { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 },
  mockBtn:      { display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 10, border: '1.5px solid #30363D', background: '#0D1117', cursor: 'pointer', color: '#8B949E', fontFamily: 'Sora, sans-serif', transition: 'all .15s', textAlign: 'left', width: '100%' },
  clearAllMockBtn: { width: '100%', padding: 8, borderRadius: 9, border: '1px solid rgba(229,57,53,.3)', background: 'rgba(229,57,53,.07)', color: '#FF8A80', fontFamily: 'Sora, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
};