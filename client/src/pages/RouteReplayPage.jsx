/**
 * RouteReplayPage — Route Replay with 30-second breadcrumbs
 *
 * Features:
 * - Fetches trip location history from DB by ticket_no (trip_status = 'accepted' onward)
 * - Plots breadcrumb trail on map (green dots every 30s)
 * - Right-side activity panel (Start / Moving / Stopped events like screenshot)
 * - Playback controls: Play, Pause, Speed (1x/2x/4x), Scrubber
 * - "Showing" search box at top-right like the screenshot
 * - Back button returns to LiveTrackingPage
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  ArrowLeftOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  EnvironmentOutlined,
  ClockCircleOutlined,
  CarOutlined,
  StopOutlined,
  CheckCircleOutlined,
  SearchOutlined,
  CloseOutlined,
  FastForwardOutlined,
  NodeIndexOutlined,
  AimOutlined,
} from '@ant-design/icons';

import { API_BASE_URL, GOOGLE_MAPS_API_KEY } from '../config/apiConfig';

// ── Dark map styles (matching LiveTrackingPage) ────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  let h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

function fmtDuration(startStr, endStr) {
  if (!startStr || !endStr) return '';
  const diff = Math.abs(new Date(endStr) - new Date(startStr));
  const totalMin = Math.round(diff / 60000);
  if (totalMin < 60) return `${totalMin} mins`;
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} mins`;
}

function fmtDist(meters) {
  if (!meters || meters <= 0) return '';
  return meters >= 1000 ? (meters / 1000).toFixed(1) + ' miles' : Math.round(meters) + ' m';
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, φ1 = la1 * Math.PI / 180, φ2 = la2 * Math.PI / 180;
  const dφ = (la2 - la1) * Math.PI / 180, dλ = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Build activity segments from raw points ───────────────────────────────────
// Groups consecutive points into Moving / Stopped segments
function buildActivitySegments(points) {
  if (!points.length) return [];
  const STOP_SPEED_KMH = 2;       // below this → stopped
  const STOP_GAP_MS = 60 * 1000;  // >60s gap without movement → stopped

  const segments = [];
  let i = 0;

  while (i < points.length) {
    const p = points[i];
    const spd = parseFloat(p.speed) || 0;

    if (spd <= STOP_SPEED_KMH) {
      // Find end of stop
      const stopStart = p;
      let j = i + 1;
      while (j < points.length && (parseFloat(points[j].speed) || 0) <= STOP_SPEED_KMH) j++;
      const stopEnd = points[j - 1];
      segments.push({
        type: 'stopped',
        start: stopStart.timestamp,
        end: stopEnd.timestamp,
        lat: parseFloat(stopStart.latitude),
        lng: parseFloat(stopStart.longitude),
        location: stopStart.location_info || '',
        pointIdx: i,
      });
      i = j;
    } else {
      // Find end of moving segment
      const moveStart = p;
      let j = i + 1;
      let totalDist = 0;
      let prevP = p;
      let speedingEvents = 0;
      while (j < points.length && (parseFloat(points[j].speed) || 0) > STOP_SPEED_KMH) {
        const cur = points[j];
        totalDist += haversine(
          parseFloat(prevP.latitude), parseFloat(prevP.longitude),
          parseFloat(cur.latitude), parseFloat(cur.longitude)
        );
        if ((parseFloat(cur.speed) || 0) > 80) speedingEvents++;
        prevP = cur;
        j++;
      }
      const moveEnd = points[j - 1];
      segments.push({
        type: 'moving',
        start: moveStart.timestamp,
        end: moveEnd.timestamp,
        distM: totalDist,
        speedingEvents,
        pointIdx: i,
        endPointIdx: j - 1,
      });
      i = j;
    }
  }

  // Prepend a "Start" event at the very beginning
  if (segments.length > 0 && points.length > 0) {
    segments.unshift({
      type: 'start',
      start: points[0].timestamp,
      lat: parseFloat(points[0].latitude),
      lng: parseFloat(points[0].longitude),
      location: points[0].location_info || '',
      pointIdx: 0,
    });
  }

  return segments;
}

// ── Breadcrumb dot SVG ────────────────────────────────────────────────────────
function makeDotSvg(color = '#34A853', size = 10, withRing = false) {
  if (withRing) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="8" fill="none" stroke="${color}" stroke-width="2" opacity="0.5"/>
      <circle cx="10" cy="10" r="5" fill="${color}" stroke="white" stroke-width="1.5"/>
    </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="${color}" stroke="white" stroke-width="1"/>
  </svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function RouteReplayPage() {
  const navigate = useNavigate();
  const { id } = useParams();           // ticket_no / alert id
  const location = useLocation();
  const alertObj = location.state?.alert || null;

  // Map refs
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const breadcrumbMarkers = useRef([]);
  const vehicleMarker = useRef(null);
  const pathPolyline = useRef(null);
  const traveledPolyline = useRef(null);

  // Data
  const [allPoints, setAllPoints] = useState([]);       // raw DB rows
  const [segments, setSegments] = useState([]);         // activity segments
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unitId, setUnitId] = useState(alertObj?.assignedUnit || '');
  const [searchQuery, setSearchQuery] = useState(alertObj?.assignedUnit || '');

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1);        // 1x / 2x / 4x
  const [currentIdx, setCurrentIdx] = useState(0);
  const [activeSegmentIdx, setActiveSegmentIdx] = useState(null);
  const playTimerRef = useRef(null);
  const currentIdxRef = useRef(0);
  const allPointsRef = useRef([]);

  // ── Fetch trip data from DB ────────────────────────────────────────────────
  const fetchTripData = useCallback(async (ticketNo) => {
    if (!ticketNo) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch location history for this ticket, filtered from 'accepted' status onward
      const res = await fetch(
        `${API_BASE_URL}/api/unit-locations/replay?ticket_no=${encodeURIComponent(ticketNo)}`,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log("response for th eroute replay page is ",data);

      // Filter: only rows where trip_status is a started status (accepted → completed)
      const STARTED_STATUSES = ['accepted', 'en_route', 'arrived', 'on_action', 'completed'];
      const filtered = (data.rows || data || [])
        .filter(row => STARTED_STATUSES.includes((row.trip_status || '').toLowerCase()))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      setAllPoints(filtered);
      allPointsRef.current = filtered;
      setCurrentIdx(0);
      currentIdxRef.current = 0;
      setSegments(buildActivitySegments(filtered));
      if (filtered.length > 0) setUnitId(filtered[0].unit_id || ticketNo);
    } catch (e) {
      setError('Failed to load route data: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    const ticketNo = alertObj?.ticketNo || alertObj?.ticket_no || id;
    setSearchQuery(ticketNo || '');
    fetchTripData(ticketNo);
  }, [id]);

  // ── Init Google Map ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapObj.current || !window.google?.maps) return;
    mapObj.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: 11.0168, lng: 76.9558 },
      zoom: 13,
      styles: DARK_MAP_STYLES,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
    });
  }, []);

  // ── Draw ALL breadcrumbs on map when data loads ────────────────────────────
  useEffect(() => {
    if (!mapObj.current || !window.google?.maps || allPoints.length === 0) return;

    // Clear old markers
    breadcrumbMarkers.current.forEach(m => m.setMap(null));
    breadcrumbMarkers.current = [];
    if (pathPolyline.current) pathPolyline.current.setMap(null);
    if (traveledPolyline.current) traveledPolyline.current.setMap(null);

    const path = allPoints.map(p => ({
      lat: parseFloat(p.latitude),
      lng: parseFloat(p.longitude),
    }));

    // Draw full path (gray)
    pathPolyline.current = new window.google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: '#555',
      strokeOpacity: 0.5,
      strokeWeight: 2,
      map: mapObj.current,
    });

    // Draw traveled path (green) — initially empty
    traveledPolyline.current = new window.google.maps.Polyline({
      path: [],
      geodesic: true,
      strokeColor: '#34A853',
      strokeOpacity: 0.85,
      strokeWeight: 3,
      map: mapObj.current,
    });

    // Draw dots every 30s (or every point if < 30s interval)
    let lastDotTime = null;
    allPoints.forEach((p, i) => {
      const t = new Date(p.timestamp).getTime();
      const shouldDraw =
        i === 0 ||
        i === allPoints.length - 1 ||
        !lastDotTime ||
        t - lastDotTime >= 30000;

      if (!shouldDraw) return;
      lastDotTime = t;

      const isFirst = i === 0;
      const isLast = i === allPoints.length - 1;
      const isStopped = (parseFloat(p.speed) || 0) <= 2;

      let color = '#34A853'; // green = moving
      let size = 10;
      if (isFirst) { color = '#1A73E8'; size = 14; }      // blue start
      else if (isLast) { color = '#E53935'; size = 14; }   // red end
      else if (isStopped) { color = '#F9A825'; size = 10; } // yellow stop

      const svg = isFirst || isLast
        ? makeDotSvg(color, size, true)
        : makeDotSvg(color, size, false);

      const mkr = new window.google.maps.Marker({
        position: { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) },
        map: mapObj.current,
        zIndex: isFirst || isLast ? 100 : 50,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
          scaledSize: new window.google.maps.Size(size + 4, size + 4),
          anchor: new window.google.maps.Point((size + 4) / 2, (size + 4) / 2),
        },
        title: `${fmtTime(p.timestamp)} — ${p.location_info || ''}`,
      });

      // InfoWindow on click
      mkr.addListener('click', () => {
        const iw = new window.google.maps.InfoWindow({
          content: `<div style="font-family:Sora,sans-serif;font-size:12px;padding:4px;color:#000;">
            <b>${fmtTime(p.timestamp)}</b><br/>
            Speed: ${parseFloat(p.speed || 0).toFixed(1)} km/h<br/>
            ${p.location_info ? `📍 ${p.location_info}` : ''}
            ${p.remarks ? `<br/>📝 ${p.remarks}` : ''}
          </div>`,
        });
        iw.open(mapObj.current, mkr);
      });

      breadcrumbMarkers.current.push(mkr);
    });

    // Vehicle marker (animated dot)
    if (vehicleMarker.current) vehicleMarker.current.setMap(null);
    const firstP = allPoints[0];
    vehicleMarker.current = new window.google.maps.Marker({
      position: { lat: parseFloat(firstP.latitude), lng: parseFloat(firstP.longitude) },
      map: mapObj.current,
      zIndex: 200,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
            <defs><filter id="glow"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#34A853" flood-opacity="0.9"/></filter></defs>
            <circle cx="16" cy="16" r="12" fill="#1A73E8" stroke="white" stroke-width="2.5" filter="url(#glow)"/>
            <circle cx="16" cy="16" r="5" fill="white"/>
          </svg>`),
        scaledSize: new window.google.maps.Size(32, 32),
        anchor: new window.google.maps.Point(16, 16),
      },
    });

    // Fit map to all points
    const bounds = new window.google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    if (!bounds.isEmpty()) mapObj.current.fitBounds(bounds, { padding: 40 });

    setCurrentIdx(0);
    currentIdxRef.current = 0;

  }, [allPoints]);

  // ── Update vehicle position + traveled path during playback ───────────────
  const updateMapPosition = useCallback((idx) => {
    if (!mapObj.current || !allPoints[idx]) return;
    const p = allPoints[idx];
    const pos = { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) };

    if (vehicleMarker.current) vehicleMarker.current.setPosition(pos);

    // Update traveled polyline
    if (traveledPolyline.current) {
      const traveled = allPoints.slice(0, idx + 1).map(pt => ({
        lat: parseFloat(pt.latitude),
        lng: parseFloat(pt.longitude),
      }));
      traveledPolyline.current.setPath(traveled);
    }

    // Pan map to keep vehicle visible
    if (mapObj.current) {
      const bounds = mapObj.current.getBounds();
      if (bounds && !bounds.contains(pos)) {
        mapObj.current.panTo(pos);
      }
    }

    // Highlight active segment
    const segIdx = segments.findLastIndex(
      seg => seg.pointIdx <= idx
    );
    setActiveSegmentIdx(segIdx >= 0 ? segIdx : null);
  }, [allPoints, segments]);

  // ── Playback timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      return;
    }

    const INTERVAL_MS = Math.max(100, Math.round(500 / playSpeed));

    playTimerRef.current = setInterval(() => {
      const next = currentIdxRef.current + 1;
            if (next >= allPointsRef.current.length) {
        // 🔁 RESET AUTOMATICALLY
        currentIdxRef.current = 0;
        setCurrentIdx(0);
        updateMapPosition(0);
        return;
        }
      currentIdxRef.current = next;
      setCurrentIdx(next);
      updateMapPosition(next);
    }, INTERVAL_MS);

    return () => clearInterval(playTimerRef.current);
  }, [isPlaying, playSpeed, updateMapPosition]);

  // ── Scrubber change ────────────────────────────────────────────────────────
  const handleScrub = (e) => {
    const idx = parseInt(e.target.value);
    currentIdxRef.current = idx;
    setCurrentIdx(idx);
    updateMapPosition(idx);
  };

  // ── Jump to segment ────────────────────────────────────────────────────────
  const jumpToSegment = (seg) => {
    const idx = seg.pointIdx || 0;
    currentIdxRef.current = idx;
    setCurrentIdx(idx);
    updateMapPosition(idx);
    if (mapObj.current && seg.lat) {
      mapObj.current.panTo({ lat: seg.lat, lng: seg.lng });
      mapObj.current.setZoom(15);
    }
  };

  // ── Search / reload ────────────────────────────────────────────────────────
  const handleSearch = () => {
    if (searchQuery.trim()) fetchTripData(searchQuery.trim());
  };

  const handleReset = () => {
    setIsPlaying(false);
    currentIdxRef.current = 0;
    setCurrentIdx(0);
    updateMapPosition(0);
  };

  const currentPoint = allPoints[currentIdx] || null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={rs.root}>
      {/* ── Map area ─────────────────────────────────────────────────────── */}
      <div style={rs.mapWrap}>

        {/* Top bar */}
        <div style={rs.topBar}>
          <button
            style={rs.backBtn}
            onClick={() => navigate(-1)}
          >
            <ArrowLeftOutlined style={{ fontSize: 12, verticalAlign: 'middle' }} /> Back
          </button>

          <div style={rs.titlePill}>
            <NodeIndexOutlined style={{ fontSize: 16, color: '#1A73E8' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#E6EDF3' }}>Route Replay</div>
              <div style={{ fontSize: 10, color: '#8B949E' }}>
                {unitId || id} · {allPoints.length} points
                {allPoints.length > 0 && ` · ${fmtTime(allPoints[0]?.timestamp)} – ${fmtTime(allPoints[allPoints.length - 1]?.timestamp)}`}
              </div>
            </div>
          </div>

          {/* Playback controls */}
          <div style={rs.controls}>
            <button style={rs.ctrlBtn} onClick={handleReset} title="Reset">
              <ReloadOutlined style={{ fontSize: 13 }} />
            </button>
            <button
              style={{ ...rs.ctrlBtn, ...rs.playBtn }}
              onClick={() => {
                // 🔁 if already reached end → restart
                if (currentIdx >= allPoints.length - 1) {
                    currentIdxRef.current = 0;
                    setCurrentIdx(0);
                    updateMapPosition(0);
                }

                // ▶️ toggle play/pause
                setIsPlaying(v => !v);
                }}
              disabled={allPoints.length === 0}
            >
              {isPlaying
                ? <PauseCircleOutlined style={{ fontSize: 16 }} />
                : <PlayCircleOutlined style={{ fontSize: 16 }} />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            {/* Speed selector */}
            <select
            value={playSpeed}
            onChange={(e) => setPlaySpeed(Number(e.target.value))}
            style={rs.ctrlBtn}
            >
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
            </select>
          </div>
        </div>

        {/* Scrubber */}
        {allPoints.length > 0 && (
          <div style={rs.scrubWrap}>
            <span style={rs.scrubTime}>{fmtTime(allPoints[0]?.timestamp)}</span>
            <input
              type="range"
              min={0}
              max={allPoints.length - 1}
              value={currentIdx}
              onChange={handleScrub}
              style={rs.scrubInput}
            />
            <span style={rs.scrubTime}>{fmtTime(allPoints[allPoints.length - 1]?.timestamp)}</span>
            <span style={rs.scrubIdx}>
              {currentIdx + 1} / {allPoints.length}
            </span>
          </div>
        )}

        {/* Current point info pill */}
        {currentPoint && (
          <div style={rs.infoPill}>
            <AimOutlined style={{ color: '#1A73E8', fontSize: 13 }} />
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#E6EDF3' }}>
                {fmtTime(currentPoint.timestamp)}
              </div>
              <div style={{ fontSize: 9, color: '#8B949E' }}>
                {parseFloat(currentPoint.speed || 0).toFixed(1)} km/h
                {currentPoint.location_info ? ` · ${currentPoint.location_info}` : ''}
              </div>
            </div>
          </div>
        )}

        {/* Map */}
        {loading && (
          <div style={rs.loadingOverlay}>
            <ReloadOutlined style={{ fontSize: 28, color: '#1A73E8', animation: 'spin 1s linear infinite' }} />
            <div style={{ color: '#E6EDF3', fontSize: 14, fontWeight: 700, marginTop: 12 }}>Loading route data…</div>
          </div>
        )}
        {error && (
          <div style={rs.loadingOverlay}>
            <div style={{ color: '#E53935', fontSize: 14, fontWeight: 700 }}>⚠ {error}</div>
            <button style={{ ...rs.backBtn, marginTop: 12 }} onClick={() => fetchTripData(id)}>Retry</button>
          </div>
        )}
        <div ref={mapRef} style={rs.map} />
      </div>

      {/* ── Right-side Replay Panel (like screenshot) ─────────────────────── */}
      <div style={rs.panel}>
        {/* Replay header */}
        <div style={rs.panelHeader}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#E6EDF3' }}>Replay</div>
          <button style={rs.panelCloseBtn} onClick={() => navigate(-1)}>
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </div>

        {/* Showing search */}
        <div style={rs.panelSection}>
          <div style={{ fontSize: 10, color: '#8B949E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Showing
          </div>
          <div style={rs.searchBox}>
            <SearchOutlined style={{ fontSize: 12, color: '#8B949E' }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Ticket / Unit ID"
              style={rs.searchInput}
            />
            {searchQuery && (
              <button style={rs.searchClear} onClick={() => setSearchQuery('')}>
                <CloseOutlined style={{ fontSize: 10 }} />
              </button>
            )}
          </div>
          <button style={rs.searchBtn} onClick={handleSearch}>
            Search
          </button>
        </div>

        {/* Date */}
        {allPoints.length > 0 && (
          <div style={rs.panelSection}>
            <div style={rs.dateRow}>
              <ClockCircleOutlined style={{ fontSize: 13, color: '#8B949E' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#E6EDF3' }}>
                {new Date(allPoints[0].timestamp).toLocaleDateString('en-US', {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                })}
              </span>
            </div>
          </div>
        )}

        {/* Activity list */}
        <div style={rs.activityHeader}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#E6EDF3' }}>Activity</span>
          <span style={{ fontSize: 10, color: '#8B949E' }}>{segments.length} events</span>
        </div>

        <div style={rs.activityList}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 24, color: '#8B949E', fontSize: 12 }}>
              <ReloadOutlined style={{ marginRight: 6 }} /> Loading…
            </div>
          )}
          {!loading && segments.length === 0 && (
            <div style={{ textAlign: 'center', padding: 24, color: '#8B949E', fontSize: 12 }}>
              No trip data found for this ticket.
            </div>
          )}

          {segments.map((seg, i) => {
            const isActive = activeSegmentIdx === i;
            return (
              <div
                key={i}
                style={{ ...rs.segItem, ...(isActive ? rs.segItemActive : {}) }}
                onClick={() => jumpToSegment(seg)}
              >
                {/* Icon column */}
                <div style={rs.segIconCol}>
                  <div style={{
                    ...rs.segDot,
                    background:
                      seg.type === 'start' ? '#1A73E8' :
                      seg.type === 'moving' ? '#34A853' :
                      '#F9A825',
                    boxShadow: isActive ? `0 0 8px ${seg.type === 'moving' ? '#34A853' : seg.type === 'start' ? '#1A73E8' : '#F9A825'}88` : 'none',
                  }}>
                    {seg.type === 'start' && <EnvironmentOutlined style={{ fontSize: 9, color: 'white' }} />}
                    {seg.type === 'moving' && <CarOutlined style={{ fontSize: 9, color: 'white' }} />}
                    {seg.type === 'stopped' && <StopOutlined style={{ fontSize: 9, color: 'white' }} />}
                  </div>
                  {i < segments.length - 1 && <div style={rs.segLine} />}
                </div>

                {/* Content */}
                <div style={rs.segContent}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{
                      fontSize: 12, fontWeight: 800,
                      color: seg.type === 'start' ? '#1A73E8' :
                             seg.type === 'moving' ? '#34A853' :
                             '#F9A825'
                    }}>
                      {seg.type === 'start' ? 'Start' :
                       seg.type === 'moving' ? 'Moving' : 'Stopped'}
                    </span>
                    <span style={{ fontSize: 10, color: '#8B949E', fontFamily: 'JetBrains Mono, monospace' }}>
                      {fmtTime(seg.start)}
                    </span>
                  </div>

                  {/* Location */}
                  {(seg.type === 'start' || seg.type === 'stopped') && seg.location && (
                    <div style={{ fontSize: 10, color: '#8B949E', marginTop: 2, wordBreak: 'break-word' }}>
                      {seg.location}
                    </div>
                  )}

                  {/* Moving stats */}
                  {seg.type === 'moving' && (
                    <div style={{ fontSize: 10, color: '#8B949E', marginTop: 2 }}>
                      {fmtDuration(seg.start, seg.end)}
                      {seg.distM > 0 && ` • ${fmtDist(seg.distM)}`}
                      {seg.speedingEvents > 0 && (
                        <span style={{ color: '#F9A825', marginLeft: 4 }}>
                          ⚠ {seg.speedingEvents} speeding event{seg.speedingEvents !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Stopped duration */}
                  {seg.type === 'stopped' && seg.end && (
                    <div style={{ fontSize: 10, color: '#8B949E', marginTop: 2 }}>
                      Stop Duration: {fmtDuration(seg.start, seg.end)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary strip at bottom */}
        {allPoints.length > 0 && (
          <div style={rs.summaryStrip}>
            <div style={rs.sumStat}>
              <div style={rs.sumLabel}>Total Points</div>
              <div style={rs.sumVal}>{allPoints.length}</div>
            </div>
            <div style={rs.sumStat}>
              <div style={rs.sumLabel}>Duration</div>
              <div style={rs.sumVal}>
                {fmtDuration(allPoints[0]?.timestamp, allPoints[allPoints.length - 1]?.timestamp)}
              </div>
            </div>
            <div style={rs.sumStat}>
              <div style={rs.sumLabel}>Max Speed</div>
              <div style={rs.sumVal}>
                {Math.max(...allPoints.map(p => parseFloat(p.speed) || 0)).toFixed(0)} km/h
              </div>
            </div>
            <div style={rs.sumStat}>
              <div style={rs.sumLabel}>Stops</div>
              <div style={rs.sumVal}>{segments.filter(s => s.type === 'stopped').length}</div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input[type=range] { -webkit-appearance: none; width: 100%; height: 4px; border-radius: 2px; background: #30363D; outline: none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #1A73E8; cursor: pointer; border: 2px solid white; }
        input[type=range]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #1A73E8; cursor: pointer; border: 2px solid white; }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const rs = {
  root: { position: 'fixed', inset: 0, zIndex: 100, background: '#0D1117', display: 'flex', flexDirection: 'row', fontFamily: 'Sora, sans-serif' },
  mapWrap: { flex: 1, position: 'relative', overflow: 'hidden' },
  map: { width: '100%', height: '100%' },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px',
    background: 'linear-gradient(180deg,rgba(13,17,23,.97) 0%,transparent 100%)',
    pointerEvents: 'none',
  },
  backBtn: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
    borderRadius: 9, background: '#161B22', border: '1px solid #30363D',
    color: '#E6EDF3', fontFamily: 'Sora, sans-serif', fontSize: 12,
    fontWeight: 700, cursor: 'pointer', pointerEvents: 'auto',
  },
  titlePill: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: 'rgba(22,27,34,.9)', border: '1px solid #30363D',
    borderRadius: 11, padding: '8px 14px', backdropFilter: 'blur(8px)',
    pointerEvents: 'auto',
  },
  controls: {
    display: 'flex', alignItems: 'center', gap: 7,
    marginLeft: 'auto', pointerEvents: 'auto',
  },
  ctrlBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '7px 12px', borderRadius: 9, background: '#161B22',
    border: '1px solid #30363D', color: '#8B949E',
    fontFamily: 'Sora, sans-serif', fontSize: 11, fontWeight: 700,
    cursor: 'pointer',
  },
  ctrlBtnActive: {
    background: 'rgba(26,115,232,.15)', borderColor: 'rgba(26,115,232,.4)',
    color: '#1A73E8',
  },
  playBtn: {
    background: 'rgba(52,168,83,.15)', borderColor: 'rgba(52,168,83,.4)',
    color: '#34A853', fontSize: 12,
  },

  scrubWrap: {
    position: 'absolute', bottom: 60, left: 16, right: 16, zIndex: 30,
    display: 'flex', alignItems: 'center', gap: 10,
    background: 'rgba(13,17,23,.9)', border: '1px solid #30363D',
    borderRadius: 12, padding: '10px 16px', backdropFilter: 'blur(8px)',
  },
  scrubTime: { fontSize: 10, color: '#8B949E', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' },
  scrubInput: { flex: 1, cursor: 'pointer' },
  scrubIdx: { fontSize: 9, color: '#8B949E', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' },

  infoPill: {
    position: 'absolute', bottom: 110, left: 16, zIndex: 30,
    display: 'flex', alignItems: 'center', gap: 9,
    background: 'rgba(13,17,23,.92)', border: '1px solid rgba(26,115,232,.3)',
    borderRadius: 10, padding: '8px 12px', backdropFilter: 'blur(8px)',
  },

  loadingOverlay: {
    position: 'absolute', inset: 0, zIndex: 40,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: '#0D1117',
  },

  // ── Right panel ──────────────────────────────────────────────────────────
  panel: {
    width: 320, flexShrink: 0, background: '#161B22',
    borderLeft: '1px solid #30363D', display: 'flex',
    flexDirection: 'column', overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 18px 12px', borderBottom: '1px solid #30363D',
  },
  panelCloseBtn: {
    background: 'none', border: '1px solid #30363D', borderRadius: 6,
    color: '#8B949E', cursor: 'pointer', padding: '4px 8px',
    fontSize: 12, display: 'flex', alignItems: 'center',
  },
  panelSection: { padding: '12px 18px', borderBottom: '1px solid #30363D' },

  searchBox: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#0D1117', border: '1px solid #30363D',
    borderRadius: 8, padding: '7px 10px', marginBottom: 8,
  },
  searchInput: {
    flex: 1, background: 'transparent', border: 'none', outline: 'none',
    color: '#E6EDF3', fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
  },
  searchClear: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#8B949E', padding: 0, display: 'flex', alignItems: 'center',
  },
  searchBtn: {
    width: '100%', padding: '7px 0', borderRadius: 8,
    background: 'rgba(26,115,232,.12)', border: '1px solid rgba(26,115,232,.3)',
    color: '#82B4FF', fontFamily: 'Sora, sans-serif', fontSize: 11,
    fontWeight: 700, cursor: 'pointer',
  },

  dateRow: { display: 'flex', alignItems: 'center', gap: 8 },

  activityHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 18px 6px', borderBottom: '1px solid #30363D',
  },
  activityList: { flex: 1, overflowY: 'auto', padding: '4px 0' },

  segItem: {
    display: 'flex', gap: 0, padding: '10px 18px',
    cursor: 'pointer', transition: 'background .15s',
    borderBottom: '1px solid rgba(48,54,61,.4)',
  },
  segItemActive: { background: 'rgba(26,115,232,.06)' },

  segIconCol: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  segDot: {
    width: 24, height: 24, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'box-shadow .2s',
  },
  segLine: { width: 2, flex: 1, minHeight: 16, background: '#30363D', margin: '3px 0' },
  segContent: { flex: 1, minWidth: 0, paddingBottom: 6 },

  summaryStrip: {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
    gap: 8, padding: '12px 18px',
    borderTop: '1px solid #30363D', background: '#0D1117',
  },
  sumStat: { background: '#161B22', border: '1px solid #30363D', borderRadius: 8, padding: '8px 10px' },
  sumLabel: { fontSize: 9, color: '#8B949E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 },
  sumVal: { fontSize: 15, fontWeight: 800, color: '#E6EDF3', fontFamily: 'JetBrains Mono, monospace' },
};