import { Feather, Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GOOGLE_MAPS_KEY, SERVER_URL, WEBHOOK_URL } from '../config';
import { useAuth } from '../context/AuthContext';

const { width } = Dimensions.get('window');
const MODE = { OVERVIEW: 'overview', NAVIGATE: 'navigate' };

const TRAVEL_MODES = [
  { key: 'driving', label: 'Drive', icon: 'car' },
  { key: 'walking', label: 'Walk', icon: 'walk' },
  { key: 'bicycling', label: 'Cycle', icon: 'bicycle' },
  { key: 'transit', label: 'Transit', icon: 'bus' },
];

const STATUS_PILL = {
  dispatched: { label: 'Dispatched', bg: '#1A1A2E', text: '#82B4FF', border: '#82B4FF44' },
  en_route: { label: 'En Route', bg: '#0D2A5E', text: '#82B4FF', border: '#82B4FF44' },
  on_action: { label: 'On Action', bg: '#2D0D5E', text: '#CE93D8', border: '#CE93D844' },
  arrived: { label: 'Arrived', bg: '#0A3D1F', text: '#69F0AE', border: '#69F0AE44' },
  completed: { label: 'Completed', bg: '#1A3D1A', text: '#B9F6CA', border: '#B9F6CA44' },
  abandoned: { label: 'Abandoned', bg: '#3D0A0A', text: '#FF8A80', border: '#FF8A8044' },
};

const decode = (enc) => {
  const pts = []; let i = 0, lat = 0, lng = 0;
  while (i < enc.length) {
    let b, s = 0, r = 0;
    do { b = enc.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
    lat += r & 1 ? ~(r >> 1) : r >> 1; s = 0; r = 0;
    do { b = enc.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
    lng += r & 1 ? ~(r >> 1) : r >> 1;
    pts.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return pts;
};

const stitchSteps = (steps) => {
  const out = [];
  for (const step of steps) {
    if (!step.encodedPolyline) continue;
    const pts = decode(step.encodedPolyline);
    if (out.length > 0 && pts.length > 0) {
      const last = out[out.length - 1], first = pts[0];
      const dup = Math.abs(last.latitude - first.latitude) < 1e-6 && Math.abs(last.longitude - first.longitude) < 1e-6;
      out.push(...(dup ? pts.slice(1) : pts));
    } else { out.push(...pts); }
  }
  return out;
};

const stripHtml = (h) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

const dist = (a, b) => {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const φ1 = a.latitude * Math.PI / 180, φ2 = b.latitude * Math.PI / 180;
  const dφ = (b.latitude - a.latitude) * Math.PI / 180;
  const dλ = (b.longitude - a.longitude) * Math.PI / 180;
  const x = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const bearing = (a, b) => {
  const la = a.latitude * Math.PI / 180, lb = b.latitude * Math.PI / 180;
  const dl = (b.longitude - a.longitude) * Math.PI / 180;
  return ((Math.atan2(Math.sin(dl) * Math.cos(lb), Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dl)) * 180 / Math.PI) + 360) % 360;
};

const angleDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

const nearestSegmentBearing = (poly, pos) => {
  if (!poly || poly.length < 2 || !pos) return null;
  let minD = Infinity, idx = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const A = poly[i], B = poly[i + 1];
    const ab = dist(A, B);
    if (ab < 0.5) { const d = dist(pos, A); if (d < minD) { minD = d; idx = i; } continue; }
    const t = Math.max(0, Math.min(1, ((pos.latitude - A.latitude) * (B.latitude - A.latitude) + (pos.longitude - A.longitude) * (B.longitude - A.longitude)) / ((B.latitude - A.latitude) ** 2 + (B.longitude - A.longitude) ** 2)));
    const nearest = { latitude: A.latitude + t * (B.latitude - A.latitude), longitude: A.longitude + t * (B.longitude - A.longitude) };
    const d = dist(pos, nearest);
    if (d < minD) { minD = d; idx = i; }
  }
  return bearing(poly[idx], poly[idx + 1]);
};

const perpDist = (pos, poly) => {
  if (!poly?.length || !pos) return Infinity;
  let min = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const A = poly[i], B = poly[i + 1];
    const ab = dist(A, B);
    if (ab < 0.5) { min = Math.min(min, dist(pos, A)); continue; }
    const t = Math.max(0, Math.min(1, ((pos.latitude - A.latitude) * (B.latitude - A.latitude) + (pos.longitude - A.longitude) * (B.longitude - A.longitude)) / ((B.latitude - A.latitude) ** 2 + (B.longitude - A.longitude) ** 2)));
    min = Math.min(min, dist(pos, { latitude: A.latitude + t * (B.latitude - A.latitude), longitude: A.longitude + t * (B.longitude - A.longitude) }));
  }
  return min;
};

const trimFromCar = (poly, pos, minStartIdx = 0) => {
  if (!poly || poly.length < 2 || !pos) return poly ?? [];
  let minD = Infinity, idx = minStartIdx;
  const searchEnd = Math.min(poly.length, minStartIdx + 80);
  for (let i = minStartIdx; i < searchEnd; i++) {
    const d = dist(pos, poly[i]);
    if (d < minD) { minD = d; idx = i; }
  }
  const tail = poly.slice(idx);
  if (tail.length < 2) return [poly[poly.length - 1]];
  return [pos, ...tail];
};

const smoothPos = (prev, next, alpha = 0.45) => {
  if (!prev) return next;
  return { latitude: prev.latitude * (1 - alpha) + next.latitude * alpha, longitude: prev.longitude * (1 - alpha) + next.longitude * alpha };
};

const snapToPolyline = (pos, poly) => {
  if (!poly || poly.length < 2) return pos;
  let minD = Infinity, best = pos;
  for (let i = 0; i < poly.length - 1; i++) {
    const A = poly[i], B = poly[i + 1];
    const ab2 = (B.latitude - A.latitude) ** 2 + (B.longitude - A.longitude) ** 2;
    if (ab2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1,
      ((pos.latitude - A.latitude) * (B.latitude - A.latitude) +
        (pos.longitude - A.longitude) * (B.longitude - A.longitude)) / ab2
    ));
    const proj = {
      latitude: A.latitude + t * (B.latitude - A.latitude),
      longitude: A.longitude + t * (B.longitude - A.longitude),
    };
    const d = dist(pos, proj);
    if (d < minD && d < 30) { minD = d; best = proj; }
  }
  return best;
};

const getManeuverIcon = (m = '', i = '') => {
  const mv = m.toLowerCase(), ins = i.toLowerCase();
  if (mv.includes('turn-left') || ins.includes('turn left')) return 'arrow-back';
  if (mv.includes('turn-right') || ins.includes('turn right')) return 'arrow-forward';
  if (mv.includes('uturn') || ins.includes('u-turn')) return 'return-up-back';
  if (mv.includes('slight-left') || ins.includes('slight left')) return 'arrow-back-outline';
  if (mv.includes('slight-right') || ins.includes('slight right')) return 'arrow-forward-outline';
  if (mv.includes('roundabout')) return 'refresh';
  if (mv.includes('merge')) return 'git-merge';
  if (ins.includes('destination') || ins.includes('arrive')) return 'flag';
  return 'arrow-up';
};

const trafficInfo = (durS, traffS) => {
  if (!traffS) return { label: 'No data', color: '#607D8B', light: '#ECEFF1' };
  const r = traffS / durS;
  if (r < 1.1) return { label: 'Free Flow', color: '#1A73E8', light: '#E8F0FE' };
  if (r < 1.3) return { label: 'Moderate', color: '#F9A825', light: '#FFF8E1' };
  if (r < 1.6) return { label: 'Heavy Traffic', color: '#E53935', light: '#FFEBEE' };
  return { label: 'Stop & Go', color: '#B71C1C', light: '#FFCDD2' };
};

const fmtDist = (m) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
const fmtTime = (s) => { if (s <= 0) return '0 min'; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h === 0 ? `${m} min` : m === 0 ? `${h} hr` : `${h} hr ${m} min`; };
const fmtArrival = (remSeconds) => { const d = new Date(Date.now() + remSeconds * 1000); let h = d.getHours(), m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + m.toString().padStart(2, '0') + ' ' + ap; };

const ping = (ambulanceId, coords, h, spd, distM, timeS, status, stepI, totalS, dDest, ticketNo) => {
  console.log(`📡 GPS PING -> Sending for Ticket: ${ticketNo || 'N/A'}`);
  return fetch(`${WEBHOOK_URL}/webhook/abc1234`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'gps',
      unit_id: ambulanceId,
      ticket_no: ticketNo || '',
      latitude: coords.latitude, longitude: coords.longitude,
      heading: h || 0, speed: spd || 0,
      remainingDistM: distM || 0, remainingTimeS: timeS || 0,
      trip_status: status, stepIdx: stepI || 0, totalSteps: totalS || 0, distToDest: dDest || 0
    }),
  })
    .then(r => console.log(`✅ PING SUCCESS: ${r.status}`))
    .catch(e => console.error(`❌ PING FAILED: ${e.message}`));
};

const notifyStatus = (unitId, status, ticketNo) => {
  console.log(`📣 STATUS UPDATE -> ${status} for Ticket: ${ticketNo || 'N/A'}`);
  return fetch(`${WEBHOOK_URL}/webhook/abc1234`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'gps',
      unit_id: unitId,
      ticket_no: ticketNo || '',
      trip_status: status
    })
  })
    .then(r => console.log(`✅ STATUS SUCCESS: ${r.status}`))
    .catch(e => console.error(`❌ STATUS FAILED: ${e.message}`));
};

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
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_KEY,
        'X-Goog-FieldMask': ['routes.distanceMeters', 'routes.duration', 'routes.staticDuration', 'routes.polyline.encodedPolyline', 'routes.travelAdvisory.speedReadingIntervals'].join(','),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.routes || !data.routes[0]) return null;
    const route = data.routes[0];
    const encoded = route.polyline?.encodedPolyline;
    if (!encoded) return null;
    const intervals = route.travelAdvisory?.speedReadingIntervals || [];
    const durSec = parseInt((route.staticDuration || '0s').replace('s', '')) || 0;
    const trafSec = parseInt((route.duration || '0s').replace('s', '')) || 0;
    return { encoded, intervals, durSec, trafSec, distM: route.distanceMeters || 0 };
  } catch { return null; }
}

function speedIntervalToColor(speed) {
  if (speed === 'TRAFFIC_JAM') return '#9b1c1c';
  if (speed === 'SLOW') return '#ea4335';
  return null;
}

function buildColoredSegmentsFromV2(fullPath, intervals) {
  const segments = [];
  segments.push({ coords: fullPath, color: '#1A73E8', isBase: true });
  intervals.forEach((seg, i) => {
    const color = speedIntervalToColor(seg.speed);
    if (!color) return;
    const start = seg.startPolylinePointIndex || 0;
    let end;
    if (seg.endPolylinePointIndex != null) end = seg.endPolylinePointIndex;
    else if (intervals[i + 1]) end = intervals[i + 1].startPolylinePointIndex - 1;
    else end = fullPath.length - 1;
    const segPath = fullPath.slice(start, end + 1);
    if (segPath.length < 2) return;
    segments.push({ coords: segPath, color, isBase: false });
  });
  return segments;
}

export default function MapScreen({ route: navRoute, navigation }) {
  const ambulanceId = navRoute?.params?.ambulanceId;
  const paramDest = navRoute?.params?.destination;

  // 🔍 DEBUG: Log all parameters received
  console.log('📦 MAP_SCREEN_PARAMS:', JSON.stringify(navRoute?.params));

  const ticketNo = navRoute?.params?.ticketNo || navRoute?.params?.incidentId || navRoute?.params?.ticket_no || '';
  const defDest = paramDest || { latitude: 11.0168, longitude: 76.9558 };
  const insets = useSafeAreaInsets();

  const [ready, setReady] = useState(false);
  const [carPos, setCarPos] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [selIdx, setSelIdx] = useState(0);
  const [dest, setDest] = useState(defDest);
  const [navMode, setNavMode] = useState(MODE.OVERVIEW);
  const [stepIdx, setStepIdx] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tMode, setTMode] = useState('driving');
  const [trimmed, setTrimmed] = useState([]);
  const [trimmedColoredSegments, setTrimmedColoredSegments] = useState([]);
  const [remaining, setRemaining] = useState({ distM: 0, timeS: 0 });
  const [reRouting, setReRouting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wrongDir, setWrongDir] = useState(false);
  const [wrongDirDeg, setWrongDirDeg] = useState(0);
  const [distToTurn, setDistToTurn] = useState(9999);
  const [turnUrgency, setTurnUrgency] = useState(0);
  const [tripStatus, setTripStatus] = useState(navRoute?.params?.initialTripStatus || 'accepted');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [navAltRoutes, setNavAltRoutes] = useState([]);
  const [showNavAlts, setShowNavAlts] = useState(false);

  // ── Mute / unmute TTS ──
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);

  const { theme: T } = useTheme();
  const { session, logout } = useAuth();

  // ── markerHeading: absolute world bearing (0=north, 90=east)
  // This is passed INTO VehicleMarker as a prop — the SVG rotates itself.
  // We store it separately from cameraHdgRef which drives the map camera.
  const [markerHeading, setMarkerHeading] = useState(0);

  const unitType = session?.unitType || navRoute?.params?.unitType || 'ambulance';

  const panelAnim = useRef(new Animated.Value(1)).current;
  const mapRef = useRef(null);
  const carRef = useRef(null);
  const smoothPosRef = useRef(null);
  const prevPosRef = useRef(null);
  const movBearingsRef = useRef([]);
  const movBearingRef = useRef(0);
  const bearingSamplesRef = useRef(0);
  const cameraHdgRef = useRef(0);
  const routesRef = useRef([]);
  const selRef = useRef(0);
  const tModeRef = useRef('driving');
  const navRef = useRef(MODE.OVERVIEW);
  const destRef = useRef(defDest);
  const fetchingRef = useRef(false);
  const lastFetchRef = useRef(null);
  const lastFetchPosRef = useRef(null);
  const reRouteRef = useRef(0);
  const onceFetched = useRef(false);
  const pingTimer = useRef(null);
  const locationSub = useRef(null);
  const wrongDirStart = useRef(null);
  const offRoadCount = useRef(0);
  const distToTurnRef = useRef(9999);
  const stepIdxRef = useRef(0);
  const routeProgressIdxRef = useRef(0);
  const prevTimeRef = useRef(null);
  const speedRef = useRef(0);
  const remainingRef = useRef({ distM: 0, timeS: 0 });
  const tripStatusRef = useRef(navRoute?.params?.initialTripStatus || 'accepted');
  const isCompletedRef = useRef(false);
  const selectedSummaryRef = useRef(null);
  const lastSpokenStepRef = useRef(-1);
  const spokenDistRef = useRef(null);
  const trafficRefreshTimer = useRef(null);
  const missedTurnCountRef = useRef(0);
  const lastRerouteAnnouncedRef = useRef(0);
  const offRoadInstantRef = useRef(0);
  const lastPeriodicFetchRef = useRef(Date.now());
  const trimmedColoredSegmentsRef = useRef([]);
  const navAltDismissTimer = useRef(null);

  const speak = (text, opts) => {
    if (mutedRef.current) return;
    Speech.speak(text, opts);
  };

  const handleMuteToggle = () => {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    if (next) {
      Speech.stop();
    } else {
      const activeR = routesRef.current[selRef.current];
      if (activeR && navRef.current === MODE.NAVIGATE) {
        const currentStep = activeR.steps[stepIdxRef.current];
        if (currentStep) {
          const dTurn = distToTurnRef.current;
          const distLabel =
            dTurn < 50 ? ''
              : dTurn < 150 ? 'In 100 metres, '
                : dTurn < 350 ? 'In 200 metres, '
                  : dTurn < 700 ? 'In 500 metres, '
                    : `In ${(dTurn / 1000).toFixed(1)} kilometres, `;
          lastSpokenStepRef.current = stepIdxRef.current;
          spokenDistRef.current = null;
          Speech.speak(`${distLabel}${currentStep.instruction}`, { language: 'en-IN', rate: 0.92 });
        }
      }
    }
  };

  useEffect(() => { tModeRef.current = tMode; }, [tMode]);
  useEffect(() => { navRef.current = navMode; }, [navMode]);
  useEffect(() => { destRef.current = dest; }, [dest]);
  useEffect(() => { routesRef.current = routes; }, [routes]);
  useEffect(() => { selRef.current = selIdx; }, [selIdx]);
  useEffect(() => { stepIdxRef.current = stepIdx; }, [stepIdx]);
  useEffect(() => { startGPS(); startPing(); return () => stopAll(); }, []);

  useEffect(() => {
    const r = routesRef.current[selRef.current];
    if (r && carRef.current) {
      routeProgressIdxRef.current = 0;
      setTrimmed(trimFromCar(r.roadPoly, carRef.current, 0));
      setTrimmedColoredSegments(r.coloredSegments || []);
      trimmedColoredSegmentsRef.current = r.coloredSegments || [];
    }
  }, [routes, selIdx]);

  useEffect(() => {
    const p = carRef.current;
    if (!p) return;
    setRoutes([]); setTrimmed([]); lastFetchRef.current = null;
    selectedSummaryRef.current = null;
    doFetch(p, destRef.current, tMode, false, true);
  }, [tMode]);

  const startGPS = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { alert('Location permission denied'); return; }
    locationSub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 800, distanceInterval: 1 },
      (loc) => {
        const rawPos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        const pos = smoothPos(smoothPosRef.current, rawPos, 0.45);
        smoothPosRef.current = pos;
        const dFromPrev = prevPosRef.current ? dist(prevPosRef.current, pos) : 0;
        const nowMs = Date.now();
        const deltaMs = nowMs - (prevTimeRef.current || nowMs);
        prevTimeRef.current = nowMs;
        speedRef.current = deltaMs > 0 ? Math.round((dFromPrev / deltaMs) * 3600 * 10) / 10 : 0;
        if (dFromPrev > 3 && prevPosRef.current) {
          const rawBear = bearing(prevPosRef.current, pos);
          const buf = movBearingsRef.current;
          buf.push(rawBear); if (buf.length > 3) buf.shift();
          const sinSum = buf.reduce((s, a) => s + Math.sin(a * Math.PI / 180), 0);
          const cosSum = buf.reduce((s, a) => s + Math.cos(a * Math.PI / 180), 0);
          movBearingRef.current = ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360;
          bearingSamplesRef.current += 1;
        }
        prevPosRef.current = pos;
        carRef.current = pos;
        setCarPos({ ...pos });
        setReady(true);
        if (navRef.current === MODE.NAVIGATE) {
          const activeR = routesRef.current[selRef.current];
          if (activeR) {
            const now = Date.now();
            const poly = activeR.roadPoly;
            let minD = Infinity, bestIdx = routeProgressIdxRef.current;
            const searchEnd = Math.min(poly.length, routeProgressIdxRef.current + 50);
            for (let i = routeProgressIdxRef.current; i < searchEnd; i++) { const d = dist(pos, poly[i]); if (d < minD) { minD = d; bestIdx = i; } }
            if (bestIdx > routeProgressIdxRef.current) routeProgressIdxRef.current = bestIdx;
            const t = trimFromCar(poly, pos, routeProgressIdxRef.current);
            setTrimmed(t);
            let remM = 0;
            for (let i = 0; i < t.length - 1; i++) remM += dist(t[i], t[i + 1]);
            const fracLeft = Math.min(remM / (activeR.distanceM || 1), 1);
            const newRem = { distM: Math.round(remM), timeS: Math.round(activeR.trafficSeconds * fracLeft) };
            setRemaining(newRem); remainingRef.current = newRem;
            const step = activeR.steps[stepIdxRef.current];
            if (step?.endLocation) {
              const dTurn = dist(pos, step.endLocation);
              distToTurnRef.current = dTurn;
              setDistToTurn(Math.round(dTurn));
              setTurnUrgency(dTurn < 40 ? 2 : dTurn < 120 ? 1 : 0);
            }
            const curStep = activeR.steps[stepIdxRef.current];
            if (curStep?.endLocation && dist(pos, curStep.endLocation) < 25 && stepIdxRef.current < activeR.steps.length - 1) {
              stepIdxRef.current += 1; setStepIdx(stepIdxRef.current);
            }
            const currentSt = tripStatusRef.current;
            if (!isCompletedRef.current && (currentSt === 'en_route' || currentSt === 'on_action')) {
              const dToDest = dist(pos, destRef.current);
              if (dToDest < 50) {
                tripStatusRef.current = 'arrived'; setTripStatus('arrived'); notifyStatus(ambulanceId, 'arrived', ticketNo);
              }
            }
            if (dFromPrev > 3 && bearingSamplesRef.current >= 3) {
              const routeBear = nearestSegmentBearing(poly, pos);
              if (routeBear !== null) {
                const diff = angleDiff(movBearingRef.current, routeBear);
                const cooldownOk = now - reRouteRef.current > 10000;
                if (diff > 80) {
                  setWrongDir(true); setWrongDirDeg(Math.round(diff));
                  if (!wrongDirStart.current) wrongDirStart.current = now;
                  else if (now - wrongDirStart.current > 5000 && cooldownOk && !fetchingRef.current) {
                    wrongDirStart.current = null; reRouteRef.current = now;
                    offRoadCount.current = 0; routeProgressIdxRef.current = 0; bearingSamplesRef.current = 0;
                    doFetch(pos, destRef.current, tModeRef.current, true, true);
                  }
                } else { setWrongDir(false); wrongDirStart.current = null; setWrongDirDeg(0); }
              }
            }
            const offRoad = perpDist(pos, poly);
            if (now - reRouteRef.current > 8000 && !fetchingRef.current) {
              if (offRoad > 45) {
                offRoadCount.current += 1;
                if (offRoadCount.current >= 3) {
                  offRoadCount.current = 0; reRouteRef.current = now;
                  routeProgressIdxRef.current = 0; bearingSamplesRef.current = 0;
                  doFetch(pos, destRef.current, tModeRef.current, true, true);
                }
              } else { offRoadCount.current = 0; }
            }
            if (lastFetchPosRef.current && !fetchingRef.current) {
              const dSince = dist(pos, lastFetchPosRef.current);
              if (dSince >= 300 && now - reRouteRef.current >= 8000) {
                lastFetchPosRef.current = pos;
                doFetch(pos, destRef.current, tModeRef.current, false, false);
              }
            }
          }
          const ch = movBearingRef.current; cameraHdgRef.current = ch;
          const dTurn = distToTurnRef.current;
          const zoom = dTurn < 40 ? 19 : dTurn < 120 ? 18 : 17;
          const isWrong = wrongDirStart.current !== null;
          mapRef.current?.animateCamera({ center: pos, zoom, heading: ch, pitch: isWrong ? 0 : (dTurn < 40 ? 35 : 45) }, { duration: isWrong ? 400 : (dTurn < 40 ? 180 : 320) });
          return;
        }
        if (!onceFetched.current && !fetchingRef.current) { doFetch(pos, destRef.current, tModeRef.current, false, true); return; }
        const activeR2 = routesRef.current[selRef.current];
        if (activeR2) setTrimmed(trimFromCar(activeR2.roadPoly, pos, routeProgressIdxRef.current));
      }
    );
  };

  const startPing = () => {
    pingTimer.current = setInterval(() => {
      if (carRef.current) ping(ambulanceId, carRef.current, movBearingRef.current, speedRef.current, remainingRef.current.distM, remainingRef.current.timeS, tripStatusRef.current, stepIdxRef.current, routesRef.current[selRef.current]?.steps?.length || 0, carRef.current ? dist(carRef.current, destRef.current) : 0, ticketNo);
    }, 1000);
  };

  const stopAll = () => { clearInterval(pingTimer.current); locationSub.current?.remove(); };

  const doFetch = async (livePos, destination, mode, isReRoute = false, resetSel = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (isReRoute) setReRouting(true); else setLoading(true);
    const url = `${SERVER_URL}/directions?originLat=${livePos.latitude}&originLng=${livePos.longitude}&destLat=${destination.latitude}&destLng=${destination.longitude}&mode=${mode || tModeRef.current}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.status !== 'OK') { return; }
      const isDriving = (mode || tModeRef.current) === 'driving';
      let v2Data = null;
      if (isDriving) v2Data = await fetchRoutesV2(livePos.latitude, livePos.longitude, destination.latitude, destination.longitude);
      const v2FullPath = v2Data?.encoded ? decode(v2Data.encoded) : null;
      const parsed = data.routes.map((r, i) => {
        const leg = r.legs[0];
        const durS = leg.duration.value;
        const traffS = isDriving ? (leg.duration_in_traffic?.value || durS) : durS;
        const trafficRatio = traffS / durS;
        const traffic = isDriving ? trafficInfo(durS, traffS) : { label: 'No traffic data', color: '#34A853', light: '#E6F4EA' };
        let coloredSegments = [];
        if (isDriving && i === 0 && v2FullPath && v2Data.intervals?.length > 0) {
          coloredSegments = buildColoredSegmentsFromV2(v2FullPath, v2Data.intervals);
        } else {
          const fullPoly = stitchSteps(leg.steps.map(s => ({ encodedPolyline: s.polyline.points })));
          coloredSegments.push({ coords: fullPoly, color: '#1A73E8', isBase: true });
          leg.steps.forEach((s) => {
            const stepPts = decode(s.polyline.points);
            if (stepPts.length < 2) return;
            const stepRatio = (s.duration.value * trafficRatio) / s.duration.value;
            let color = null;
            if (stepRatio >= 2.0) color = '#9b1c1c';
            else if (stepRatio >= 1.5) color = '#ea4335';
            else if (stepRatio >= 1.15) color = '#fbbc04';
            if (!color) return;
            coloredSegments.push({ coords: stepPts, color, isBase: false });
          });
        }
        const steps = leg.steps.map(s => ({
          instruction: stripHtml(s.html_instructions),
          distance: s.distance.text, distanceM: s.distance.value,
          duration: s.duration.text, maneuver: s.maneuver || '',
          htmlInstruction: s.html_instructions,
          endLocation: s.end_location ? { latitude: s.end_location.lat, longitude: s.end_location.lng } : null,
          encodedPolyline: s.polyline.points,
        }));
        return {
          idx: i, summary: r.summary || `Route ${i + 1}`,
          coloredSegments, trafficSeconds: traffS, distanceM: leg.distance.value,
          distance: leg.distance.text, duration: leg.duration.text,
          durationInTraffic: leg.duration_in_traffic?.text || leg.duration.text,
          traffic, steps, endAddress: leg.end_address,
          roadPoly: stitchSteps(steps), overviewPoly: decode(r.overview_polyline.points),
        };
      });
      parsed.sort((a, b) => a.trafficSeconds - b.trafficSeconds);
      let newSelIdx = 0;
      if (!resetSel && onceFetched.current && selectedSummaryRef.current) {
        const matchIdx = parsed.findIndex(r => r.summary === selectedSummaryRef.current);
        if (matchIdx !== -1) newSelIdx = matchIdx;
      }
      const nowPos = carRef.current || livePos;
      if (parsed[newSelIdx]) {
        routeProgressIdxRef.current = 0;
        const trimmedPoly = trimFromCar(parsed[newSelIdx].roadPoly, nowPos, 0);
        setTrimmed(trimmedPoly);
        setTrimmedColoredSegments(parsed[newSelIdx].coloredSegments || []);
        trimmedColoredSegmentsRef.current = parsed[newSelIdx].coloredSegments || [];
        if (navRef.current === MODE.OVERVIEW && mapRef.current) {
          setTimeout(() => mapRef.current?.fitToCoordinates(parsed[newSelIdx].roadPoly, { edgePadding: { top: 100, right: 40, bottom: 320, left: 40 }, animated: true }), 300);
        }
      }
      setRoutes(parsed); setSelIdx(newSelIdx); selRef.current = newSelIdx;
      if (!isReRoute) { setStepIdx(0); stepIdxRef.current = 0; }
      lastFetchRef.current = nowPos; lastFetchPosRef.current = nowPos; onceFetched.current = true;
      lastPeriodicFetchRef.current = Date.now();
      if (isReRoute) {
        setStepIdx(0); stepIdxRef.current = 0;
        setWrongDir(false); wrongDirStart.current = null; offRoadCount.current = 0;
        offRoadInstantRef.current = 0; missedTurnCountRef.current = 0;
        bearingSamplesRef.current = 0; routeProgressIdxRef.current = 0;
        setTurnUrgency(0); setDistToTurn(9999); distToTurnRef.current = 9999;
        selectedSummaryRef.current = null;
        lastSpokenStepRef.current = -1; spokenDistRef.current = null;
        if (navRef.current === MODE.NAVIGATE && parsed.length > 1) {
          showAlternateRoutesDuringNav(parsed, newSelIdx);
        }
      }
    } catch (e) { console.error('[Fetch] error:', e.message); }
    finally { fetchingRef.current = false; setReRouting(false); setLoading(false); }
  };

  const onCameraChange = useCallback(async () => {
    if (!mapRef.current) return;
    try { const cam = await mapRef.current.getCamera(); cameraHdgRef.current = cam.heading ?? 0; } catch { }
  }, []);

  const startNav = () => {
    const pos = carRef.current;
    setNavMode(MODE.NAVIGATE); setStepIdx(0); stepIdxRef.current = 0;
    setPanelOpen(false); setRemaining({ distM: 0, timeS: 0 });
    setWrongDir(false); wrongDirStart.current = null; offRoadCount.current = 0;
    routeProgressIdxRef.current = 0; setTurnUrgency(0); setDistToTurn(9999); distToTurnRef.current = 9999;
    tripStatusRef.current = 'en_route'; setTripStatus('en_route'); notifyStatus(ambulanceId, 'en_route', ticketNo);
    const seedRoute = routesRef.current[selRef.current];
    if (seedRoute?.roadPoly?.length >= 2) {
      const initialBear = bearing(seedRoute.roadPoly[0], seedRoute.roadPoly[1]);
      movBearingRef.current = initialBear; movBearingsRef.current = [initialBear, initialBear, initialBear];
      cameraHdgRef.current = initialBear; bearingSamplesRef.current = 0;
    } else { movBearingsRef.current = []; bearingSamplesRef.current = 0; }
    Animated.spring(panelAnim, { toValue: 0, useNativeDriver: false }).start();
    if (pos) {
      doFetch(pos, destRef.current, tModeRef.current, false, false);
      mapRef.current?.animateCamera({ center: pos, zoom: 15, heading: 0, pitch: 0 }, { duration: 300 });
      setTimeout(() => {
        const hdg = movBearingRef.current; cameraHdgRef.current = hdg;
        mapRef.current?.animateCamera({ center: pos, zoom: 18, heading: hdg, pitch: 50 }, { duration: 900 });
      }, 350);
    }
  };

  const handleOnAction = () => {
    setDropdownOpen(false); tripStatusRef.current = 'on_action'; setTripStatus('on_action'); notifyStatus(ambulanceId, 'on_action', ticketNo);
  };
  const handleMarkArrived = () => {
    setDropdownOpen(false); tripStatusRef.current = 'arrived'; setTripStatus('arrived'); notifyStatus(ambulanceId, 'arrived', ticketNo);
  };
  const handleCompleted = () => {
    setDropdownOpen(false); tripStatusRef.current = 'completed'; setTripStatus('completed'); isCompletedRef.current = true; notifyStatus(ambulanceId, 'completed', ticketNo);
    if (carRef.current) ping(ambulanceId, carRef.current, movBearingRef.current, speedRef.current, remainingRef.current.distM, remainingRef.current.timeS, 'completed', stepIdxRef.current, routesRef.current[selRef.current]?.steps?.length || 0, carRef.current ? dist(carRef.current, destRef.current) : 0, ticketNo);
  };
  const handleAbandon = () => {
    setDropdownOpen(false);
    Alert.alert('Abandon Trip?', 'Are you sure? The dispatch console will be notified immediately.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes, Abandon', style: 'destructive', onPress: () => {
          tripStatusRef.current = 'abandoned'; setTripStatus('abandoned'); notifyStatus(ambulanceId, 'abandoned', ticketNo);
          if (carRef.current) ping(ambulanceId, carRef.current, movBearingRef.current, speedRef.current, remainingRef.current.distM, remainingRef.current.timeS, 'abandoned', stepIdxRef.current, routesRef.current[selRef.current]?.steps?.length || 0, carRef.current ? dist(carRef.current, destRef.current) : 0, ticketNo);
          stopAll(); navigation.navigate('Alert');
        }
      },
    ]);
  };
  const stopNav = () => {
    tripStatusRef.current = 'completed'; notifyStatus(ambulanceId, 'completed', ticketNo);
    if (carRef.current) ping(ambulanceId, carRef.current, movBearingRef.current, speedRef.current, remainingRef.current.distM, remainingRef.current.timeS, 'completed', stepIdxRef.current, routesRef.current[selRef.current]?.steps?.length || 0, carRef.current ? dist(carRef.current, destRef.current) : 0, ticketNo);
    stopAll(); navigation.navigate('Alert');
  };
  const onMapPress = (e) => {
    if (navMode === MODE.NAVIGATE) return;
    if (dropdownOpen) { setDropdownOpen(false); return; }
    const nd = e.nativeEvent.coordinate;
    setDest(nd); destRef.current = nd;
    setRoutes([]); setTrimmed([]); lastFetchRef.current = null; selectedSummaryRef.current = null;
    if (carRef.current) doFetch(carRef.current, nd, tModeRef.current, false, true);
  };

  const panelH = panelAnim.interpolate({ inputRange: [0, 1], outputRange: [72, 480] });
  const activeR = routes[selIdx];
  const curStep = activeR?.steps[stepIdx];
  const nxtStep = activeR?.steps[stepIdx + 1];
  const totalSteps = activeR?.steps.length || 0;
  const isWalk = tMode === 'walking';
  const URGENCY_COLORS = T.urgency;
  const turnColor = URGENCY_COLORS[turnUrgency] ?? T.accent;

  const distToTurnLabel = (() => {
    const m = distToTurn;
    if (m >= 9999) return '';
    if (m < 15) return 'Turn now!';
    if (m < 50) return `In ${Math.round(m / 5) * 5} m`;
    if (m < 150) return 'In 100 m';
    if (m < 300) return 'In 200 m';
    if (m < 450) return 'In 400 m';
    if (m < 750) return 'In 500 m';
    if (m < 1200) return 'In 1 km';
    if (m < 1700) return 'In 1.5 km';
    return `In ${Math.round(m / 1000)} km`;
  })();

  const remTime = remaining.timeS > 0 ? fmtTime(remaining.timeS) : activeR?.durationInTraffic ?? '';
  const remDist = remaining.distM > 0 ? fmtDist(remaining.distM) : activeR?.distance ?? '';
  const pillCfg = STATUS_PILL[tripStatus] || STATUS_PILL.dispatched;

  const STATUS_BAR_H = insets.top + (Platform.OS === 'ios' ? 50 : 40);
  const TURN_BANNER_H = 64;
  const NEXT_BAR_H = 48;

  const turnBannerVisible = navMode === MODE.NAVIGATE && !!curStep && !reRouting && !wrongDir && distToTurnLabel !== '';
  const nextBarVisible = navMode === MODE.NAVIGATE && !!nxtStep && !reRouting && !wrongDir;

  const turnBannerTop = STATUS_BAR_H;
  const nextBarTop = turnBannerTop + (turnBannerVisible ? TURN_BANNER_H : 0) + 4;
  const muteButtonTop = nextBarTop + (nextBarVisible ? NEXT_BAR_H : 0) + 6;

  const dropdownOptions = [];
  if (tripStatus === 'en_route') {
    dropdownOptions.push({ label: 'Arrived', color: '#15803D', onPress: handleMarkArrived });
    dropdownOptions.push({ label: 'On Action', color: '#CE93D8', onPress: handleOnAction });
    dropdownOptions.push({ label: 'Completed', color: '#2E7D32', onPress: handleCompleted });
  }
  if (tripStatus === 'on_action') {
    dropdownOptions.push({ label: 'Completed', color: '#2E7D32', onPress: handleCompleted });
  }
  if (tripStatus === 'arrived') {
    dropdownOptions.push({ label: 'On Action', color: '#CE93D8', onPress: handleOnAction });
    dropdownOptions.push({ label: 'Completed', color: '#2E7D32', onPress: handleCompleted });
  }
  if (tripStatus !== 'abandoned') {
    dropdownOptions.push({ label: 'Abandon Trip', color: '#B71C1C', onPress: handleAbandon });
  }
  dropdownOptions.push({
    label: 'Sign Out', color: '#94a3b8',
    onPress: () => {
      setDropdownOpen(false);
      Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', onPress: () => { stopAll(); logout(); } },
      ]);
    },
  });

  if (!ready || !carPos) {
    return (
      <View style={s.loader}>
        <ActivityIndicator size="large" color="#1A73E8" />
        <Text style={s.loaderTxt}>Getting your location…</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <MapView
        ref={mapRef} provider={PROVIDER_GOOGLE} googleMapsApiKey={GOOGLE_MAPS_KEY}
        style={s.map} showsTraffic={tMode === 'driving'} showsUserLocation={false}
        showsMyLocationButton={navMode !== MODE.NAVIGATE} showsCompass rotateEnabled pitchEnabled
        onPress={onMapPress} onRegionChangeComplete={onCameraChange}
        initialRegion={{ ...carPos, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
        mapPadding={{ top: 0, right: 0, bottom: navMode === MODE.OVERVIEW ? 300 : 110, left: 0 }}
        customMapStyle={T.name === 'dark' ? DARK_MAP_STYLE : []}
      >
        {navMode === MODE.OVERVIEW && routes.filter((_, i) => i !== selIdx).map((r, i) => (
          <React.Fragment key={`alt-${i}`}>
            <Polyline coordinates={r.overviewPoly} strokeColor="#FFFFFF" strokeWidth={14} geodesic zIndex={4} lineCap="round" lineJoin="round" />
            <Polyline coordinates={r.overviewPoly} strokeColor="#A8C8F8" strokeWidth={7} geodesic zIndex={5} lineCap="round" lineJoin="round" />
          </React.Fragment>
        ))}

        {navMode === MODE.NAVIGATE && navAltRoutes.map((r, i) => (
          <React.Fragment key={`nav-alt-${i}`}>
            <Polyline coordinates={r.roadPoly} strokeColor="#FFFFFF" strokeWidth={12} geodesic zIndex={4} lineCap="round" lineJoin="round" />
            <Polyline coordinates={r.roadPoly} strokeColor="#A8C8F8" strokeWidth={6} geodesic zIndex={5} lineCap="round" lineJoin="round" />
          </React.Fragment>
        ))}

        {!isWalk && navMode === MODE.NAVIGATE && trimmedColoredSegments.map((seg, segI) => (
          <React.Fragment key={`nav-seg-${segI}`}>
            <Polyline coordinates={seg.coords} strokeColor="#FFFFFF" strokeWidth={seg.isBase ? 14 : 12} zIndex={seg.isBase ? 6 : 10} lineCap="round" lineJoin="round" geodesic />
            <Polyline coordinates={seg.coords} strokeColor={seg.color} strokeWidth={seg.isBase ? 8 : 7} zIndex={seg.isBase ? 7 : 11} lineCap="round" lineJoin="round" geodesic />
          </React.Fragment>
        ))}

        {!isWalk && navMode === MODE.OVERVIEW && activeR?.coloredSegments?.map((seg, segI) => (
          <React.Fragment key={`ov-seg-${segI}`}>
            <Polyline coordinates={seg.coords} strokeColor="#FFFFFF" strokeWidth={seg.isBase ? 14 : 12} zIndex={seg.isBase ? 6 : 10} lineCap="round" lineJoin="round" geodesic />
            <Polyline coordinates={seg.coords} strokeColor={seg.color} strokeWidth={seg.isBase ? 8 : 7} zIndex={seg.isBase ? 7 : 11} lineCap="round" lineJoin="round" geodesic />
          </React.Fragment>
        ))}

        {isWalk && trimmed.length >= 2 && (
          <>
            <Polyline coordinates={trimmed} strokeColor="#FFFFFF" strokeWidth={13} geodesic zIndex={8} lineCap="round" lineDashPattern={[8, 10]} />
            <Polyline coordinates={trimmed} strokeColor="#1A73E8" strokeWidth={7} geodesic zIndex={9} lineCap="round" lineDashPattern={[8, 10]} />
          </>
        )}

        {navMode === MODE.NAVIGATE && carRef.current && carPos &&
          Math.abs(carRef.current.latitude - carPos.latitude) > 0.000005 && (
            <Polyline coordinates={[carRef.current, carPos]} strokeColor="rgba(100,116,139,0.7)" strokeWidth={2} geodesic={false} zIndex={14} lineDashPattern={[4, 6]} />
          )}

        {/* ── VEHICLE MARKER ─────────────────────────────────────────────────
              Key approach: NO flat/rotation on the Marker (unreliable Android).
              Instead, heading is passed as a prop into VehicleMarker which
              applies an SVG transform="rotate(heading, cx, cy)" to the arrow.
              tracksViewChanges=false prevents per-frame re-render lag.
              The key forces a remount every 2° of heading change.
          ──────────────────────────────────────────────────────────────────── */}
        {/* {carPos && (
            <Marker
              key={`vm-${Math.round(markerHeading / 2) * 2}`}
              coordinate={carPos}
              anchor={{ x: 0.5, y: 0.8 }}
              zIndex={999}
              tracksViewChanges={true}
            >
              <VehicleMarker heading={markerHeading} />
            </Marker>
          )} */}
        {/* ── VEHICLE MARKER — Swiggy/Zomato style ─────────────────────────
    Rules:
    1. NO width/height on the wrapper View — let Image size define it
    2. overflow: 'visible' on the wrapper  
    3. anchor={{ x: 0.5, y: 0.5 }} — center anchor so rotation spins in place
    4. tracksViewChanges: key-based remount every 3° change (performance)
    5. Rotation via transform on the Image directly
    6. NO borderRadius / backgroundColor on wrapper (causes clipping)
──────────────────────────────────────────────────────────────────── */}
        {/* ══════════════════════════════════════════════════════════════════
    VEHICLE MARKER — OPTION A (PRIMARY): Ambulance PNG with rotation
    Fix: tracksViewChanges must start TRUE then go false after render.
    We use the key-remount trick so it re-renders on heading change.
    The wrapper View must have explicit width/height = image size,
    but overflow:'visible' so rotation doesn't clip.
    CRITICAL on Android: never use tracksViewChanges=false initially.
══════════════════════════════════════════════════════════════════ */}
        {/* {carPos && (
  <Marker
    key={`vm-${Math.round(markerHeading / 3) * 3}`}
    coordinate={carPos}
    anchor={{ x: 0.5, y: 0.5 }}
    zIndex={999}
    tracksViewChanges={true}
    flat={false}
  >
    <Image
      source={require('../../assets/images/ambulance.png')}
      style={{
        width: 56,
        height: 56,
        resizeMode: 'contain',
        transform: [{ rotate: `${markerHeading}deg` }],
      }}
    />
  </Marker>
)}
 */}
        {/* ══════════════════════════════════════════════════════════════════
    VEHICLE MARKER — OPTION B (FALLBACK): Blue dot with white ring
    Use this if ambulance PNG still doesn't show.
    This uses the SVG VehicleMarker component already defined above.
    Uncomment below and comment out OPTION A to switch.
══════════════════════════════════════════════════════════════════ */}
        {/* Car marker */}
        <Marker coordinate={carPos} anchor={{ x: 0.5, y: 0.5 }} flat rotation={0} tracksViewChanges={Platform.OS === 'android'} zIndex={15}>
          <View style={s.dotOuter}><View style={s.dotInner} /></View>
        </Marker>
        <Marker coordinate={dest} anchor={{ x: 0.5, y: 0.5 }} zIndex={12}>
          <View style={s.destDot}><View style={s.destDotInner} /></View>
        </Marker>
      </MapView>

      {navMode === MODE.OVERVIEW && (
        <View style={[s.modeBar, { top: insets.top + 10 }]}>
          {TRAVEL_MODES.map(tm => (
            <TouchableOpacity key={tm.key} onPress={() => setTMode(tm.key)}
              style={[s.modeBtn, tMode === tm.key && [s.modeBtnOn, { backgroundColor: T.accent }]]}>
              <Ionicons name={tm.icon} size={18} color={tMode === tm.key ? '#fff' : '#666'} />
              <Text style={[s.modeBtnLbl, tMode === tm.key && s.modeBtnLblOn]}>{tm.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading && (
        <View style={[s.loadingChip, { top: insets.top + 54 }]}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={s.loadingTxt}> Calculating route…</Text>
        </View>
      )}

      {reRouting && (
        <View style={s.recalcBanner}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={s.recalcTxt}>  Recalculating route…</Text>
        </View>
      )}

      {navMode === MODE.NAVIGATE && wrongDir && !reRouting && (
        <View style={[s.wrongDirBanner, { paddingTop: insets.top + 12 }]}>
          <View style={s.wrongDirIconBox}>
            <Ionicons name="warning" size={26} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.wrongDirTitle}>Wrong Direction</Text>
            <Text style={s.wrongDirSub}>Turn around · {wrongDirDeg}° off route</Text>
          </View>
          <TouchableOpacity onPress={stopNav} style={s.wrongDirClose}>
            <Ionicons name="close" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {navMode === MODE.NAVIGATE && (
        <View style={[s.statusBar, { paddingTop: insets.top + 6, paddingBottom: 6 }]}>
          <View style={[s.statusPill, { backgroundColor: pillCfg.bg, borderColor: pillCfg.border }]}>
            <View style={[s.statusDot, { backgroundColor: pillCfg.text }]} />
            <Text style={[s.statusPillTxt, { color: pillCfg.text }]}>{pillCfg.label}</Text>
          </View>
          {tripStatus !== 'abandoned' && (
            <TouchableOpacity style={s.dropdownTrigger} onPress={() => setDropdownOpen(v => !v)} activeOpacity={0.8} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="more-vertical" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {turnBannerVisible && (
        <View style={[s.navBanner, { backgroundColor: turnColor, top: turnBannerTop }]}>
          <View style={[s.bnrManeuverBox, turnUrgency === 2 && s.bnrManeuverBoxNow]}>
            <Ionicons
              name={getManeuverIcon(curStep.maneuver, curStep.htmlInstruction || '')}
              size={turnUrgency === 2 ? 24 : 20}
              color="#fff"
            />
          </View>
          <View style={s.bnrContent}>
            <Text style={s.bnrCountdown}>{distToTurnLabel}</Text>
            <Text style={s.bnrInstr} numberOfLines={1}>{curStep.instruction}</Text>
          </View>
          <Text style={s.bnrStepCount}>{stepIdx + 1}/{totalSteps}</Text>
        </View>
      )}

      {nextBarVisible && (
        <View style={[s.nextBar, { top: nextBarTop }]}>
          <Text style={s.nextLabel}>Then</Text>
          <View style={s.nextIconBox}>
            <Ionicons name={getManeuverIcon(nxtStep.maneuver, nxtStep.htmlInstruction || '')} size={14} color="#1A73E8" />
          </View>
          <Text style={s.nextInstr} numberOfLines={1}>{nxtStep.instruction}</Text>
          <View style={s.nextDistPill}><Text style={s.nextDistTxt}>{nxtStep.distance}</Text></View>
        </View>
      )}

      {navMode === MODE.NAVIGATE && (
        <TouchableOpacity
          style={[s.muteBtn, { top: muteButtonTop }]}
          onPress={handleMuteToggle}
          activeOpacity={0.8}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name={muted ? 'volume-mute' : 'volume-high'}
            size={20}
            color={muted ? '#94A3B8' : '#fff'}
          />
        </TouchableOpacity>
      )}

      {navMode === MODE.OVERVIEW && activeR && (
        <View style={[s.trafficBadge, { backgroundColor: activeR.traffic.color, top: insets.top + 54 }]}>
          <Text style={s.trafficBadgeTxt}>{activeR.traffic.label}</Text>
        </View>
      )}
      {navMode === MODE.OVERVIEW && (
        <View style={[s.hint, { top: insets.top + 54 }]}>
          <Feather name="map-pin" size={11} color="#fff" style={{ marginRight: 5 }} />
          <Text style={s.hintTxt}>Tap map to set destination</Text>
        </View>
      )}

      {navMode === MODE.NAVIGATE && dropdownOpen && (
        <Modal transparent animationType="fade" onRequestClose={() => setDropdownOpen(false)}>
          <TouchableOpacity style={[s.dropdownOverlay, { paddingTop: insets.top + 56 }]} activeOpacity={1} onPress={() => setDropdownOpen(false)}>
            <View style={s.dropdownCard} onStartShouldSetResponder={() => true} onTouchEnd={e => e.stopPropagation()}>
              <Text style={s.dropdownTitle}>Trip Actions</Text>
              <View style={s.dropdownDivider} />
              {dropdownOptions.map((opt, i) => (
                <TouchableOpacity key={i} style={[s.dropdownItem, i < dropdownOptions.length - 1 && s.dropdownItemBorder]} onPress={opt.onPress} activeOpacity={0.75}>
                  <Text style={[s.dropdownItemTxt, { color: opt.color }]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {navMode === MODE.OVERVIEW && (
        <Animated.View style={[s.panel, { height: panelH }]}>
          <TouchableOpacity
            onPress={() => {
              const n = !panelOpen;
              Animated.spring(panelAnim, { toValue: n ? 1 : 0, useNativeDriver: false }).start();
              setPanelOpen(n);
            }}
            style={s.panelHandle}
          >
            <View style={s.handleBar} />
            {activeR && (
              <View style={s.summaryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.etaTxt}>{activeR.durationInTraffic}</Text>
                  <Text style={s.distTxt}>{activeR.distance} · {activeR.summary}</Text>
                  {activeR.endAddress ? <Text style={s.addrTxt} numberOfLines={1}>{activeR.endAddress}</Text> : null}
                </View>
                <View style={[s.trafficDot, { backgroundColor: activeR.traffic.light }]}>
                  <Feather name="activity" size={18} color={activeR.traffic.color} />
                </View>
              </View>
            )}
          </TouchableOpacity>
          {panelOpen && activeR && (
            <TouchableOpacity style={[s.startBtn, { backgroundColor: T.accent, shadowColor: T.accent }]} onPress={startNav} activeOpacity={0.85}>
              <Feather name="navigation" size={18} color="#fff" style={{ marginRight: 10 }} />
              <Text style={s.startBtnTxt}>Start Navigation</Text>
            </TouchableOpacity>
          )}
          {panelOpen && routes.length > 1 && (
            <View style={s.routeSec}>
              <Text style={s.secLbl}>Routes</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {routes.map((r, i) => {
                  const diffS = r.trafficSeconds - routes[0].trafficSeconds;
                  const isBest = i === 0;
                  const diffLabel = isBest ? 'Fastest' : diffS < 60 ? 'Similar' : `+${Math.round(diffS / 60)} min`;
                  const diffColor = isBest ? '#1E8E3E' : diffS > 300 ? '#E53935' : '#F9A825';
                  return (
                    <TouchableOpacity key={i}
                      onPress={() => { setSelIdx(i); selRef.current = i; setStepIdx(0); stepIdxRef.current = 0; selectedSummaryRef.current = r.summary; }}
                      style={[s.routeCard, i === selIdx && s.routeCardOn]}>
                      <View style={[s.routeBadge, { backgroundColor: diffColor + '22' }]}>
                        <Text style={[s.routeBadgeTxt, { color: diffColor }]}>{diffLabel}</Text>
                      </View>
                      <Text style={s.routeEta}>{r.durationInTraffic}</Text>
                      <Text style={s.routeDist}>{r.distance}</Text>
                      <Text style={s.routeName} numberOfLines={1}>{r.summary}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}
          {panelOpen && activeR && (
            <View style={s.stepsSec}>
              <Text style={s.secLbl}>Directions · {totalSteps} steps</Text>
              <ScrollView style={{ maxHeight: 160 }} showsVerticalScrollIndicator={false}>
                {activeR.steps.map((step, i) => (
                  <View key={i} style={[s.stepRow, i === stepIdx && s.stepRowOn]}>
                    <View style={[s.stepIconBox, i === stepIdx && s.stepIconBoxOn]}>
                      <Ionicons name={getManeuverIcon(step.maneuver, step.htmlInstruction || '')} size={18} color={i === stepIdx ? '#fff' : '#64748B'} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.stepTxt} numberOfLines={2}>{step.instruction}</Text>
                      <Text style={s.stepMeta}>{step.distance} · {step.duration}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </Animated.View>
      )}

      {navMode === MODE.NAVIGATE && activeR && (
        <View style={[s.etaBar, { backgroundColor: T.mapSurface }]}>
          <View style={s.etaLeft}>
            <Text style={[s.etaTime, { color: T.mapText }]}>{remTime}</Text>
            <View style={s.etaSubRow}>
              <Text style={[s.etaDist, { color: T.textSecondary }]}>{remDist}</Text>
              <Text style={s.etaDivider}> · </Text>
              <Text style={s.etaArrival}>Arrives {fmtArrival(remaining.timeS > 0 ? remaining.timeS : activeR.trafficSeconds)}</Text>
            </View>
          </View>
          <View style={s.etaRight}>
            <View style={[s.etaTrafficPill, { backgroundColor: activeR.traffic.light }]}>
              <Text style={[s.etaTrafficLbl, { color: activeR.traffic.color }]}>{activeR.traffic.label}</Text>
            </View>
            <TouchableOpacity style={[s.endBtn, { backgroundColor: T.accent }]} onPress={stopNav} activeOpacity={0.85}>
              <Text style={s.endBtnTxt}>End</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  map: { flex: 1 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FA', gap: 12 },
  loaderTxt: { fontSize: 15, color: '#444', fontWeight: '500' },

  dotOuter: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(26,115,232,0.20)', alignItems: 'center', justifyContent: 'center' },
  dotInner: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#1A73E8', borderWidth: 3, borderColor: '#FFFFFF', elevation: 8, shadowColor: '#1A73E8', shadowOpacity: 0.5, shadowRadius: 4 },

  modeBar: {
    position: 'absolute', alignSelf: 'center', width: width * 0.9,
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 32, padding: 4,
    elevation: 8, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 10,
  },
  modeBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 28, gap: 3 },
  modeBtnOn: { backgroundColor: '#1A73E8' },
  modeBtnLbl: { fontSize: 10, color: '#666', fontWeight: '600', letterSpacing: 0.3 },
  modeBtnLblOn: { color: '#fff' },

  loadingChip: {
    position: 'absolute', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(26,115,232,0.92)',
    borderRadius: 22, paddingHorizontal: 18, paddingVertical: 9, elevation: 10,
  },
  loadingTxt: { color: '#fff', fontSize: 14, fontWeight: '600' },

  recalcBanner: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1A1A2E', paddingTop: 50, paddingBottom: 16, elevation: 14, zIndex: 14,
  },
  recalcTxt: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  wrongDirBanner: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#D32F2F', paddingBottom: 18, paddingHorizontal: 20, elevation: 14, zIndex: 14,
  },
  wrongDirIconBox: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  wrongDirTitle: { fontSize: 20, fontWeight: '900', color: '#fff' },
  wrongDirSub: { fontSize: 13, color: 'rgba(255,255,255,0.80)', marginTop: 3 },
  wrongDirClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.22)', alignItems: 'center', justifyContent: 'center', marginLeft: 10 },

  statusBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.72)', zIndex: 20, elevation: 20,
  },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5, gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusPillTxt: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },

  dropdownTrigger: { position: 'absolute', right: 16, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  dropdownOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 16 },
  dropdownCard: { backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14, elevation: 16 },
  dropdownTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', padding: 16, paddingBottom: 10 },
  dropdownDivider: { height: 0.5, backgroundColor: '#E2E8F0', marginHorizontal: 16 },
  dropdownItem: { paddingVertical: 15, paddingHorizontal: 20 },
  dropdownItemBorder: { borderBottomWidth: 0.5, borderBottomColor: '#F1F5F9' },
  dropdownItemTxt: { fontSize: 15, fontWeight: '600' },

  navBanner: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 14,
    elevation: 13, zIndex: 13,
  },
  bnrManeuverBox: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)',
    flexShrink: 0,
  },
  bnrManeuverBoxNow: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 2, borderColor: '#fff',
  },
  bnrContent: { flex: 1 },
  bnrCountdown: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: -0.2 },
  bnrInstr: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.90)', marginTop: 1 },
  bnrStepCount: { fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: '600', marginLeft: 6, flexShrink: 0 },

  nextBar: {
    position: 'absolute', left: 12, right: 12,
    backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center',
    elevation: 11, zIndex: 11,
    shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 6,
  },
  nextLabel: { fontSize: 10, fontWeight: '700', color: '#999', marginRight: 6, letterSpacing: 0.5 },
  nextIconBox: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#E8F0FE', alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  nextInstr: { flex: 1, fontSize: 12, fontWeight: '600', color: '#1A1A1A' },
  nextDistPill: { backgroundColor: '#F0F0F0', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 6 },
  nextDistTxt: { fontSize: 10, fontWeight: '700', color: '#555' },

  muteBtn: {
    position: 'absolute', right: 14,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.60)',
    alignItems: 'center', justifyContent: 'center',
    elevation: 12, zIndex: 19,
    shadowColor: '#000', shadowOpacity: 0.20, shadowRadius: 6,
  },

  trafficBadge: { position: 'absolute', left: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, elevation: 6 },
  trafficBadgeTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  hint: { position: 'absolute', right: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.60)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, elevation: 5 },
  hintTxt: { color: '#fff', fontSize: 11, fontWeight: '500' },

  navAltPanel: {
    position: 'absolute', left: 14, right: 14,
    backgroundColor: '#fff', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 14,
    elevation: 18, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, zIndex: 18,
  },
  navAltHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  navAltHeaderTxt: { flex: 1, fontSize: 13, fontWeight: '800', color: '#0F172A', letterSpacing: 0.2 },
  navAltItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderTopWidth: 0.5, borderTopColor: '#F1F5F9' },
  navAltLeft: { flex: 1, marginRight: 8 },
  navAltVia: { fontSize: 13, fontWeight: '600', color: '#1E293B', marginBottom: 2 },
  navAltTime: { fontSize: 12, color: '#64748B' },
  navAltBadge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  navAltBadgeTxt: { fontSize: 11, fontWeight: '700' },

  panel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, elevation: 20, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 16, overflow: 'hidden' },
  panelHandle: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 8 },
  handleBar: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', marginBottom: 12 },

  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  etaTxt: { fontSize: 26, fontWeight: '800', color: '#0F172A' },
  distTxt: { fontSize: 13, color: '#64748B', marginTop: 3 },
  addrTxt: { fontSize: 12, color: '#94A3B8', marginTop: 4 },
  trafficDot: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },

  startBtn: { backgroundColor: '#1A73E8', marginHorizontal: 16, marginBottom: 12, borderRadius: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#1A73E8', shadowOpacity: 0.4, shadowRadius: 8 },
  startBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },

  routeSec: { paddingHorizontal: 16, marginBottom: 8 },
  secLbl: { fontSize: 12, fontWeight: '700', color: '#64748B', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 },
  routeCard: { width: 130, backgroundColor: '#F8FAFF', borderRadius: 16, padding: 12, marginRight: 10, borderWidth: 1.5, borderColor: '#E2E8F0' },
  routeCardOn: { borderColor: '#1A73E8', backgroundColor: '#EFF6FF' },
  routeBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6, alignSelf: 'flex-start' },
  routeBadgeTxt: { fontSize: 11, fontWeight: '700' },
  routeEta: { fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 3 },
  routeDist: { fontSize: 12, color: '#64748B' },
  routeName: { fontSize: 12, color: '#94A3B8', marginTop: 4 },

  stepsSec: { paddingHorizontal: 16 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  stepRowOn: { backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 8 },
  stepIconBox: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepIconBoxOn: { backgroundColor: '#1A73E8' },
  stepTxt: { fontSize: 13, color: '#1E293B', fontWeight: '500' },
  stepMeta: { fontSize: 11, color: '#94A3B8', marginTop: 3 },

  etaBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderTopLeftRadius: 24, borderTopRightRadius: 24, elevation: 20, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12 },
  etaLeft: { flex: 1 },
  etaTime: { fontSize: 28, fontWeight: '900', color: '#0F172A' },
  etaSubRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  etaDist: { fontSize: 13, color: '#64748B' },
  etaDivider: { fontSize: 13, color: '#CBD5E1' },
  etaArrival: { fontSize: 13, color: '#64748B' },
  etaRight: { alignItems: 'flex-end', gap: 10 },
  etaTrafficPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, gap: 5 },
  etaTrafficLbl: { fontSize: 12, fontWeight: '600' },
  endBtn: { backgroundColor: '#1A73E8', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12, elevation: 4 },
  endBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },

  destDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#EF4444' },
  destDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' },
});