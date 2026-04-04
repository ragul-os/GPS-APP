/**
 * LiveTrackingPage — v5 FLICKER-FREE + MINIMAP COLLAPSE FIX
 *
 * ROOT CAUSES OF FLICKERING (all fixed here):
 * ─────────────────────────────────────────────────────────────────────────────
 * CAUSE 1 — lastTripSt was in poll useEffect dep array
 * CAUSE 2 — unitStatuses read inside poll closure (stale)
 * CAUSE 3 — setUnitLocations always set a new object reference
 * CAUSE 4 — auto-complete useEffect ran every second once allDone=true
 * CAUSE 5 — main poll dep array included trafficOn (state)
 * CAUSE 6 — all-units poll dep array was [dispatchedUnits] (new array ref each render)
 *
 * MINIMAP FIX (v5.1):
 * ─────────────────────────────────────────────────────────────────────────────
 * Problem: Collapsing the minimap resets miniMapObj.current = null (so it
 *   reinitialises on next open), but miniMkrsRef.current still holds old
 *   marker objects from the dead map instance. hasFitOnce was also stuck true.
 *   Result: new map shows destination pin but NO unit markers appear.
 *
 * Fix: when collapsed → true, we null out miniMapObj AND clear miniMkrsRef
 *   AND reset hasFitOnce. This way the re-open path is a clean slate — the
 *   init effect creates a fresh map, and the update effect recreates all
 *   markers from scratch with a fresh fitBounds call.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { getAmbulanceLocation, getDirections } from '../api/api';
import axios from 'axios';
import InteractionsTab from '../components/InteractionsTab'; // kept for TicketDetailsOverlay fallback
import GlobalChatPanel, { ChatTriggerButton } from '../components/GlobalChatPanel';
import { 
  MdLocalHospital, MdFireTruck, MdLocalPolice, MdWarning, 
  MdCheckCircle, MdCancel, MdAccessTime, MdNotificationsActive,
  MdPause, MdFiberManualRecord, MdFlag, MdBlock,
  MdAssignment, MdGpsFixed, MdSettings, MdRoad, MdStar,
  MdLocationOn, MdOpacity, MdMedicalServices, MdSearch, MdClose
} from 'react-icons/md';
import { FaHelicopter, FaHospital, FaAmbulance } from 'react-icons/fa';
import { GiRadioactive } from 'react-icons/gi';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';

const BASE = 'http://localhost:5000';

const DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#1a1f2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1f2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8b949e' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d3748' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3d4f6e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1117' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

const UCFG = {
  ambulance: { icon: <MdLocalHospital />, emoji: '🚑', label: 'Ambulance', color: '#4CAF50' },
  fire: { icon: <MdFireTruck />, emoji: '🚒', label: 'Fire Engine', color: '#FB8C00' },
  police: { icon: <MdLocalPolice />, emoji: '🚔', label: 'Police Unit', color: '#1E88E5' },
  rescue: { icon: <FaHelicopter />, emoji: '🚁', label: 'Rescue', color: '#8E24AA' },
  hazmat: { icon: <GiRadioactive />, emoji: '☢️', label: 'Hazmat', color: '#F57F17' },
};

const SEV_COLORS = { critical: '#E53935', high: '#FF6D00', medium: '#F9A825', low: '#34A853' };

const TICKET_STATUS_CFG = {
  pending: { label: 'Pending', icon: <MdAccessTime />, color: '#F9A825', bg: 'rgba(249,168,37,.15)' },
  dispatched: { label: 'Dispatched', icon: <MdNotificationsActive />, color: '#1A73E8', bg: 'rgba(26,115,232,.15)' },
  completed: { label: 'Completed', icon: <MdCheckCircle />, color: '#34A853', bg: 'rgba(52,168,83,.15)' },
  rejected: { label: 'Rejected', icon: <MdCancel />, color: '#E53935', bg: 'rgba(229,57,53,.15)' },
};

const UNIT_ST_COLOR = {
  idle: '#8B949E', accepted: '#34A853', en_route: '#1A73E8',
  on_action: '#9C27B0', arrived: '#34A853', completed: '#A5D6A7', abandoned: '#EF5350',
};
const UNIT_ST_ICON = {
  idle: <MdPause />, accepted: <MdCheckCircle />, en_route: <MdLocalHospital />, on_action: <MdFiberManualRecord />,
  arrived: <MdFlag />, completed: <MdCheckCircle />, abandoned: <MdBlock />,
};

const TRIP_STATUS_CFG = {
  idle: { bg: 'rgba(139,148,158,.12)', brd: 'rgba(139,148,158,.2)', c: '#8B949E', i: <MdPause />, t: 'Idle', s: 'No active trip' },
  dispatched: { bg: 'rgba(249,168,37,.15)', brd: 'rgba(249,168,37,.3)', c: '#F9A825', i: <MdNotificationsActive />, t: 'Alert Dispatched', s: 'Unit notified — preparing' },
  en_route: { bg: 'rgba(26,115,232,.15)', brd: 'rgba(26,115,232,.3)', c: '#1A73E8', i: <MdLocalHospital />, t: 'En Route', s: 'Unit driving to location' },
  on_action: { bg: 'rgba(156,39,176,.15)', brd: 'rgba(206,147,216,.3)', c: '#CE93D8', i: <MdFiberManualRecord />, t: 'On Action', s: 'Unit on scene' },
  arrived: { bg: 'rgba(52,168,83,.18)', brd: 'rgba(52,168,83,.4)', c: '#34A853', i: <MdFlag />, t: 'ARRIVED', s: 'Unit reached destination!' },
  completed: { bg: 'rgba(52,168,83,.10)', brd: 'rgba(52,168,83,.25)', c: '#A5D6A7', i: <MdCheckCircle />, t: 'Trip Completed', s: 'Successfully completed' },
  abandoned: { bg: 'rgba(183,28,28,.15)', brd: 'rgba(229,57,53,.35)', c: '#EF5350', i: <MdBlock />, t: 'Trip Abandoned', s: 'Driver abandoned trip' },
};

const LIFECYCLE_ORDER = ['accepted', 'en_route', 'on_action', 'arrived', 'completed'];

const NEARBY_TYPES = {
  hospital: { label: 'Hospital', icon: <FaHospital />, emoji: '🏥', color: '#E53935', placeType: 'hospital', radius: 5000 },
  blood_bank: { label: 'Blood Bank', icon: <MdOpacity />, emoji: '🩸', color: '#D32F2F', placeType: 'blood_bank', radius: 8000 },
  police: { label: 'Police Station', icon: <MdLocalPolice />, emoji: '🚔', color: '#1565C0', placeType: 'police', radius: 5000 },
  fire_station: { label: 'Fire Station', icon: <MdFireTruck />, emoji: '🚒', color: '#FF6D00', placeType: 'fire_station', radius: 5000 },
  pharmacy: { label: 'Pharmacy', icon: <MdMedicalServices />, emoji: '💊', color: '#7B1FA2', placeType: 'pharmacy', radius: 3000 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function haversine(la1, lo1, la2, lo2) { const R = 6371000, φ1 = la1 * Math.PI / 180, φ2 = la2 * Math.PI / 180, dφ = (la2 - la1) * Math.PI / 180, dλ = (lo2 - lo1) * Math.PI / 180, a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }
function fmtTime(s) { if (s <= 0) return '0 min'; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h === 0 ? m + ' min' : m === 0 ? h + ' hr' : h + ' hr ' + m + ' min'; }
function trafficRatio(dS, tS) { if (!tS || !dS) return 1; return tS / dS; }
function trafficLabel(r) { if (r < 1.1) return { label: 'Free flow', color: '#34A853', icon: <MdFiberManualRecord />, short: 'Free' }; if (r < 1.3) return { label: 'Moderate', color: '#F9A825', icon: <MdFiberManualRecord />, short: 'Mod' }; if (r < 1.6) return { label: 'Heavy', color: '#E53935', icon: <MdFiberManualRecord />, short: 'Heavy' }; return { label: 'Stop & Go', color: '#B71C1C', icon: <MdFiberManualRecord />, short: 'Stop&Go' }; }
function decPoly(enc) { let p = [], i = 0, la = 0, ln = 0; while (i < enc.length) { let b, s = 0, r = 0; do { b = enc.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20); la += (r & 1) ? ~(r >> 1) : (r >> 1); s = 0; r = 0; do { b = enc.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20); ln += (r & 1) ? ~(r >> 1) : (r >> 1); p.push({ lat: la / 1e5, lng: ln / 1e5 }); } return p; }
function stitch(steps) { const o = []; for (const st of steps) { if (!st.polyline?.points) continue; const pts = decPoly(st.polyline.points); if (o.length && pts.length) { const l = o[o.length - 1], f = pts[0]; if (Math.abs(l.lat - f.lat) < 1e-6 && Math.abs(l.lng - f.lng) < 1e-6) o.push(...pts.slice(1)); else o.push(...pts); } else o.push(...pts); } return o; }

// ── Routes API v2 — Real per-segment traffic ──────────────────────────────
const GOOGLE_API_KEY = 'AIzaSyAVz9omOzS8B29CEi50AkrNPMPn3JXhbcg'; // ← put your key here

async function fetchRoutesV2(originLat, originLng, destLat, destLng) {
  try {
    const body = {
      origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
      destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      departureTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      extraComputations: ['TRAFFIC_ON_POLYLINE'],
    };

    console.log('[RoutesV2] 🚀 Calling Routes API v2...', { originLat, originLng, destLat, destLng });

    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': [
          'routes.distanceMeters',
          'routes.duration',
          'routes.staticDuration',
          'routes.polyline.encodedPolyline',
          'routes.travelAdvisory.speedReadingIntervals',
        ].join(','),
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    console.log('[RoutesV2] 📦 Raw response:', data);

    if (!data.routes || !data.routes[0]) {
      console.warn('[RoutesV2] ❌ No routes returned. Check API key & billing.');
      return null;
    }

    const route = data.routes[0];
    const encoded = route.polyline?.encodedPolyline;
    if (!encoded) { console.warn('[RoutesV2] ❌ No encodedPolyline.'); return null; }

    const intervals = route.travelAdvisory?.speedReadingIntervals || [];
    console.log(`[RoutesV2] ✅ Got ${intervals.length} speed intervals:`, intervals);

    const durSec = parseInt((route.staticDuration || '0s').replace('s', '')) || 0;
    const trafSec = parseInt((route.duration || '0s').replace('s', '')) || 0;

    return { encoded, intervals, durSec, trafSec, distM: route.distanceMeters || 0 };

  } catch (e) {
    console.error('[RoutesV2] ❌ Fetch error:', e);
    return null;
  }
}

// Speed category → overlay color (null = free flow, no overlay needed)
function speedToColor(speed) {
  if (speed === 'TRAFFIC_JAM') return '#9b1c1c';
  if (speed === 'SLOW') return '#ea4335';
  return null; // NORMAL → blue base shows through
}

// ── localStorage helpers ──────────────────────────────────────────────────────
function getAgentTickets() { return JSON.parse(localStorage.getItem('agentTickets') || '[]'); }
function saveAgentTickets(t) { localStorage.setItem('agentTickets', JSON.stringify(t)); window.dispatchEvent(new Event('agentTicketsChange')); }
function updateAgentTicketStatus(ticketId, status) { const tickets = getAgentTickets(); const idx = tickets.findIndex(t => t.id === ticketId); if (idx !== -1) { tickets[idx].status = status; saveAgentTickets(tickets); } }
function updateAlertHistoryStatus(alertId, status) { const history = JSON.parse(localStorage.getItem('alertHistory') || '[]'); const idx = history.findIndex(a => a.id === alertId); if (idx !== -1) { history[idx].status = status; localStorage.setItem('alertHistory', JSON.stringify(history)); window.dispatchEvent(new Event('alertHistoryChange')); } }

// ─────────────────────────────────────────────────────────────────────────────
// TicketDetailsOverlay
// ─────────────────────────────────────────────────────────────────────────────
function TicketDetailsOverlay({
  alertObj, agentTicket, ticketStatus, dispatchedUnits,
  unitStatuses, unitTypes, activeUnitId, onSwitchUnit
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('units');

  const name = agentTicket?.name || alertObj?.name || alertObj?.patientName || '—';
  const phone = agentTicket?.phone || alertObj?.phone || agentTicket?.answers?.f2 || '—';
  const address = agentTicket?.address || alertObj?.address || '—';
  const notes = agentTicket?.notes || alertObj?.notes || agentTicket?.answers?.f7 || null;
  const severity = agentTicket?.severity || alertObj?.severity || 'medium';
  const vType = agentTicket?.vehicleType || alertObj?.vehicleType || 'ambulance';
  const dest = agentTicket?.destination || alertObj?.destination;
  const answers = agentTicket?.answers || {};
  const cfg = UCFG[vType] || UCFG.ambulance;
  const stCfg = TICKET_STATUS_CFG[ticketStatus] || TICKET_STATUS_CFG.dispatched;
  const ticketNo = agentTicket?.id || alertObj?.id || '—';
  const completedCount = dispatchedUnits.filter(uid => unitStatuses[uid] === 'completed').length;

  return (
    <div style={ns.ticketOverlay}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: collapsed ? 0 : 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{cfg.icon}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 9, color: '#8B949E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Ticket</div>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#82B4FF', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all', whiteSpace: 'normal', lineHeight: 1.4 }}>{ticketNo}</div>
            <div style={{ fontSize: 9, fontWeight: 800, marginTop: 3, padding: '2px 7px', borderRadius: 5, background: stCfg.bg, color: stCfg.color, display: 'inline-block' }}>{stCfg.label}</div>
          </div>
        </div>
        <button onClick={() => setCollapsed(v => !v)} style={ns.collapseBtn}>{collapsed ? '▼' : '▲'}</button>
      </div>

      {!collapsed && (
        <>
          <div style={ns.tabBar}>
            <button style={{ ...ns.tabBtn, ...(activeTab === 'units' ? ns.tabBtnActive : {}) }} onClick={() => setActiveTab('units')}>
              🚑 Units
              <span style={{ marginLeft: 4, fontSize: 8, fontWeight: 800, background: activeTab === 'units' ? 'rgba(26,115,232,.25)' : 'rgba(139,148,158,.15)', color: activeTab === 'units' ? '#82B4FF' : '#8B949E', padding: '1px 5px', borderRadius: 4 }}>{dispatchedUnits.length}</span>
            </button>
            <button style={{ ...ns.tabBtn, ...(activeTab === 'ticket' ? ns.tabBtnActive : {}) }} onClick={() => setActiveTab('ticket')}>
              🎫 Ticket Info
            </button>
          </div>

          {activeTab === 'units' && (
            <div style={{ marginTop: 8 }}>
              {dispatchedUnits.length > 0 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 8, fontWeight: 700, color: '#8B949E', textTransform: 'uppercase', letterSpacing: 1 }}>Progress</span>
                    <span style={{ fontSize: 9, fontWeight: 800, color: '#82B4FF' }}>{completedCount}/{dispatchedUnits.length} done</span>
                  </div>
                  <div style={{ height: 3, background: 'rgba(255,255,255,.07)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: 3, borderRadius: 2, transition: 'width .6s', background: completedCount === dispatchedUnits.length ? '#34A853' : '#1A73E8', width: `${dispatchedUnits.length ? (completedCount / dispatchedUnits.length) * 100 : 0}%` }} />
                  </div>
                  {dispatchedUnits.map(uid => {
                    const st = unitStatuses[uid] || 'dispatched', stc = UNIT_ST_COLOR[st] || '#8B949E', sti = UNIT_ST_ICON[st] || '🚑';
                    return (
                      <div key={uid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid rgba(48,54,61,.3)' }}>
                        <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: '#8B949E', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{uid}</span>
                        <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 5, background: `${stc}18`, color: stc, flexShrink: 0 }}>{sti} {st}</span>
                      </div>
                    );
                  })}
                  {completedCount === dispatchedUnits.length && dispatchedUnits.length > 0 && (
                    <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 7, background: 'rgba(52,168,83,.12)', border: '1px solid rgba(52,168,83,.25)', fontSize: 9, fontWeight: 700, color: '#34A853', textAlign: 'center' }}>✅ All units completed</div>
                  )}
                </>
              )}

              {dispatchedUnits.length > 1 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(48,54,61,.5)' }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: '#8B949E', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>🎯 Live Track Unit</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {dispatchedUnits.map(uid => {
                      const type = unitTypes[uid] || 'ambulance', ucfg = UCFG[type] || UCFG.ambulance;
                      const isActive = uid === activeUnitId, st = unitStatuses[uid] || 'dispatched', stc = UNIT_ST_COLOR[st] || '#8B949E';
                      return (
                        <button key={uid} onClick={() => onSwitchUnit && onSwitchUnit(uid)}
                          style={{ ...ns.switcherBtn, background: isActive ? `${ucfg.color}22` : 'rgba(30,37,46,.7)', border: `1.5px solid ${isActive ? ucfg.color : 'rgba(48,54,61,.7)'}`, color: isActive ? ucfg.color : '#8B949E', boxShadow: isActive ? `0 0 10px ${ucfg.color}44` : 'none' }}>
                          <span style={{ fontSize: 14 }}>{ucfg.icon}</span>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, minWidth: 0, flex: 1 }}>
                            <span style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80, whiteSpace: 'nowrap' }}>{uid}</span>
                            <span style={{ fontSize: 7, color: stc, fontWeight: 700, textTransform: 'uppercase' }}>{UNIT_ST_ICON[st]} {st}</span>
                          </div>
                          {isActive && <span style={{ fontSize: 7, fontWeight: 800, color: ucfg.color, background: `${ucfg.color}18`, padding: '1px 4px', borderRadius: 4, flexShrink: 0 }}>LIVE</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {dispatchedUnits.length === 1 && (
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: 8, background: 'rgba(26,115,232,.08)', border: '1px solid rgba(26,115,232,.2)' }}>
                  <span style={{ fontSize: 12 }}>{(UCFG[unitTypes[dispatchedUnits[0]] || 'ambulance'] || UCFG.ambulance).icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: '#8B949E', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dispatchedUnits[0]}</div>
                    <div style={{ fontSize: 7, color: '#82B4FF', fontWeight: 700, marginTop: 1 }}>🔴 LIVE TRACKING</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'ticket' && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                <span style={{ fontSize: 15 }}>{cfg.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#E6EDF3' }}>{name}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 5, background: stCfg.bg, color: stCfg.color }}>{stCfg.label}</span>
                    <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 5, background: `${SEV_COLORS[severity] || '#8B949E'}18`, color: SEV_COLORS[severity] || '#8B949E', textTransform: 'uppercase' }}>{severity}</span>
                  </div>
                </div>
              </div>
              {[
                ['📞 Phone', phone],
                ['📍 Address', address],
                dest?.latitude && ['🌐 Coords', `${dest.latitude.toFixed(5)}, ${dest.longitude.toFixed(5)}`],
                answers.f4 && ['🔖 Type', answers.f4],
                notes && ['📝 Notes', notes],
              ].filter(Boolean).map(([lbl, val]) => (
                <div key={lbl} style={ns.detRow}>
                  <span style={ns.detLbl}>{lbl}</span>
                  <span style={{ ...ns.detVal, fontFamily: lbl === '🌐 Coords' ? 'JetBrains Mono, monospace' : 'inherit', fontSize: lbl === '🌐 Coords' ? 9 : 10, color: lbl === '🌐 Coords' ? '#1A73E8' : '#E6EDF3' }}>{val}</span>
                </div>
              ))}
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: '#8B949E', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Ticket Status</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: stCfg.bg, border: `1px solid ${stCfg.color}40` }}>

                  <span style={{ fontSize: 11, fontWeight: 800, color: stCfg.color, flex: 1 }}>{stCfg.label}</span>
                  {ticketStatus === 'completed' && (
                    <span style={{ fontSize: 8, fontWeight: 800, color: '#0e100f', background: 'rgba(52,168,83,.2)', padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(52,168,83,.3)' }}>CLOSED</span>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 8, padding: '5px 8px', borderRadius: 7, background: 'rgba(26,115,232,.06)', border: '1px solid rgba(26,115,232,.15)' }}>
                <div style={{ fontSize: 8, color: '#8B949E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Ticket ID</div>
                <div style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: '#82B4FF', wordBreak: 'break-all' }}>{ticketNo}</div>
              </div>
            </div>
          )}


        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MiniMapOverlay — COLLAPSE FIX
//
// The bug: collapsing set miniMapObj.current = null (good — triggers reinit on
// re-open), but miniMkrsRef.current still held stale marker objects from the
// dead map instance. hasFitOnce was also stuck true. So when re-opened:
//   • Init effect ran → new google Map created ✓
//   • Destination pin added ✓
//   • Update effect ran → tried miniMkrsRef.current[uid].setPosition() on
//     markers whose map reference was gone → no visible markers ✗
//   • fitBounds skipped because hasFitOnce was true ✗
//
// Fix: the collapse effect now does a full teardown — nulls the map ref,
// clears miniMkrsRef, and resets hasFitOnce. Re-open is then a clean slate.
// ─────────────────────────────────────────────────────────────────────────────
function MiniMapOverlay({ alertObj, dispatchedUnits, unitLocations, unitTypes, onUnitClick, activeUnitId }) {
  const miniMapRef = useRef(null);
  const miniMapObj = useRef(null);
  const miniMkrsRef = useRef({});
  const hasFitOnce = useRef(false);
  const [collapsed, setCollapsed] = useState(false);

  const activeType = unitTypes[activeUnitId] || 'ambulance';
  const activeColor = (UCFG[activeType] || UCFG.ambulance).color;

  // ── FIX: when collapsing, tear down everything so re-open is a clean slate ──
  useEffect(() => {
    if (collapsed) {
      // Remove all unit markers from the dying map
      Object.values(miniMkrsRef.current).forEach(mkr => {
        try { mkr.setMap(null); } catch (_) { }
      });
      // Full reset — next open will recreate map + markers + fitBounds
      miniMkrsRef.current = {};
      miniMapObj.current = null;
      hasFitOnce.current = false;
    }
  }, [collapsed]);

  // ── Init map (runs on open / re-open) ────────────────────────────────────
  useEffect(() => {
    if (collapsed || !miniMapRef.current || miniMapObj.current || !window.google?.maps) return;

    const center = alertObj?.destination?.latitude
      ? { lat: alertObj.destination.latitude, lng: alertObj.destination.longitude }
      : { lat: 11.0168, lng: 76.9558 };

    miniMapObj.current = new window.google.maps.Map(miniMapRef.current, {
      center, zoom: 13, styles: DARK_MAP_STYLES,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      zoomControl: true, gestureHandling: 'greedy',
    });

    // Destination pin
    if (alertObj?.destination?.latitude) {
      const { latitude: dlat, longitude: dlng } = alertObj.destination;
      new window.google.maps.Marker({
        position: { lat: dlat, lng: dlng }, map: miniMapObj.current, zIndex: 90,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
              <path d="M14 0C6 0 0 6 0 14C0 25 14 36 14 36C14 36 28 25 28 14C28 6 22 0 14 0Z" fill="#E53935" stroke="white" stroke-width="2"/>
              <circle cx="14" cy="14" r="5" fill="white"/>
            </svg>`),
          scaledSize: new window.google.maps.Size(28, 36),
          anchor: new window.google.maps.Point(14, 36),
        },
      });
    }
  }, [collapsed, alertObj]);

  // ── Update unit markers ───────────────────────────────────────────────────
  // Only runs when miniMapObj.current exists (i.e. map is open and initialized)
  useEffect(() => {
    if (!miniMapObj.current || collapsed) return;

    const bounds = new window.google.maps.LatLngBounds();
    let hasLoc = false;

    if (alertObj?.destination?.latitude) {
      bounds.extend({ lat: alertObj.destination.latitude, lng: alertObj.destination.longitude });
    }

    dispatchedUnits.forEach(uid => {
      const loc = unitLocations[uid];
      if (!loc?.latitude) return;

      hasLoc = true;
      const lat = parseFloat(loc.latitude);
      const lng = parseFloat(loc.longitude);
      const type = unitTypes[uid] || 'ambulance';
      const ucfg = UCFG[type] || UCFG.ambulance;
      const isActive = uid === activeUnitId;

      const outerSize = isActive ? 44 : 30;
      const innerR = isActive ? 14 : 9;
      const ringR = isActive ? 20 : 0;
      const sw = isActive ? 3 : 1.5;
      const op = isActive ? 1 : 0.65;
      const zIdx = isActive ? 110 : 100;

      const svg = isActive
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="${outerSize}" height="${outerSize}" viewBox="0 0 ${outerSize} ${outerSize}">
            <defs><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="${ucfg.color}" flood-opacity="0.8"/></filter></defs>
            <circle cx="${outerSize / 2}" cy="${outerSize / 2}" r="${ringR}" fill="none" stroke="${ucfg.color}" stroke-width="2" opacity="0.4"/>
            <circle cx="${outerSize / 2}" cy="${outerSize / 2}" r="${innerR}" fill="${ucfg.color}" stroke="white" stroke-width="${sw}" opacity="${op}" filter="url(#s)"/>
            <text x="${outerSize / 2}" y="${outerSize / 2 + 6}" text-anchor="middle" font-size="16">${ucfg.icon}</text>
          </svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="${outerSize}" height="${outerSize}" viewBox="0 0 ${outerSize} ${outerSize}">
            <circle cx="${outerSize / 2}" cy="${outerSize / 2}" r="${innerR}" fill="${ucfg.color}" stroke="white" stroke-width="${sw}" opacity="${op}"/>
            <text x="${outerSize / 2}" y="${outerSize / 2 + 4}" text-anchor="middle" font-size="11">${ucfg.icon}</text>
          </svg>`;

      const icon = {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
        scaledSize: new window.google.maps.Size(outerSize, outerSize),
        anchor: new window.google.maps.Point(outerSize / 2, outerSize / 2),
      };

      bounds.extend({ lat, lng });

      if (!miniMkrsRef.current[uid]) {
        // Create fresh marker on the current map instance
        const mkr = new window.google.maps.Marker({
          position: { lat, lng },
          map: miniMapObj.current,
          zIndex: zIdx,
          icon,
        });
        mkr.addListener('click', () => onUnitClick && onUnitClick(uid));
        miniMkrsRef.current[uid] = mkr;
      } else {
        // Just update position + icon — never touch viewport
        miniMkrsRef.current[uid].setPosition({ lat, lng });
        miniMkrsRef.current[uid].setIcon(icon);
        miniMkrsRef.current[uid].setZIndex(zIdx);
      }
    });

    // fitBounds only on first real data after open/re-open
    if (!hasFitOnce.current && hasLoc && !bounds.isEmpty()) {
      try {
        miniMapObj.current.fitBounds(bounds, { padding: 32 });
        hasFitOnce.current = true;
      } catch (_) { }
    }
  }, [unitLocations, dispatchedUnits, activeUnitId, collapsed, unitTypes, alertObj, onUnitClick]);

  return (
    <div style={{ ...ns.miniWrap, border: `1.5px solid ${activeColor}55`, boxShadow: `0 4px 28px rgba(0,0,0,.6), 0 0 0 1px ${activeColor}22` }}>
      <div style={{ ...ns.miniHeader, borderBottom: `1px solid ${activeColor}33` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: '#E6EDF3', textTransform: 'uppercase', letterSpacing: 1 }}>🗺 All Units</span>
          <span style={{ fontSize: 8, fontWeight: 800, padding: '1px 6px', borderRadius: 4, background: `${activeColor}22`, color: activeColor, border: `1px solid ${activeColor}44` }}>{dispatchedUnits.length}</span>
        </div>
        <button
          onClick={() => setCollapsed(v => !v)}
          style={{ ...ns.miniToggleBtn, borderColor: `${activeColor}40`, color: activeColor }}
        >
          {collapsed ? '▲' : '▼'}
        </button>
      </div>
      {!collapsed && <div ref={miniMapRef} style={ns.miniCanvas} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TrackingLogPanel
// ─────────────────────────────────────────────────────────────────────────────
function TrackingLogPanel({ tLogs, dispatchedUnits, activeUnitId, unitTypes }) {
  const [logTab, setLogTab] = useState('all');
  const [customUnits, setCustomUnits] = useState(() => new Set());
  const [customOpen, setCustomOpen] = useState(false);
  const logBoxRef = useRef(null);

  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [tLogs]);

  const logColors = { info: '#8B949E', ok: '#34A853', warn: '#F9A825', error: '#E53935' };

  const filteredLogs = (() => {
    if (logTab === 'all') return tLogs;
    if (logTab === 'active') return tLogs.filter(l => !l.unitId || l.unitId === activeUnitId);
    if (logTab === 'custom') { if (customUnits.size === 0) return tLogs; return tLogs.filter(l => !l.unitId || customUnits.has(l.unitId)); }
    return tLogs;
  })();

  const toggleCustomUnit = uid => setCustomUnits(prev => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });

  return (
    <div style={{ ...s.section, flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={s.sectionLabel}>Tracking Log</div>
        <span style={{ fontSize: 9, color: '#8B949E', fontFamily: 'JetBrains Mono, monospace' }}>{filteredLogs.length} entries</span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, background: '#0D1117', borderRadius: 8, padding: 3, border: '1px solid #30363D' }}>
        {[{ key: 'all', label: 'All Units', icon: '📋' }, { key: 'active', label: 'Active Unit', icon: '🎯' }, { key: 'custom', label: 'Custom', icon: '⚙️' }].map(({ key, label, icon }) => (
          <button key={key} onClick={() => setLogTab(key)} style={{ flex: 1, padding: '5px 4px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'Sora, sans-serif', fontSize: 9, fontWeight: 700, background: logTab === key ? '#161B22' : 'transparent', color: logTab === key ? '#E6EDF3' : '#8B949E', boxShadow: logTab === key ? '0 1px 4px rgba(0,0,0,.4)' : 'none', transition: 'all .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            <span>{icon}</span><span>{label}</span>
          </button>
        ))}
      </div>
      {logTab === 'custom' && (
        <div style={{ marginBottom: 8 }}>
          <button onClick={() => setCustomOpen(v => !v)} style={{ width: '100%', padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(26,115,232,.3)', background: 'rgba(26,115,232,.08)', color: '#82B4FF', fontFamily: 'Sora, sans-serif', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>🔧 Select Units ({customUnits.size === 0 ? 'all' : customUnits.size} selected)</span>
            <span>{customOpen ? '▲' : '▼'}</span>
          </button>
          {customOpen && (
            <div style={{ marginTop: 6, background: '#0D1117', border: '1px solid #30363D', borderRadius: 8, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {dispatchedUnits.length === 0 && <div style={{ fontSize: 9, color: '#8B949E', textAlign: 'center', padding: '4px 0' }}>No units dispatched</div>}
              {dispatchedUnits.map(uid => {
                const ucfg = UCFG[unitTypes[uid] || 'ambulance'] || UCFG.ambulance;
                const checked = customUnits.has(uid);
                return (
                  <label key={uid} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 6px', borderRadius: 6, background: checked ? `${ucfg.color}11` : 'transparent', border: `1px solid ${checked ? ucfg.color + '44' : 'transparent'}` }}>
                    <div style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${checked ? ucfg.color : '#30363D'}`, background: checked ? ucfg.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {checked && <span style={{ fontSize: 9, color: 'white', lineHeight: 1 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 10 }}>{ucfg.icon}</span>
                    <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: checked ? ucfg.color : '#8B949E', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, whiteSpace: 'nowrap' }}>{uid}</span>
                    <input type="checkbox" checked={checked} onChange={() => toggleCustomUnit(uid)} style={{ display: 'none' }} />
                  </label>
                );
              })}
              <div style={{ display: 'flex', gap: 5, marginTop: 4, paddingTop: 4, borderTop: '1px solid #30363D' }}>
                <button onClick={() => setCustomUnits(new Set(dispatchedUnits))} style={{ flex: 1, padding: '3px 0', borderRadius: 5, border: '1px solid rgba(52,168,83,.3)', background: 'rgba(52,168,83,.08)', color: '#34A853', fontSize: 9, fontWeight: 700, cursor: 'pointer', fontFamily: 'Sora, sans-serif' }}>All</button>
                <button onClick={() => setCustomUnits(new Set())} style={{ flex: 1, padding: '3px 0', borderRadius: 5, border: '1px solid rgba(139,148,158,.3)', background: 'rgba(139,148,158,.08)', color: '#8B949E', fontSize: 9, fontWeight: 700, cursor: 'pointer', fontFamily: 'Sora, sans-serif' }}>Clear</button>
              </div>
            </div>
          )}
        </div>
      )}
      {logTab === 'active' && activeUnitId && (
        <div style={{ marginBottom: 6, padding: '4px 8px', borderRadius: 6, background: 'rgba(26,115,232,.08)', border: '1px solid rgba(26,115,232,.2)', fontSize: 9, fontWeight: 700, color: '#82B4FF', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span>🎯 Filtering:</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{activeUnitId}</span>
        </div>
      )}
      <div ref={logBoxRef} style={s.logBox}>
        {filteredLogs.length === 0
          ? <div style={{ color: '#8B949E', fontSize: 10, textAlign: 'center', paddingTop: 16 }}>No logs for selected filter</div>
          : filteredLogs.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 2, lineHeight: 1.5 }}>
              {l.unitId && (
                <span style={{ fontSize: 7, fontWeight: 800, flexShrink: 0, marginTop: 2, padding: '1px 4px', borderRadius: 3, background: `${(UCFG[unitTypes[l.unitId] || 'ambulance'] || UCFG.ambulance).color}22`, color: (UCFG[unitTypes[l.unitId] || 'ambulance'] || UCFG.ambulance).color, fontFamily: 'JetBrains Mono, monospace', border: `1px solid ${(UCFG[unitTypes[l.unitId] || 'ambulance'] || UCFG.ambulance).color}44`, maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.unitId.slice(0, 6)}</span>
              )}
              <span style={{ color: logColors[l.type] || '#8B949E', flex: 1 }}>{l.msg}</span>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function LiveTrackingPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const alertObj = location.state?.alert || JSON.parse(localStorage.getItem('alertHistory') || '[]').find(a => a.id === id) || null;

  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const vehMkrMap = useRef({});
  const destMkr = useRef(null);
  const polylinesRef = useRef([]);
  const routeDataRef = useRef([]);
  const routeAtRef = useRef(0);
  const lastVRef = useRef(null);
  const trafficLayerRef = useRef(null);
  const nearbyMkrsRef = useRef({});
  const infoWinRef = useRef(null);
  const nearbySearchCenter = useRef(null);
  const nearbyInFlight = useRef(false);
  const activeUnitIdRef = useRef(null);

  // Flicker-free mirror refs
  const lastTripStRef = useRef('');
  const trafficOnRef = useRef(false);
  const unitStatusesRef = useRef({});
  const dispatchedUnitsRef = useRef([]);
  const agentTicketRef = useRef(null);
  const ticketCompletedRef = useRef(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

  const [tripStatus, setTripStatus] = useState('idle');
  const [live, setLive] = useState(false);
  const [stats, setStats] = useState({ speed: 0, distM: 0, timeS: 0, lat: null, lng: null });
  const [trafficOn, setTrafficOn] = useState(false);
  const [stepInfo, setStepInfo] = useState({ idx: 0, total: 0 });
  const [routeData, setRouteData] = useState([]);
  const [bestRouteIdx, setBestRouteIdx] = useState(0);
  const [nearbyList, setNearbyList] = useState([]);
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const [nearbyPanelOpen, setNearbyPanelOpen] = useState(false);
  const [nearbyLayers, setNearbyLayers] = useState(Object.fromEntries(Object.keys(NEARBY_TYPES).map(k => [k, false])));
  const [nearbyCounts, setNearbyCounts] = useState(Object.fromEntries(Object.keys(NEARBY_TYPES).map(k => [k, 0])));
  const [tLogs, setTLogs] = useState([]);

  const [agentTicket, setAgentTicket] = useState(() => { const all = getAgentTickets(); return all.find(t => (t.alertIds || []).includes(id)) || null; });
  const [ticketStatus, setTicketStatus] = useState(() => { const all = getAgentTickets(); const t = all.find(tk => (tk.alertIds || []).includes(id)); return t?.status || alertObj?.status || 'dispatched'; });
  const [dispatchedUnits, setDispatchedUnits] = useState(() => { const all = getAgentTickets(); const t = all.find(tk => (tk.alertIds || []).includes(id)); if (t?.assignedUnits?.length) return t.assignedUnits; if (alertObj?.assignedUnit) return [alertObj.assignedUnit]; return []; });
  const [unitLocations, setUnitLocations] = useState({});
  const [unitStatuses, setUnitStatuses] = useState({});
  const [unitTypes, setUnitTypes] = useState({});
  const [activeUnitId, setActiveUnitId] = useState(() => { const all = getAgentTickets(); const t = all.find(tk => (tk.alertIds || []).includes(id)); return t?.assignedUnits?.[0] || alertObj?.assignedUnit || null; });

  // Keep refs in sync
  useEffect(() => { activeUnitIdRef.current = activeUnitId; }, [activeUnitId]);
  useEffect(() => { trafficOnRef.current = trafficOn; }, [trafficOn]);
  useEffect(() => { unitStatusesRef.current = unitStatuses; }, [unitStatuses]);
  useEffect(() => { dispatchedUnitsRef.current = dispatchedUnits; }, [dispatchedUnits]);
  useEffect(() => { agentTicketRef.current = agentTicket; }, [agentTicket]);
  useEffect(() => { if (ticketStatus === 'completed') ticketCompletedRef.current = true; }, []);

  const cfg = UCFG[alertObj?.vehicleType || 'ambulance'] || UCFG.ambulance;

  const addTLog = useCallback((msg, type = 'info', unitId = null) => {
    const ts = new Date().toLocaleTimeString();
    setTLogs(prev => [...prev.slice(-120), { msg: `[${ts}] ${msg}`, type, unitId }]);
  }, []);

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapObj.current || !window.google?.maps) return;
    mapObj.current = new window.google.maps.Map(mapRef.current, { center: { lat: 11.0168, lng: 76.9558 }, zoom: 13, styles: DARK_MAP_STYLES, mapTypeControl: false, streetViewControl: false });
    trafficLayerRef.current = new window.google.maps.TrafficLayer();
    infoWinRef.current = new window.google.maps.InfoWindow();
    addTLog(`📡 Tracking: ${cfg.icon} ${alertObj?.name || 'unknown'}`, 'ok');
  }, []);

  // Destination marker
  useEffect(() => {
    if (!mapObj.current || !alertObj?.destination?.latitude) return;
    const { latitude: dlat, longitude: dlng } = alertObj.destination;
    if (destMkr.current) destMkr.current.setMap(null);
    destMkr.current = new window.google.maps.Marker({
      position: { lat: dlat, lng: dlng }, map: mapObj.current, zIndex: 90,
      icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 0C7 0 0 7 0 16C0 28 16 40 16 40C16 40 32 28 32 16C32 7 25 0 16 0Z" fill="${cfg.color}" stroke="white" stroke-width="2"/><circle cx="16" cy="16" r="6" fill="white"/></svg>`), scaledSize: new window.google.maps.Size(32, 40), anchor: new window.google.maps.Point(16, 40) },
    });
  }, []);

  const fetchRoute = useCallback(async (lat, lng, uid) => {
    if (uid !== activeUnitIdRef.current) return;
    if (!alertObj?.destination?.latitude || !mapObj.current) return;

    const dest = alertObj.destination;

    // ── STEP 1: Always fetch multiple routes via Directions API ──────────────
    // This gives us the light-blue alternate routes visual
    let parsed = [];
    try {
      const res = await getDirections(lat, lng, dest.latitude, dest.longitude);
      if (uid !== activeUnitIdRef.current) return;

      const routes = res.data?.routes;
      if (routes?.length) {
        parsed = routes.map((r, i) => {
          const leg = r.legs[0];
          return {
            fp: stitch(leg.steps), steps: leg.steps,
            durationS: leg.duration.value,
            trafficS: leg.duration_in_traffic?.value ?? leg.duration.value,
            distanceM: leg.distance.value,
            summary: r.summary || `Route ${i + 1}`,
          };
        }).sort((a, b) => a.trafficS - b.trafficS);

        routeDataRef.current = parsed;
        setRouteData(parsed);
        setBestRouteIdx(0);
      }
    } catch (e) {
      console.warn('[fetchRoute] Directions API error:', e);
    }

    // Clear old polylines
    polylinesRef.current.forEach(r => { r.out?.setMap(null); r.poly?.setMap(null); });
    polylinesRef.current = [];

    // ── STEP 2: Draw all routes — best in blue, alternates in light blue ─────
    parsed.forEach((r, i) => {
      if (!r.fp?.length) return;
      const isBest = i === 0;
      const opacity = isBest ? 1 : 0.45;
      const weight = isBest ? 9 : 5;
      const color = isBest ? '#1A73E8' : '#90CAF9';   // ← light blue for alts
      const outW = isBest ? 15 : 9;

      const out = new window.google.maps.Polyline({
        path: r.fp, geodesic: true, map: mapObj.current,
        strokeColor: '#FFFFFF', strokeOpacity: opacity * 0.9,
        strokeWeight: outW, zIndex: isBest ? 8 : 3,
      });
      const poly = new window.google.maps.Polyline({
        path: r.fp, geodesic: true, map: mapObj.current,
        strokeColor: color, strokeOpacity: opacity,
        strokeWeight: weight, zIndex: isBest ? 9 : 4,
      });
      polylinesRef.current.push({ out, poly, fp: r.fp });

      // Make alternate routes clickable to switch
      if (!isBest) {
        poly.addListener('click', () => {
          // Re-sort so clicked route becomes "best"
          const reordered = [r, ...parsed.filter(x => x !== r)];
          routeDataRef.current = reordered;
          setRouteData(reordered);
          setBestRouteIdx(0);
          // Redraw with new best
          fetchRoute(lat, lng, uid);
        });
      }
    });

    // Log Directions API result
    if (parsed.length > 0) {
      const best = parsed[0];
      const tr = trafficRatio(best.durationS, best.trafficS);
      const tl = trafficLabel(tr);
      addTLog(
        `🛣️ ${fmtDist(best.distanceM)} · ${fmtTime(best.trafficS)} · ${tl.emoji} ${tl.label} (${parsed.length} routes)`,
        'info', uid
      );
    }

    // ── STEP 3: Overlay real per-segment traffic from Routes API v2 ──────────
    // Only applied to the BEST route polyline
    const v2 = await fetchRoutesV2(lat, lng, dest.latitude, dest.longitude);
    if (uid !== activeUnitIdRef.current) return;

    if (v2?.intervals?.length > 0) {
      console.log(`[fetchRoute] ✅ Overlaying ${v2.intervals.length} v2 traffic segments on best route`);

      // Decode v2's own polyline (may differ slightly from Directions API)
      const v2path = decPoly(v2.encoded);

      let overlayCount = 0;
      v2.intervals.forEach((seg, i) => {
        const color = speedToColor(seg.speed);
        if (!color) return;

        const start = seg.startPolylinePointIndex || 0;
        let end;
        if (seg.endPolylinePointIndex != null) {
          end = seg.endPolylinePointIndex;
        } else if (v2.intervals[i + 1]) {
          end = v2.intervals[i + 1].startPolylinePointIndex - 1;
        } else {
          end = v2path.length - 1;
        }

        const segPath = v2path.slice(start, end + 1);
        if (segPath.length < 2) return;

        const segOut = new window.google.maps.Polyline({
          path: segPath, map: mapObj.current,
          strokeColor: '#FFFFFF', strokeOpacity: 0.35, strokeWeight: 15, zIndex: 12,
        });
        const segPoly = new window.google.maps.Polyline({
          path: segPath, map: mapObj.current,
          strokeColor: color, strokeOpacity: 0.95, strokeWeight: 9, zIndex: 13,
        });
        polylinesRef.current.push({ out: segOut, poly: segPoly, fp: segPath });
        overlayCount++;
      });

      const delay = Math.max(0, v2.trafSec - v2.durSec);
      addTLog(
        `🚦 [v2] Real traffic: ${overlayCount} congested segments${delay > 60 ? ` · +${Math.round(delay / 60)}min delay` : ''}`,
        overlayCount > 0 ? 'warn' : 'ok', uid
      );
    }

    // Fit map to best route bounds
    if (parsed[0]?.fp?.length) {
      const bounds = new window.google.maps.LatLngBounds();
      parsed[0].fp.forEach(p => bounds.extend(p));
      if (destMkr.current) bounds.extend(destMkr.current.getPosition());
      if (!bounds.isEmpty()) mapObj.current.fitBounds(bounds, { top: 80, bottom: 40, left: 20, right: 20 });
    }

  }, [alertObj, addTLog]);

  const updateVehicle = useCallback((lat, lng, uid) => {
    if (!mapObj.current || uid !== activeUnitIdRef.current) return;
    const pos = { lat, lng };
    if (!vehMkrMap.current[uid]) {
      const mkr = new window.google.maps.Marker({
        position: pos, map: mapObj.current, zIndex: 100,
        icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="${cfg.color}" stroke="white" stroke-width="2.5"/><text x="22" y="28" text-anchor="middle" font-size="20">${cfg.icon}</text></svg>`), scaledSize: new window.google.maps.Size(44, 44), anchor: new window.google.maps.Point(22, 22) },
      });
      vehMkrMap.current[uid] = mkr;
      addTLog(`${cfg.icon} Unit on map [${uid}]`, 'ok', uid);
      setTimeout(() => {
        if (uid !== activeUnitIdRef.current) return;
        const b = new window.google.maps.LatLngBounds();
        if (vehMkrMap.current[uid]) b.extend(vehMkrMap.current[uid].getPosition());
        if (destMkr.current) b.extend(destMkr.current.getPosition());
        if (!b.isEmpty()) mapObj.current.fitBounds(b);
      }, 600);
    } else {
      vehMkrMap.current[uid].setPosition(pos);
    }
    if (lastVRef.current) {
      const { lat: plat, lng: plng } = lastVRef.current;
      if (Math.abs(lat - plat) > 0.0001 || Math.abs(lng - plng) > 0.0001) mapObj.current.panTo(pos);
    }
    lastVRef.current = { lat, lng };
  }, [cfg, addTLog]);

  const fetchNearby = useCallback(async (lat, lng) => {
    if (!mapObj.current || nearbyInFlight.current) return;
    if (nearbySearchCenter.current) { const d = haversine(lat, lng, nearbySearchCenter.current.lat, nearbySearchCenter.current.lng); if (d < 500) return; }
    nearbyInFlight.current = true; nearbySearchCenter.current = { lat, lng };
    try {
      const searches = Object.entries(NEARBY_TYPES).map(([key, cfg]) => new Promise(resolve => { const svc = new window.google.maps.places.PlacesService(mapObj.current); svc.nearbySearch({ location: { lat, lng }, radius: cfg.radius, type: cfg.placeType }, (results, status) => { if (status === window.google.maps.places.PlacesServiceStatus.OK && results) resolve({ key, places: results.map(p => ({ name: p.name, lat: p.geometry.location.lat(), lng: p.geometry.location.lng(), vicinity: p.vicinity || '', rating: p.rating || null, place_id: p.place_id })) }); else resolve({ key, places: [] }); }); }));
      const results = await Promise.allSettled(searches); const counts = {}, allPlaces = [];
      results.forEach(r => { if (r.status !== 'fulfilled') return; const { key, places } = r.value; counts[key] = places.length; if (nearbyMkrsRef.current[key]) nearbyMkrsRef.current[key].forEach(m => m.setMap(null)); nearbyMkrsRef.current[key] = []; places.forEach(p => { const nc = NEARBY_TYPES[key]; const mk = new window.google.maps.Marker({ position: { lat: p.lat, lng: p.lng }, map: nearbyLayers[key] ? mapObj.current : null, title: p.name, zIndex: 20, icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${nc.color}" stroke="white" stroke-width="2"/><text x="16" y="21" text-anchor="middle" font-size="14">${nc.emoji}</text></svg>`), scaledSize: new window.google.maps.Size(32, 32), anchor: new window.google.maps.Point(16, 16) } }); mk.addListener('click', () => { const d = haversine(lat, lng, p.lat, p.lng); infoWinRef.current.setContent(`<div style="font-family:Sora,sans-serif;padding:8px;min-width:180px;"><div style="font-weight:800;font-size:13px;margin-bottom:5px;">${nc.emoji} ${p.name}</div><div style="font-size:11px;color:#555;margin-bottom:5px;">${p.vicinity}</div><div style="display:flex;gap:8px;font-size:11px;margin-bottom:6px;"><span style="color:#1E88E5;font-weight:700;">${fmtDist(d)}</span>${p.rating ? `<span>⭐ ${p.rating}</span>` : ''}</div><button onclick="window.open('https://www.google.com/maps/search/?api=1&query_place_id=${p.place_id}','_blank')" style="width:100%;background:${nc.color};color:#fff;border:none;border-radius:7px;padding:7px;font-size:11px;font-weight:700;cursor:pointer;">📍 Open Maps</button></div>`); infoWinRef.current.open(mapObj.current, mk); }); nearbyMkrsRef.current[key].push(mk); const d = haversine(lat, lng, p.lat, p.lng); allPlaces.push({ ...p, d, cfg: NEARBY_TYPES[key] }); }); });
      setNearbyCounts(prev => ({ ...prev, ...counts })); allPlaces.sort((a, b) => a.d - b.d); setNearbyList(allPlaces.slice(0, 20));
    } catch (_) { }
    nearbyInFlight.current = false;
  }, [nearbyLayers]);

  const toggleNearbyLayer = key => { setNearbyLayers(prev => { const next = { ...prev, [key]: !prev[key] }; if (nearbyMkrsRef.current[key]) nearbyMkrsRef.current[key].forEach(m => m.setMap(next[key] ? mapObj.current : null)); return next; }); };

  // Main poll
  useEffect(() => {
    const myUid = activeUnitId;
    const poll = async () => {
      if (activeUnitIdRef.current !== myUid) return;
      try {
        const res = await getAmbulanceLocation(myUid);
        if (activeUnitIdRef.current !== myUid) return;
        const d = res.data, ts = d.tripStatus || 'idle';
        setUnitStatuses(prev => prev[myUid] === ts ? prev : { ...prev, [myUid]: ts });
        setTripStatus(ts);
        setStepInfo({ idx: parseInt(d.stepIdx) || 0, total: parseInt(d.totalSteps) || 0 });
        if (ts !== lastTripStRef.current) {
          lastTripStRef.current = ts;
          const emoji = { dispatched: '🚨', en_route: '🚑', on_action: '🔵', arrived: '🏁', completed: '✅', abandoned: '🚫', idle: '⏸' }[ts] || '🔄';
          addTLog(`${emoji} → ${TRIP_STATUS_CFG[ts]?.t || ts} [${myUid || 'unit'}]`, ts === 'arrived' || ts === 'completed' ? 'ok' : ts === 'abandoned' ? 'error' : 'info', myUid);
          if ((ts === 'en_route' || ts === 'on_action') && !trafficOnRef.current && trafficLayerRef.current && mapObj.current) {
            trafficLayerRef.current.setMap(mapObj.current); setTrafficOn(true);
            addTLog('🚦 Traffic layer auto-enabled', 'ok', myUid);
          }
          if (ts === 'completed' && !ticketCompletedRef.current) {
            const ticket = agentTicketRef.current;
            const units = dispatchedUnitsRef.current;
            if (ticket?.id && units.length > 0) {
              const allDone = units.every(uid => uid === myUid ? true : (unitStatusesRef.current[uid] === 'completed'));
              if (allDone) {
                ticketCompletedRef.current = true;
                setTimeout(() => {
                  updateAgentTicketStatus(ticket.id, 'completed');
                  const fresh = getAgentTickets().find(t => t.id === ticket.id);
                  (fresh?.alertIds || []).forEach(aid => updateAlertHistoryStatus(aid, 'completed'));
                  window.dispatchEvent(new Event('agentTicketsChange'));
                  setTicketStatus('completed');
                  addTLog('🎯 All units completed → ticket auto-completed', 'ok');
                }, 0);
              }
            }
          }
        }
        if (!d.latitude || !d.longitude) { setLive(false); return; }
        const lat = parseFloat(d.latitude), lng = parseFloat(d.longitude);
        setLive(true);
        setStats({ speed: parseFloat(d.speed) || 0, distM: parseInt(d.remainingDistM) || 0, timeS: parseInt(d.remainingTimeS) || 0, lat, lng });
        updateVehicle(lat, lng, myUid);
        const now = Date.now();
        if (alertObj?.destination && now - routeAtRef.current > 45000) { routeAtRef.current = now; fetchRoute(lat, lng, myUid); }
        fetchNearby(lat, lng);
      } catch (_) { if (activeUnitIdRef.current === myUid) setLive(false); }
    };
    poll();
    const iv = setInterval(poll, 3000); // 3s — near-realtime but not flooding (was 1s)
    return () => clearInterval(iv);
  }, [activeUnitId, updateVehicle, fetchRoute, fetchNearby, alertObj, addTLog]);

  // All-units poll (stable interval, reads via refs)
  useEffect(() => {
    const pollUnits = async () => {
      const units = dispatchedUnitsRef.current;
      if (!units.length) return;
      try {
        const res = await axios.get(`${BASE}/all-locations`);
        const allLocs = res.data?.data || [];
        console.log("ALL LOCATIONS:", allLocs);
        const newLocs = {}, newTypes = {};
        allLocs.forEach(u => {
          if (units.includes(u.id)) {
            newLocs[u.id] = { latitude: u.latitude, longitude: u.longitude, speed: u.speed };
            newTypes[u.id] = u.type || 'ambulance';
          }
        });
        setUnitLocations(prev => {
          const moved = units.some(uid => { const p = prev[uid], n = newLocs[uid]; if (!p && !n) return false; if (!p || !n) return true; return p.latitude !== n.latitude || p.longitude !== n.longitude; });
          return moved ? { ...prev, ...newLocs } : prev;
        });
        setUnitTypes(prev => { const ch = Object.entries(newTypes).some(([k, v]) => prev[k] !== v); return ch ? { ...prev, ...newTypes } : prev; });

        const newStatuses = {};
        for (const uid of units) {
          try {
            const r = await getAmbulanceLocation(uid);
            const sa = r.data;
            if (sa) {
              //const ts = sa.tripStatus ?? unitStatusesRef.current[uid];
              const ts = sa.tripStatus;
              console.log("📡 UNIT STATUS FETCH:", uid, sa?.tripStatus);
              if (!ts) continue;
              newStatuses[uid] = ts;
              if (ts !== unitStatusesRef.current[uid]) {
                const emoji = { dispatched: '🚨', en_route: '🚑', on_action: '🔵', arrived: '🏁', completed: '✅', abandoned: '🚫', idle: '⏸' }[ts] || '🔄';
                addTLog(`${emoji} Unit ${uid.slice(0, 8)} → ${ts}`, ts === 'completed' || ts === 'arrived' ? 'ok' : ts === 'abandoned' ? 'error' : 'info', uid);
              }
              if (sa.id) updateAlertHistoryStatus(sa.id, ts);
            }
          } catch (_) { }
        }

        setUnitStatuses(prev => {
          const next = { ...prev, ...newStatuses };

          console.log("🔥 ALL UNITS UPDATED:", next);

          // ✅ ticket completion logic (keep this)
          if (!ticketCompletedRef.current) {
            const ticket = agentTicketRef.current;
            const units = dispatchedUnitsRef.current;

            if (ticket?.id && units.length > 0) {
              const allDone = units.every(uid => next[uid] === 'completed');

              if (allDone) {
                ticketCompletedRef.current = true;

                setTimeout(() => {
                  updateAgentTicketStatus(ticket.id, 'completed');

                  const fresh = getAgentTickets().find(t => t.id === ticket.id);
                  (fresh?.alertIds || []).forEach(aid =>
                    updateAlertHistoryStatus(aid, 'completed')
                  );

                  window.dispatchEvent(new Event('agentTicketsChange'));
                  setTicketStatus('completed');

                  addTLog('🎯 All units completed → ticket auto-completed', 'ok');
                }, 0);
              }
            }
          }

          return next;   // ✅ ONLY ONE RETURN
        });
      } catch (_) { }
    };
    pollUnits();
    const iv = setInterval(pollUnits, 10000);
    return () => clearInterval(iv);
  }, [addTLog]);

  // Sync external agentTickets changes
  useEffect(() => {
    const refresh = () => {
      const all = getAgentTickets();
      const t = all.find(tk => (tk.alertIds || []).includes(id));
      if (t) {
        setAgentTicket(t);
        if (t.status === 'completed') ticketCompletedRef.current = true;
        setTicketStatus(t.status || 'dispatched');
        if (t.assignedUnits?.length) setDispatchedUnits(t.assignedUnits);
      }
    };
    window.addEventListener('agentTicketsChange', refresh);
    return () => window.removeEventListener('agentTicketsChange', refresh);
  }, [id]);

  // Switch active unit
  const handleSwitchUnit = useCallback((uid) => {
    if (uid === activeUnitIdRef.current) return;
    activeUnitIdRef.current = uid;
    lastTripStRef.current = '';
    setActiveUnitId(uid);
    Object.entries(vehMkrMap.current).forEach(([muid, mkr]) => { if (muid !== uid) mkr.setMap(null); });
    if (vehMkrMap.current[uid]) { vehMkrMap.current[uid].setMap(null); delete vehMkrMap.current[uid]; }
    polylinesRef.current.forEach(r => { r.out?.setMap(null); r.poly?.setMap(null); });
    polylinesRef.current = []; routeAtRef.current = 0; lastVRef.current = null;
    setLive(false); setTripStatus('idle');
    setStats({ speed: 0, distM: 0, timeS: 0, lat: null, lng: null }); setRouteData([]); setStepInfo({ idx: 0, total: 0 });
    setUnitLocations(prev => {
      const loc = prev[uid];
      if (loc?.latitude && mapObj.current) { mapObj.current.panTo({ lat: parseFloat(loc.latitude), lng: parseFloat(loc.longitude) }); mapObj.current.setZoom(15); }
      return prev;
    });
    addTLog(`🔄 Switched live tracking → ${uid}`, 'info', uid);
  }, [addTLog]);

  const handleMiniMapUnitClick = useCallback(uid => handleSwitchUnit(uid), [handleSwitchUnit]);
  const toggleTraffic = () => { if (!mapObj.current || !trafficLayerRef.current) return; const next = !trafficOn; setTrafficOn(next); trafficLayerRef.current.setMap(next ? mapObj.current : null); addTLog(`🚦 Traffic ${next ? 'ON' : 'OFF'}`, next ? 'ok' : 'info'); };
  const centerOnVehicle = () => { if (!mapObj.current || !lastVRef.current) return; mapObj.current.panTo(lastVRef.current); mapObj.current.setZoom(16); };
  const fitAll = () => { if (!mapObj.current) return; const b = new window.google.maps.LatLngBounds(); const aUid = activeUnitIdRef.current; if (aUid && vehMkrMap.current[aUid]) b.extend(vehMkrMap.current[aUid].getPosition()); if (destMkr.current) b.extend(destMkr.current.getPosition()); if (!b.isEmpty()) mapObj.current.fitBounds(b); };

  const tsCfg = TRIP_STATUS_CFG[tripStatus] || TRIP_STATUS_CFG.idle;
  const lcIdx = LIFECYCLE_ORDER.indexOf(tripStatus);
  const hrs = Math.floor(stats.timeS / 3600), mins = Math.round((stats.timeS % 3600) / 60);
  const etaStr = stats.timeS <= 0 ? '—' : hrs === 0 ? mins + ' min' : hrs + 'hr ' + mins + 'm';
  const arrivalStr = stats.timeS > 0 ? (() => { const ar = new Date(Date.now() + stats.timeS * 1000); let ah = ar.getHours(), am = ar.getMinutes(), ap = ah >= 12 ? 'PM' : 'AM'; ah = ah % 12 || 12; return ah + ':' + am.toString().padStart(2, '0') + ' ' + ap; })() : '—';

  return (
    <div style={s.root}>
      <div style={s.mapWrap}>
        <div style={s.topBar}>
          <button style={s.backBtn} onClick={() => navigate('/alerts')}>← Back</button>
          <div style={s.alertPill}>
            <span style={{ fontSize: 19 }}>{cfg.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.lapName}>{cfg.icon} {alertObj?.name || '—'}</div>
              <div style={s.lapSub}>{cfg.label} · {(alertObj?.severity || '').toUpperCase()} · {alertObj?.address || '—'}</div>
            </div>
            <div style={{ ...s.liveBadge, ...(live ? s.liveBadgeOn : s.liveBadgeOff) }}>
              <span style={{ ...s.liveDot, background: live ? '#34A853' : '#8B949E', animation: live ? 'livePulse 1.2s infinite' : 'none' }} />
              {live ? `🔴 LIVE · ${activeUnitId || ''}` : 'Waiting…'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <ChatTriggerButton open={chatOpen} onClick={() => setChatOpen(true)} unread={chatUnread} />
            <button style={s.backBtn} onClick={centerOnVehicle}>🎯 Center</button>
            <button style={s.backBtn} onClick={fitAll}>⛶ Fit</button>
            <button style={{ ...s.backBtn, ...(trafficOn ? s.trafficOn : s.trafficOff) }} onClick={toggleTraffic}>🚦 Traffic: {trafficOn ? 'ON' : 'OFF'}</button>
          </div>
        </div>

        <TicketDetailsOverlay
          alertObj={alertObj} agentTicket={agentTicket} ticketStatus={ticketStatus}
          dispatchedUnits={dispatchedUnits} unitStatuses={unitStatuses} unitTypes={unitTypes}
          activeUnitId={activeUnitId} onSwitchUnit={handleSwitchUnit}
        />

        <div style={s.nearbyLeg}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={s.nearbyLegTitle}>📍 Nearby Places</div>
            <button onClick={() => setNearbyOpen(v => !v)} style={{ background: 'transparent', border: 'none', color: '#8B949E', cursor: 'pointer', fontSize: 12 }}>{nearbyOpen ? '▼' : '▲'}</button>
          </div>
          {nearbyOpen && Object.entries(NEARBY_TYPES).map(([key, nc]) => (
            <div key={key} style={s.ntRow} onClick={() => toggleNearbyLayer(key)}>
              <div style={s.ntLeft}><span style={{ fontSize: 14 }}>{nc.icon}</span><span style={s.ntLabel}>{nc.label}</span><span style={s.ntCount}>{nearbyCounts[key] || 0}</span></div>
              <button style={{ ...s.ntSw, background: nearbyLayers[key] ? '#1A73E8' : '#30363D' }}><span style={{ ...s.ntSwKnob, left: nearbyLayers[key] ? 14 : 2 }} /></button>
            </div>
          ))}
        </div>

        <MiniMapOverlay
          alertObj={alertObj} dispatchedUnits={dispatchedUnits} unitLocations={unitLocations}
          unitTypes={unitTypes} onUnitClick={handleMiniMapUnitClick} activeUnitId={activeUnitId}
        />

        {!live && (
          <div style={s.noLocMsg}>
            <div style={{ fontSize: 52, opacity: .18 }}>{cfg.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Waiting for unit to accept alert</div>
            <div style={{ fontSize: 11, opacity: .6, maxWidth: 240, textAlign: 'center' }}>Live position appears once the unit is moving</div>
          </div>
        )}
        <div ref={mapRef} style={{ ...s.map, display: live ? 'block' : 'none' }} />
      </div>

      <div style={s.side}>
        <div style={s.section}>
          <div style={s.lcStrip}>
            {LIFECYCLE_ORDER.map((st, i) => {
              const isDone = i < lcIdx, isActive = i === lcIdx;
              return (
                <React.Fragment key={st}>
                  <div style={s.lcStep}><div style={{ ...s.lcDot, background: isDone ? '#34A853' : isActive ? '#1A73E8' : '#30363D' }} /><div style={s.lcLabel}>{st.replace('_', ' ')}</div></div>
                  {i < LIFECYCLE_ORDER.length - 1 && <div style={{ ...s.lcConn, background: i < lcIdx ? '#34A853' : i === lcIdx ? '#1A73E8' : '#30363D' }} />}
                </React.Fragment>
              );
            })}
          </div>
          <div style={{ ...s.tsb, background: tsCfg.bg, borderColor: tsCfg.brd, color: tsCfg.c }}>
            <span style={{ fontSize: 24, flexShrink: 0 }}>{tsCfg.i}</span>
            <div><div style={{ fontSize: 14, fontWeight: 800 }}>{tsCfg.t}</div><div style={{ fontSize: 10, marginTop: 2, opacity: .7 }}>{tsCfg.s}</div></div>
          </div>
        </div>

        {stepInfo.total > 0 && (tripStatus === 'en_route' || tripStatus === 'on_action') && (
          <div style={s.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8B949E', marginBottom: 5 }}>
              <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.7px' }}>Navigation</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#1A73E8' }}>Step {stepInfo.idx + 1}/{stepInfo.total}</span>
            </div>
            <div style={{ height: 5, background: 'rgba(255,255,255,.07)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: 5, borderRadius: 3, background: 'linear-gradient(90deg,#1A73E8,#34A853)', transition: 'width .8s', width: Math.min(100, ((stepInfo.idx + 1) / stepInfo.total * 100)).toFixed(0) + '%' }} />
            </div>
          </div>
        )}

        <div style={{ ...s.section, ...s.infoGrid }}>
          {[
            { label: 'Status', val: live ? '🟢 Online' : '⚫ Offline', cls: live ? 'green' : '' },
            { label: 'Updated', val: new Date().toLocaleTimeString(), cls: 'blue' },
            { label: 'Latitude', val: stats.lat?.toFixed(5) || '—', cls: '' },
            { label: 'Longitude', val: stats.lng?.toFixed(5) || '—', cls: '' },
            { label: '🏎 Speed', val: stats.speed.toFixed(1) + ' km/h', cls: 'green', bar: Math.min(100, (stats.speed / 120) * 100) },
            { label: '📏 Dist', val: stats.distM > 0 ? fmtDist(stats.distM) : '—', cls: 'blue' },
            { label: '⏱ ETA', val: etaStr, cls: 'yellow' },
            { label: '🕐 Arrival', val: arrivalStr, cls: '' },
          ].map(item => (
            <div key={item.label} style={s.infoStat}>
              <div style={s.infoLabel}>{item.label}</div>
              <div style={{ ...s.infoVal, color: item.cls === 'green' ? '#34A853' : item.cls === 'blue' ? '#1A73E8' : item.cls === 'yellow' ? '#F9A825' : '#E6EDF3' }}>{item.val}</div>
              {item.bar !== undefined && <div style={{ marginTop: 5, height: 3, background: 'rgba(255,255,255,.08)', borderRadius: 2, overflow: 'hidden' }}><div style={{ height: 3, borderRadius: 2, background: stats.speed > 90 ? '#E53935' : stats.speed > 60 ? '#F9A825' : '#34A853', transition: 'width .8s', width: item.bar + '%' }} /></div>}
            </div>
          ))}
        </div>

        <div style={s.section}>
          <div style={s.sectionLabel}>Incident Details</div>
          {[{ lbl: 'Unit Type', val: cfg.label }, { lbl: 'Severity', val: (alertObj?.severity || '').toUpperCase() }, { lbl: 'Contact', val: alertObj?.phone || '—' }, { lbl: 'Destination', val: alertObj?.destination ? `${alertObj.destination.latitude?.toFixed(4)}, ${alertObj.destination.longitude?.toFixed(4)}` : '—' }, { lbl: 'Notes', val: alertObj?.notes || '—' }].map(({ lbl, val }) => (
            <div key={lbl} style={s.aiRow}><span style={s.aiLbl}>{lbl}</span><span style={s.aiVal}>{val}</span></div>
          ))}
        </div>

        <div style={{ ...s.section, borderBottom: '1px solid #30363D' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={s.sectionLabel}>🏥 Nearby Places</div>
            <button onClick={() => setNearbyPanelOpen(v => !v)} style={{ background: 'transparent', border: 'none', color: '#8B949E', cursor: 'pointer' }}>{nearbyPanelOpen ? '▼' : '▲'}</button>
          </div>
          {nearbyPanelOpen && (nearbyList.length === 0
            ? <div style={{ textAlign: 'center', padding: 12, color: '#8B949E', fontSize: 11 }}>{live ? '🔍 Searching…' : 'Waiting for unit location…'}</div>
            : nearbyList.map((p, i) => (<div key={i} style={s.npItem}><span style={{ fontSize: 16 }}>{p.cfg.icon}</span><div style={{ flex: 1 }}><div style={s.npName}>{p.name}</div><div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#8B949E' }}><span>📏 {fmtDist(p.d)}</span><span>{p.cfg.label}</span></div></div></div>))
          )}
          <button style={s.refreshBtn} onClick={() => { nearbySearchCenter.current = null; if (lastVRef.current) fetchNearby(lastVRef.current.lat, lastVRef.current.lng); }}>↻ Refresh Nearby</button>
        </div>

        <TrackingLogPanel tLogs={tLogs} dispatchedUnits={dispatchedUnits} activeUnitId={activeUnitId} unitTypes={unitTypes} />
      </div>

      <GlobalChatPanel 
        open={chatOpen} 
        onClose={() => setChatOpen(false)} 
        onUnreadChange={setChatUnread} 
      />

      <style>{`@keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.6)}}`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const s = {
  root: { position: 'fixed', inset: 0, zIndex: 100, background: '#0D1117', display: 'flex', flexDirection: 'row' },
  mapWrap: { flex: 1, position: 'relative' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', background: 'linear-gradient(180deg,rgba(13,17,23,.95) 0%,transparent 100%)', pointerEvents: 'none' },
  backBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, background: '#161B22', border: '1px solid #30363D', color: '#E6EDF3', fontFamily: 'Sora, sans-serif', fontSize: 12, fontWeight: 700, cursor: 'pointer', pointerEvents: 'auto' },
  alertPill: { flex: 1, display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(22,27,34,.9)', border: '1px solid #30363D', borderRadius: 11, padding: '8px 14px', backdropFilter: 'blur(8px)', pointerEvents: 'auto' },
  lapName: { fontSize: 12, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  lapSub: { fontSize: 10, color: '#8B949E', marginTop: 1 },
  liveBadge: { display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 18, padding: '4px 11px', fontSize: 11, fontWeight: 700, border: '1px solid', flexShrink: 0 },
  liveBadgeOn: { background: 'rgba(52,168,83,.15)', borderColor: 'rgba(52,168,83,.3)', color: '#34A853' },
  liveBadgeOff: { background: 'rgba(139,148,158,.1)', borderColor: 'rgba(139,148,158,.2)', color: '#8B949E' },
  liveDot: { width: 6, height: 6, borderRadius: '50%', display: 'inline-block' },
  trafficOff: { background: 'rgba(229,57,53,.12)', borderColor: 'rgba(229,57,53,.3)', color: '#FF8A80' },
  trafficOn: { background: 'rgba(52,168,83,.18)', borderColor: 'rgba(52,168,83,.4)', color: '#69F0AE', boxShadow: '0 0 10px rgba(52,168,83,.25)' },
  nearbyLeg: { position: 'absolute', bottom: 20, left: 16, zIndex: 20, background: 'rgba(13,17,23,.92)', border: '1px solid #30363D', borderRadius: 12, padding: '10px 14px', backdropFilter: 'blur(8px)', minWidth: 200 },
  nearbyLegTitle: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#8B949E', marginBottom: 8 },
  ntRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, cursor: 'pointer', padding: '3px 0' },
  ntLeft: { display: 'flex', alignItems: 'center', gap: 7 },
  ntLabel: { fontSize: 11, fontWeight: 600, color: '#E6EDF3' },
  ntCount: { fontSize: 9, fontWeight: 700, color: '#8B949E', marginLeft: 4 },
  ntSw: { width: 28, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 },
  ntSwKnob: { position: 'absolute', top: 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left .2s' },
  noLocMsg: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0D1117', color: '#8B949E', gap: 10 },
  map: { width: '100%', height: '100%' },
  side: { width: 340, flexShrink: 0, overflowY: 'auto', background: '#161B22', borderLeft: '1px solid #30363D', display: 'flex', flexDirection: 'column' },
  section: { padding: '14px 18px', borderBottom: '1px solid #30363D' },
  lcStrip: { display: 'flex', alignItems: 'center', background: '#0D1117', border: '1px solid #30363D', borderRadius: 9, padding: '9px 11px', marginBottom: 10, overflowX: 'auto' },
  lcStep: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1, minWidth: 0 },
  lcDot: { width: 9, height: 9, borderRadius: '50%', transition: 'background .4s' },
  lcLabel: { fontSize: 8, color: '#8B949E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.3px', whiteSpace: 'nowrap' },
  lcConn: { width: '100%', height: 2, flex: 1, margin: '0 2px', alignSelf: 'center', marginBottom: 12, transition: 'background .4s' },
  tsb: { padding: '12px 14px', borderRadius: 11, display: 'flex', alignItems: 'center', gap: 10, border: '1px solid', transition: 'all .4s' },
  sectionLabel: { fontSize: 10, fontWeight: 700, color: '#8B949E', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  infoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  infoStat: { background: '#0D1117', border: '1px solid #30363D', borderRadius: 9, padding: '10px 12px' },
  infoLabel: { fontSize: 9, color: '#8B949E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 4 },
  infoVal: { fontSize: 17, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace' },
  aiRow: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #30363D', fontSize: 11 },
  aiLbl: { color: '#8B949E', fontWeight: 600 },
  aiVal: { fontWeight: 700, textAlign: 'right', maxWidth: 190, wordBreak: 'break-word' },
  npItem: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(48,54,61,.5)', cursor: 'pointer' },
  npName: { fontSize: 11, fontWeight: 700, color: '#E6EDF3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  refreshBtn: { width: '100%', marginTop: 8, padding: 7, borderRadius: 8, border: '1px solid rgba(26,115,232,.3)', background: 'rgba(26,115,232,.08)', color: '#82B4FF', fontFamily: 'Sora, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  logBox: { height: '160px', overflowY: 'auto', padding: '8px', background: '#0D1117', borderRadius: 8, border: '1px solid #30363D', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
};

const ns = {
  ticketOverlay: { position: 'absolute', top: 72, left: 16, zIndex: 25, background: 'rgba(13,17,23,.94)', border: '1px solid rgba(48,54,61,.8)', borderRadius: 12, padding: '10px 12px', backdropFilter: 'blur(12px)', minWidth: 240, maxWidth: 278, fontFamily: 'Sora, sans-serif', boxShadow: '0 4px 24px rgba(0,0,0,.45)', pointerEvents: 'auto' },
  detRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '4px 0', borderBottom: '1px solid rgba(48,54,61,.4)', gap: 6 },
  detLbl: { fontSize: 9, color: '#8B949E', fontWeight: 700, flexShrink: 0, paddingTop: 1 },
  detVal: { fontSize: 10, fontWeight: 700, textAlign: 'right', wordBreak: 'break-word', maxWidth: 150, color: '#E6EDF3' },
  collapseBtn: { background: 'none', border: '1px solid #30363D', borderRadius: 5, color: '#8B949E', fontSize: 9, cursor: 'pointer', padding: '2px 6px', flexShrink: 0, fontFamily: 'Sora, sans-serif' },
  tabBar: { display: 'flex', background: '#0D1117', borderRadius: 8, padding: 2, border: '1px solid #30363D', gap: 2 },
  tabBtn: { flex: 1, padding: '5px 6px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'Sora, sans-serif', fontSize: 9, fontWeight: 700, background: 'transparent', color: '#8B949E', transition: 'all .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 },
  tabBtnActive: { background: '#1C2333', color: '#E6EDF3', boxShadow: '0 1px 4px rgba(0,0,0,.5)' },
  switcherBtn: { display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: 8, cursor: 'pointer', transition: 'all .18s', fontFamily: 'Sora, sans-serif', textAlign: 'left', width: '100%' },
  miniWrap: { position: 'absolute', bottom: 20, right: 16, zIndex: 25, background: 'rgba(13,17,23,.94)', borderRadius: 12, overflow: 'hidden', backdropFilter: 'blur(12px)', fontFamily: 'Sora, sans-serif', width: 290, pointerEvents: 'auto' },
  miniHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px' },
  miniToggleBtn: { background: 'none', borderRadius: 5, fontSize: 9, cursor: 'pointer', padding: '1px 5px', fontFamily: 'Sora, sans-serif', border: '1px solid' },
  miniCanvas: { width: '100%', height: 230 },
};