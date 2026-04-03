import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getUnits } from '../api/api';

const DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#1a1f2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1f2e' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#8b949e' }] },
  { featureType: 'road',        elementType: 'geometry',  stylers: [{ color: '#2d3748' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3d4f6e' }] },
  { featureType: 'water',       elementType: 'geometry',  stylers: [{ color: '#0d1117' }] },
  { featureType: 'poi',         stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',     stylers: [{ visibility: 'off' }] },
];

const NEARBY_TYPES = {
  hospital:     { label: 'Hospital',       icon: '🏥', color: '#E53935', placeType: 'hospital',     radius: 5000 },
  blood_bank:   { label: 'Blood Bank',     icon: '🩸', color: '#D32F2F', placeType: 'blood_bank',   radius: 8000 },
  police:       { label: 'Police Station', icon: '🚔', color: '#1565C0', placeType: 'police',       radius: 5000 },
  fire_station: { label: 'Fire Station',   icon: '🚒', color: '#FF6D00', placeType: 'fire_station', radius: 5000 },
  pharmacy:     { label: 'Pharmacy',       icon: '💊', color: '#7B1FA2', placeType: 'pharmacy',     radius: 3000 },
};

const UNIT_COLORS = { ambulance: '#4CAF50', fire: '#FB8C00', police: '#1E88E5', rescue: '#8E24AA', hazmat: '#F57F17' };
const UNIT_ICONS  = { ambulance: '🚑', fire: '🚒', police: '🚔', rescue: '🚁', hazmat: '☢️' };

function haversineMetres(la1, lo1, la2, lo2) {
  const R = 6371000, φ1 = la1 * Math.PI / 180, φ2 = la2 * Math.PI / 180;
  const dφ = (la2 - la1) * Math.PI / 180, dλ = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }
function fmtEta(m)  { const mins = Math.round(m / 1000 / 30 * 3600 / 60); return mins < 1 ? '<1 min' : mins < 60 ? mins + ' min' : Math.floor(mins / 60) + 'h ' + mins % 60 + 'm'; }

function destPinSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><path d="M14 0C6 0 0 6 0 14C0 25 14 36 14 36S28 25 28 14C28 6 22 0 14 0Z" fill="#E53935" stroke="white" stroke-width="2"/><circle cx="14" cy="14" r="5" fill="white"/></svg>`;
}

/* ──────────────────────────────────────────────────────────
   Map 1: Nearby Resources
   ────────────────────────────────────────────────────────── */
function ResourcesMap({ pickedLat, pickedLng }) {
  const mapRef    = useRef(null);
  const mapObj    = useRef(null);
  const destMkr   = useRef(null);
  const markers   = useRef({});
  const infoWin   = useRef(null);
  const [radius,  setRadius]  = useState(5);
  const [loading, setLoading] = useState(false);
  const [data,    setData]    = useState({});
  const [layers,  setLayers]  = useState(Object.fromEntries(Object.keys(NEARBY_TYPES).map(k => [k, true])));

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;
    if (!window.google?.maps) return;
    mapObj.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: pickedLat || 11.0168, lng: pickedLng || 76.9558 },
      zoom: 13, styles: DARK_MAP_STYLES, mapTypeControl: false, streetViewControl: false,
    });
    infoWin.current = new window.google.maps.InfoWindow();
  });

  // Update dest marker
  useEffect(() => {
    if (!mapObj.current || !pickedLat || !pickedLng) return;
    if (destMkr.current) destMkr.current.setMap(null);
    destMkr.current = new window.google.maps.Marker({
      position: { lat: pickedLat, lng: pickedLng }, map: mapObj.current, zIndex: 200,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(destPinSvg()),
        scaledSize: new window.google.maps.Size(28, 36),
        anchor: new window.google.maps.Point(14, 36),
      },
    });
    mapObj.current.setCenter({ lat: pickedLat, lng: pickedLng });
  }, [pickedLat, pickedLng]);

  const search = useCallback(async () => {
    if (!pickedLat || !pickedLng || !mapObj.current || !window.google?.maps?.places) return;
    setLoading(true); setData({});
    const searches = Object.entries(NEARBY_TYPES).map(([key, cfg]) =>
      new Promise(resolve => {
        const svc = new window.google.maps.places.PlacesService(mapObj.current);
        svc.nearbySearch(
          { location: { lat: pickedLat, lng: pickedLng }, radius: radius * 1000, type: cfg.placeType },
          (results, status) => {
            if (status === window.google.maps.places.PlacesServiceStatus.OK && results) {
              resolve({ key, places: results.map(p => ({
                name: p.name,
                lat: p.geometry.location.lat(),
                lng: p.geometry.location.lng(),
                vicinity: p.vicinity || '',
                rating: p.rating || null,
                place_id: p.place_id,
              })) });
            } else {
              resolve({ key, places: [] });
            }
          }
        );
      })
    );
    const results = await Promise.allSettled(searches);
    const newData = {};
    results.forEach(r => { if (r.status === 'fulfilled') newData[r.value.key] = r.value.places; });
    setData(newData);
    // Place markers
    Object.entries(newData).forEach(([key, places]) => {
      if (markers.current[key]) markers.current[key].forEach(m => m.setMap(null));
      markers.current[key] = [];
      const cfg = NEARBY_TYPES[key];
      places.forEach(p => {
        const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="${cfg.color}" stroke="white" stroke-width="2"/><text x="15" y="20" text-anchor="middle" font-size="13">${cfg.icon}</text></svg>`;
        const mk = new window.google.maps.Marker({
          position: { lat: p.lat, lng: p.lng }, map: layers[key] ? mapObj.current : null,
          title: p.name, zIndex: 20,
          icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(iconSvg),
            scaledSize: new window.google.maps.Size(30, 30),
            anchor: new window.google.maps.Point(15, 15),
          },
        });
        const d = haversineMetres(pickedLat, pickedLng, p.lat, p.lng);
        mk.addListener('click', () => {
          infoWin.current.setContent(`<div style="font-family:Sora,sans-serif;padding:8px;min-width:170px;">
            <div style="font-weight:800;font-size:13px;margin-bottom:4px;">${cfg.icon} ${p.name}</div>
            <div style="font-size:11px;color:#555;margin-bottom:6px;">${p.vicinity}</div>
            <div style="display:flex;gap:10px;font-size:11px;margin-bottom:6px;">
              <span style="color:#1E88E5;font-weight:700;">${fmtDist(d)}</span>
              <span style="color:#34A853;font-weight:700;">${fmtEta(d)}</span>
              ${p.rating ? `<span>⭐ ${p.rating}</span>` : ''}
            </div>
            <a href="https://www.google.com/maps/search/?api=1&query_place_id=${p.place_id}" target="_blank"
              style="display:block;background:${cfg.color};color:#fff;border-radius:7px;padding:7px;font-size:11px;font-weight:700;text-align:center;text-decoration:none;">📍 Open Maps</a>
          </div>`);
          infoWin.current.open(mapObj.current, mk);
        });
        markers.current[key].push(mk);
      });
    });
    setLoading(false);
  }, [pickedLat, pickedLng, radius, layers]);

  // Auto-search when section opens
  useEffect(() => {
    if (pickedLat && pickedLng && mapObj.current) {
      search();
    }
  }, [pickedLat, pickedLng]); // eslint-disable-line

  const toggleLayer = (key) => {
    setLayers(prev => {
      const next = { ...prev, [key]: !prev[key] };
      if (markers.current[key]) markers.current[key].forEach(m => m.setMap(next[key] ? mapObj.current : null));
      return next;
    });
  };

  const allPlaces = Object.entries(data).flatMap(([key, places]) =>
    places.map(p => ({ ...p, d: haversineMetres(pickedLat, pickedLng, p.lat, p.lng), cfg: NEARBY_TYPES[key] }))
  ).sort((a, b) => a.d - b.d);

  const total = allPlaces.length;

  return (
    <div style={s.mapPanel}>
      {/* Header */}
      <div style={s.panelHeader}>
        <div style={s.panelTitle}>🏥 Nearby Resources <span style={s.badgeBlue}>{total} found</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 10, color: '#8B949E' }}>Radius:</span>
          <input type="range" min={1} max={20} value={radius}
            onChange={e => setRadius(parseInt(e.target.value))}
            style={{ width: 70, accentColor: '#1A73E8' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#82B4FF', minWidth: 28 }}>{radius} km</span>
          <button style={s.iconBtn} onClick={search} disabled={loading}>
            {loading ? '⏳' : '🔍'}
          </button>
        </div>
      </div>

      {/* Map + legend */}
      <div style={{ position: 'relative' }}>
        <div ref={mapRef} style={s.mapInner} />
        <div style={s.legendBox}>
          <div style={s.legendTitle}>Layers</div>
          {Object.entries(NEARBY_TYPES).map(([key, cfg]) => (
            <div key={key} style={s.legRow} onClick={() => toggleLayer(key)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ ...s.legDot, background: cfg.color }} />
                <span style={s.legLabel}>{cfg.label}</span>
                <span style={s.legCount}>{(data[key] || []).length}</span>
              </div>
              <button style={{ ...s.sw, background: layers[key] ? '#1A73E8' : '#30363D' }}>
                <span style={{ ...s.swKnob, left: layers[key] ? 13 : 2 }} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={s.tableHeader}>
        <span style={s.panelTitle}>Resources Table</span>
        <span style={{ fontSize: 10, color: '#8B949E' }}>{total} places</span>
      </div>
      <div style={s.tableScroll}>
        <table style={s.table}>
          <thead>
            <tr>
              {['Place', 'Type', 'Distance', 'ETA', 'Rating'].map(h => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!pickedLat ? (
              <tr><td colSpan={5} style={s.tEmpty}>📍 Set location &amp; search resources</td></tr>
            ) : allPlaces.length === 0 ? (
              <tr><td colSpan={5} style={s.tEmpty}>{loading ? '🔍 Searching…' : 'Click 🔍 to search'}</td></tr>
            ) : (
              allPlaces.slice(0, 30).map((p, i) => (
                <tr key={i}>
                  <td style={s.td}>
                    <div style={{ fontWeight: 700, fontSize: 11 }}>{p.cfg.icon} {p.name}</div>
                    <div style={{ fontSize: 9, color: '#8B949E' }}>{p.vicinity}</div>
                  </td>
                  <td style={s.td}><span style={{ ...s.typeBadge, color: p.cfg.color, borderColor: p.cfg.color + '33', background: p.cfg.color + '15' }}>{p.cfg.label}</span></td>
                  <td style={s.td}><span style={s.distVal}>{fmtDist(p.d)}</span></td>
                  <td style={s.td}><span style={s.etaVal}>{fmtEta(p.d)}</span></td>
                  <td style={s.td}>{p.rating ? `⭐ ${p.rating}` : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   Map 2: Online Units
   ────────────────────────────────────────────────────────── */
function UnitsMap({ pickedLat, pickedLng, onSelectUnit, selectedUnitId }) {
  const mapRef  = useRef(null);
  const mapObj  = useRef(null);
  const destMkr = useRef(null);
  const unitMkrs = useRef({});
  const infoWin = useRef(null);
  const [units,   setUnits]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [layers,  setLayers]  = useState({ available: true, busy: true, offline: false });

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;
    if (!window.google?.maps) return;
    mapObj.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: pickedLat || 11.0168, lng: pickedLng || 76.9558 },
      zoom: 12, styles: DARK_MAP_STYLES, mapTypeControl: false, streetViewControl: false,
    });
    infoWin.current = new window.google.maps.InfoWindow();
  });

  // Dest marker
  useEffect(() => {
    if (!mapObj.current || !pickedLat || !pickedLng) return;
    if (destMkr.current) destMkr.current.setMap(null);
    destMkr.current = new window.google.maps.Marker({
      position: { lat: pickedLat, lng: pickedLng }, map: mapObj.current, zIndex: 200,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(destPinSvg()),
        scaledSize: new window.google.maps.Size(28, 36),
        anchor: new window.google.maps.Point(14, 36),
      },
    });
    mapObj.current.setCenter({ lat: pickedLat, lng: pickedLng });
  }, [pickedLat, pickedLng]);

  const fetchAndRenderUnits = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await getUnits();
      const list = res.data?.data || [];
      // Add distance
      const withDist = list.map(u => ({
        ...u,
        distanceM: (u.location?.latitude && pickedLat)
          ? Math.round(haversineMetres(pickedLat, pickedLng, parseFloat(u.location.latitude), parseFloat(u.location.longitude)))
          : null,
      })).sort((a, b) => {
        if (a.distanceM != null && b.distanceM != null) return a.distanceM - b.distanceM;
        if (a.distanceM != null) return -1;
        if (b.distanceM != null) return 1;
        return 0;
      });
      setUnits(withDist);
      renderMarkers(withDist);
    } catch (_) {}
    setLoading(false);
  }, [pickedLat, pickedLng]); // eslint-disable-line

  const renderMarkers = useCallback((list) => {
    if (!mapObj.current) return;
    const seen = new Set();
    list.forEach((u, idx) => {
      seen.add(u.id);
      if (!u.isOnline && !layers.offline) {
        unitMkrs.current[u.id]?.setMap(null);
        return;
      }
      const lat = u.location?.latitude ? parseFloat(u.location.latitude) : pickedLat + 0.01 * (idx % 5);
      const lng = u.location?.longitude ? parseFloat(u.location.longitude) : pickedLng + 0.01 * (idx % 5);
      if (!lat || !lng) return;

      const color = UNIT_COLORS[u.type] || '#4CAF50';
      const icon  = UNIT_ICONS[u.type]  || '🚑';
      const isSel = u.id === selectedUnitId;
      const s2 = isSel ? 42 : 34;
      const busyColor = '#FFC107';
      const fillColor = u.status === 'busy' ? busyColor : color;
      const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${s2}" height="${s2}" viewBox="0 0 ${s2} ${s2}">
        ${isSel ? `<circle cx="${s2/2}" cy="${s2/2}" r="${s2/2-1}" fill="none" stroke="#1A73E8" stroke-width="3" stroke-dasharray="5 3"/>` : ''}
        <circle cx="${s2/2}" cy="${s2/2}" r="${s2/2-3}" fill="${fillColor}" stroke="white" stroke-width="2"/>
        <text x="${s2/2}" y="${s2/2+5}" text-anchor="middle" font-size="${Math.round(s2*0.38)}">${icon}</text>
      </svg>`;

      const layerKey = !u.isOnline ? 'offline' : u.status === 'busy' ? 'busy' : 'available';
      const vis = layers[layerKey];

      const iconObj = {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgStr),
        scaledSize: new window.google.maps.Size(s2, s2),
        anchor: new window.google.maps.Point(s2 / 2, s2 / 2),
      };

      if (unitMkrs.current[u.id]) {
        unitMkrs.current[u.id].setPosition({ lat, lng });
        unitMkrs.current[u.id].setIcon(iconObj);
        unitMkrs.current[u.id].setMap(vis ? mapObj.current : null);
      } else {
        const mk = new window.google.maps.Marker({
          position: { lat, lng }, map: vis ? mapObj.current : null,
          title: u.name, zIndex: isSel ? 150 : 80, icon: iconObj,
        });
        mk.addListener('click', () => {
          const ds = u.distanceM != null ? fmtDist(u.distanceM) : 'GPS Active';
          const statusColor = u.status === 'available' ? '#34A853' : u.status === 'busy' ? '#FFC107' : '#9E9E9E';
          infoWin.current.setContent(`<div style="font-family:Sora,sans-serif;padding:10px 12px;min-width:190px;">
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:9px;">
              <span style="font-size:22px;">${icon}</span>
              <div><div style="font-weight:800;font-size:13px;color:#111;">${u.name}</div>
              <div style="font-size:10px;color:#888;">${u.id}</div></div>
            </div>
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;">
              <div style="width:8px;height:8px;border-radius:50%;background:${statusColor}"></div>
              <span style="font-size:12px;font-weight:700;color:${statusColor};">${u.status}</span>
              <span style="font-size:11px;color:#1E88E5;font-weight:600;margin-left:auto;">${ds}</span>
            </div>
            ${u.status !== 'busy' ? `<button onclick="window._selectUnitFromMap && window._selectUnitFromMap('${u.id}')" style="width:100%;background:${color};color:#fff;border:none;border-radius:7px;padding:8px;font-size:12px;font-weight:700;cursor:pointer;">🎯 Select for Dispatch</button>` : `<div style="background:#FFF8E1;border:1px solid #FFC107;border-radius:7px;padding:7px;font-size:11px;color:#F57F17;font-weight:600;">⚠️ On active incident</div>`}
          </div>`);
          infoWin.current.open(mapObj.current, mk);
        });
        unitMkrs.current[u.id] = mk;
      }
    });
    // Remove stale
    Object.keys(unitMkrs.current).forEach(id => {
      if (!seen.has(id)) { unitMkrs.current[id].setMap(null); delete unitMkrs.current[id]; }
    });
  }, [layers, selectedUnitId, pickedLat, pickedLng]); // eslint-disable-line

  useEffect(() => {
    if (onSelectUnit) window._selectUnitFromMap = onSelectUnit;
    return () => { delete window._selectUnitFromMap; };
  }, [onSelectUnit]);

  useEffect(() => {
    fetchAndRenderUnits();
    const iv = setInterval(fetchAndRenderUnits, 4000);
    return () => clearInterval(iv);
  }, [fetchAndRenderUnits]);

  const toggleLayer = (key) => {
    setLayers(prev => {
      const next = { ...prev, [key]: !prev[key] };
      units.forEach(u => {
        const lk = !u.isOnline ? 'offline' : u.status === 'busy' ? 'busy' : 'available';
        if (lk === key && unitMkrs.current[u.id]) {
          unitMkrs.current[u.id].setMap(next[key] ? mapObj.current : null);
        }
      });
      return next;
    });
  };

  const fitBounds = () => {
    if (!mapObj.current) return;
    const b = new window.google.maps.LatLngBounds();
    let any = false;
    units.forEach(u => {
      if (u.location?.latitude) { b.extend({ lat: parseFloat(u.location.latitude), lng: parseFloat(u.location.longitude) }); any = true; }
    });
    if (pickedLat && pickedLng) { b.extend({ lat: pickedLat, lng: pickedLng }); any = true; }
    if (any) mapObj.current.fitBounds(b, { padding: 60 });
  };

  const onlineUnits = units.filter(u => u.isOnline);
  const availCount  = onlineUnits.filter(u => u.status === 'available').length;
  const busyCount   = onlineUnits.filter(u => u.status === 'busy').length;

  return (
    <div style={s.mapPanel}>
      {/* Header */}
      <div style={s.panelHeader}>
        <div style={s.panelTitle}>
          🚑 Online Units <span style={s.badgeGreen}>{onlineUnits.length} online</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={s.iconBtn} onClick={fitBounds}>⛶ Fit</button>
          <button style={s.iconBtn} onClick={fetchAndRenderUnits} disabled={loading}>
            {loading ? '⏳' : '↺'}
          </button>
        </div>
      </div>

      {/* Map + legend */}
      <div style={{ position: 'relative' }}>
        <div ref={mapRef} style={s.mapInner} />
        <div style={s.legendBox}>
          <div style={s.legendTitle}>Unit Layers</div>
          {[
            ['available', '#4CAF50', `Available (${availCount})`],
            ['busy',      '#FFC107', `Busy (${busyCount})`],
            ['offline',   '#9E9E9E', 'Offline'],
          ].map(([key, color, label]) => (
            <div key={key} style={s.legRow} onClick={() => toggleLayer(key)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ ...s.legDot, background: color }} />
                <span style={s.legLabel}>{label}</span>
              </div>
              <button style={{ ...s.sw, background: layers[key] ? '#1A73E8' : '#30363D' }}>
                <span style={{ ...s.swKnob, left: layers[key] ? 13 : 2 }} />
              </button>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #30363D', paddingTop: 5, marginTop: 3, fontSize: 9, color: '#8B949E' }}>
            Click marker to select unit
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={s.tableHeader}>
        <span style={s.panelTitle}>Units Table</span>
        <span style={{ fontSize: 10, color: '#8B949E' }}>{onlineUnits.length} online</span>
      </div>
      <div style={s.tableScroll}>
        <table style={s.table}>
          <thead>
            <tr>
              {['Unit', 'Type', 'Status', 'Distance', 'ETA'].map(h => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!onlineUnits.length ? (
              <tr><td colSpan={5} style={s.tEmpty}>📵 No units online — add mock units in dispatch</td></tr>
            ) : (
              onlineUnits.map((u, i) => {
                const color = UNIT_COLORS[u.type] || '#4CAF50';
                const icon  = UNIT_ICONS[u.type]  || '🚑';
                const sc    = u.status === 'available' ? { background: 'rgba(52,168,83,.15)', color: '#34A853' }
                            : u.status === 'busy'      ? { background: 'rgba(255,193,7,.15)', color: '#FFC107' }
                            : { background: 'rgba(158,158,158,.1)', color: '#9E9E9E' };
                return (
                  <tr key={u.id}
                    onClick={() => onSelectUnit && u.status !== 'busy' && onSelectUnit(u.id)}
                    style={{ cursor: u.status !== 'busy' ? 'pointer' : 'default', background: u.id === selectedUnitId ? 'rgba(26,115,232,.08)' : 'transparent' }}
                  >
                    <td style={s.td}>
                      <div style={{ fontWeight: 700, fontSize: 11 }}>{icon} {u.name}</div>
                      <div style={{ fontSize: 9, color: '#8B949E' }}>{u.id.slice(0, 12)}…</div>
                    </td>
                    <td style={s.td}><span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: color + '20', color }}>{u.type}</span></td>
                    <td style={s.td}><span style={{ ...sc, padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 800 }}>{u.status}</span></td>
                    <td style={s.td}><span style={s.distVal}>{u.distanceM != null ? fmtDist(u.distanceM) : u.location?.latitude ? '📡 GPS' : '—'}</span></td>
                    <td style={s.td}><span style={s.etaVal}>{u.distanceM != null ? fmtEta(u.distanceM) : '—'}</span></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   Main export: dual maps side by side + tables
   ────────────────────────────────────────────────────────── */
export default function NearbyResources({ pickedLat, pickedLng, onSelectUnit, selectedUnitId }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={s.dualGrid}>
        <ResourcesMap pickedLat={pickedLat} pickedLng={pickedLng} />
        <UnitsMap
          pickedLat={pickedLat} pickedLng={pickedLng}
          onSelectUnit={onSelectUnit}
          selectedUnitId={selectedUnitId}
        />
      </div>
    </div>
  );
}

/* ── Styles ── */
const s = {
  dualGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14,
  },
  mapPanel: {
    background: '#161B22', border: '1px solid #30363D',
    borderRadius: 14, overflow: 'hidden',
  },
  panelHeader: {
    padding: '11px 14px', borderBottom: '1px solid #30363D',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'rgba(26,115,232,.03)',
  },
  panelTitle: {
    fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
    letterSpacing: 1, color: '#E6EDF3', display: 'flex', alignItems: 'center', gap: 7,
  },
  badgeBlue: { fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: 'rgba(26,115,232,.18)', color: '#82B4FF' },
  badgeGreen: { fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: 'rgba(52,168,83,.18)', color: '#69F0AE' },
  iconBtn: {
    padding: '4px 10px', borderRadius: 6, border: '1px solid #30363D',
    background: '#0D1117', color: '#8B949E', cursor: 'pointer', fontSize: 12,
  },
  mapInner: { width: '100%', height: 280 },
  legendBox: {
    position: 'absolute', bottom: 10, left: 10, zIndex: 10,
    background: 'rgba(13,17,23,.92)', border: '1px solid #30363D',
    borderRadius: 10, padding: '8px 11px', backdropFilter: 'blur(8px)', minWidth: 150,
  },
  legendTitle: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#8B949E', marginBottom: 6 },
  legRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, cursor: 'pointer' },
  legDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  legLabel: { fontSize: 10, fontWeight: 600, color: '#E6EDF3' },
  legCount: { fontSize: 9, color: '#8B949E', marginLeft: 2 },
  sw: { width: 24, height: 13, borderRadius: 7, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 },
  swKnob: { content: '', position: 'absolute', top: 2, width: 9, height: 9, borderRadius: '50%', background: '#fff', transition: 'left .2s' },
  tableHeader: {
    padding: '8px 14px', borderTop: '1px solid #30363D', borderBottom: '1px solid #30363D',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  tableScroll: { maxHeight: 200, overflowY: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: '#8B949E', padding: '7px 12px', borderBottom: '1px solid #30363D', textAlign: 'left', background: 'rgba(255,255,255,.02)' },
  td: { fontSize: 11, padding: '8px 12px', borderBottom: '1px solid rgba(48,54,61,.5)', color: '#E6EDF3', verticalAlign: 'middle' },
  tEmpty: { textAlign: 'center', padding: 20, color: '#8B949E', fontSize: 11 },
  typeBadge: { fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 7, textTransform: 'uppercase', border: '1px solid' },
  distVal: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#82B4FF', fontWeight: 700 },
  etaVal:  { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#69F0AE', fontWeight: 700 },
};