import React, { useEffect, useRef, useCallback } from 'react';
import { 
  EnvironmentOutlined, 
  SearchOutlined, 
  CheckCircleOutlined, 
  LockOutlined, 
  CloseOutlined,
  AimOutlined
} from '@ant-design/icons';
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_JS_URL_BASE } from '../config/apiConfig';

const DARK_MAP_STYLES = [
  { elementType: 'geometry',           stylers: [{ color: '#1a1f2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1f2e' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#8b949e' }] },
  { featureType: 'road',         elementType: 'geometry',         stylers: [{ color: '#2d3748' }] },
  { featureType: 'road',         elementType: 'labels.text.fill', stylers: [{ color: '#a0aec0' }] },
  { featureType: 'road.highway', elementType: 'geometry',         stylers: [{ color: '#3d4f6e' }] },
  { featureType: 'water',        elementType: 'geometry',         stylers: [{ color: '#0d1117' }] },
  { featureType: 'poi',          stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',      stylers: [{ visibility: 'off' }] },
];

const INCIDENT_COLOR = '#E53935';
const LOCKED_COLOR   = '#F9A825';

export default function MapView({ onLocationPick, pickedLat, pickedLng, onFindNearest, locationLocked }) {
  const mapRef    = useRef(null);
  const mapObj    = useRef(null);
  const markerRef = useRef(null);
  const acRef     = useRef(null);
  const inputRef  = useRef(null);
  const [searchVal,    setSearchVal]    = React.useState('');
  const [resolvedAddr, setResolvedAddr] = React.useState('');

  // Init map once
  useEffect(() => {
    const init = () => {
      if (!mapRef.current || mapObj.current) return;
      mapObj.current = new window.google.maps.Map(mapRef.current, {
        center: { lat: pickedLat || 11.0168, lng: pickedLng || 76.9558 },
        zoom: pickedLat ? 15 : 13,
        styles: DARK_MAP_STYLES,
        mapTypeControl: false,
        streetViewControl: false,
      });

      // Only add click listener if NOT locked
      if (!locationLocked) {
        mapObj.current.addListener('click', (e) => {
          const lat = e.latLng.lat(), lng = e.latLng.lng();
          pinDest(lat, lng, null);
          reverseGeocode(lat, lng);
        });
      }

      if (inputRef.current ) {
        acRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: 'in' },
          fields: ['geometry', 'name', 'formatted_address'],
        });
        acRef.current.addListener('place_changed', () => {
          const p = acRef.current.getPlace();
          if (!p.geometry?.location) return;
          const lat = p.geometry.location.lat(), lng = p.geometry.location.lng();

          if (!locationLocked) {
            pinDest(lat, lng, p.formatted_address || p.name);
          }
          mapObj.current.setCenter({ lat, lng });
          mapObj.current.setZoom(16);
          setSearchVal(p.formatted_address || p.name);
          setResolvedAddr(p.formatted_address || p.name);
        });
      }

      // If we already have a location (agent ticket), drop the pin immediately
      if (pickedLat && pickedLng) {
        dropPin(pickedLat, pickedLng, locationLocked);
      }
    };

    if (window.google?.maps) init();
    else {
      window.__initMapView = init;
      if (!document.getElementById('gmap-script')) {
        const script = document.createElement('script');
        script.id  = 'gmap-script';
        script.src = `${GOOGLE_MAPS_JS_URL_BASE}?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&callback=__initMapView`;
        script.async = true;
        document.head.appendChild(script);
      }
    }
  }, []); // eslint-disable-line

  // When pickedLat/Lng changes externally (e.g. agent ticket loaded), update pin
  useEffect(() => {
    if (pickedLat && pickedLng && mapObj.current) {
      dropPin(pickedLat, pickedLng, locationLocked);
      mapObj.current.setCenter({ lat: pickedLat, lng: pickedLng });
      mapObj.current.setZoom(15);
    }
  }, [pickedLat, pickedLng, locationLocked]); // eslint-disable-line

  // Drop a pin (with locked vs normal styling)
  const dropPin = (lat, lng, locked) => {
    if (markerRef.current) markerRef.current.setMap(null);
    const color = locked ? LOCKED_COLOR : INCIDENT_COLOR;
    const label = locked ? 'AGENT' : 'DEST';
    markerRef.current = new window.google.maps.Marker({
      position: { lat, lng },
      map: mapObj.current,
      animation: window.google.maps.Animation.DROP,
      zIndex: 200,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 40 52">
            <path d="M20 0C9 0 0 9 0 20C0 35 20 52 20 52S40 35 40 20C40 9 31 0 20 0Z"
              fill="${color}" stroke="white" stroke-width="2.5"/>
            <circle cx="20" cy="20" r="8" fill="white" opacity="0.9"/>
            <circle cx="20" cy="20" r="4" fill="${color}"/>
            <text x="20" y="14" text-anchor="middle" font-size="7" fill="white" font-weight="bold">${label}</text>
            ${locked ? `<text x="20" y="27" text-anchor="middle" font-size="9">🔒</text>` : ''}
          </svg>`),
        scaledSize: new window.google.maps.Size(34, 42),
        anchor:     new window.google.maps.Point(17, 42),
      },
    });
  };

  const pinDest = useCallback((lat, lng, addr) => {
    dropPin(lat, lng, false);
    onLocationPick?.(lat, lng, addr);
  }, [onLocationPick]); // eslint-disable-line

  const reverseGeocode = useCallback((lat, lng) => {
    new window.google.maps.Geocoder().geocode({ location: { lat, lng } }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const a = results[0].formatted_address;
        setSearchVal(a); setResolvedAddr(a);
        onLocationPick?.(lat, lng, a);
      }
    });
  }, [onLocationPick]);

  const clearSearch = () => {
    setSearchVal(''); setResolvedAddr('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const presets = [
    { name: 'Coimbatore Centre', lat: 11.0168, lng: 76.9558 },
    { name: 'Railway Station',   lat: 11.0504, lng: 76.9850 },
    { name: 'GH Hospital',       lat: 11.0178, lng: 76.9720 },
    { name: 'Tirupur',           lat: 10.9081, lng: 76.9518 },
    { name: 'Medical College',   lat: 11.0168, lng: 76.9720 },
  ];

  const handlePreset = (p) => {
    if (locationLocked) return;
    pinDest(p.lat, p.lng, p.name);
    mapObj.current?.setCenter({ lat: p.lat, lng: p.lng });
    mapObj.current?.setZoom(15);
    setSearchVal(p.name); setResolvedAddr(p.name);
  };

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>
        <EnvironmentOutlined style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 4 }} /> {locationLocked ? 'Incident Location (Agent Set)' : 'Set Incident Location'}
      </div>

      {/* Quick presets — hidden if locked */}
      {!locationLocked && (
        <div style={s.presetRow}>
          {presets.map(p => (
            <button key={p.name} style={s.presetBtn} onClick={() => handlePreset(p)}>{p.name}</button>
          ))}
        </div>
      )}

      {/* Search bar — read-only if locked */}
      <div style={s.searchWrap}>
        <span style={s.searchIcon}><SearchOutlined style={{ verticalAlign: 'middle' }} /></span>
        <input
          ref={inputRef}
          value={searchVal}
          onChange={e => setSearchVal(e.target.value)}
          readOnly={false}
          placeholder={'Search address, hospital, landmark…'}
          style={{
            ...s.searchInput,
            
          }}
          autoComplete="off"
        />
        {!locationLocked && searchVal && (
          <button style={s.clearBtn} onClick={clearSearch}><CloseOutlined style={{ verticalAlign: 'middle' }} /></button>
        )}
      </div>

      {!locationLocked && resolvedAddr && (
        <div style={s.resolvedAddr}><CheckCircleOutlined style={{ verticalAlign: 'middle' }} /> {resolvedAddr}</div>
      )}

      {/* Map */}
      <div style={{ position: 'relative' }}>
        <div ref={mapRef} style={s.map} />
        {/* Lock overlay hint */}
        {locationLocked && (
          <div style={s.lockOverlay}>
            <LockOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} /> Location locked — set by agent
          </div>
        )}
      </div>

      {/* Status bar */}
      <div style={s.statusBar}>
        <div style={s.statusLeft}>
          <span style={{ ...s.dot, background: pickedLat ? (locationLocked ? LOCKED_COLOR : '#34A853') : '#30363D' }} />
          <span style={s.statusInfo}>
            {pickedLat
              ? `${locationLocked ? '🔒 Agent pin' : 'Dest'}: ${pickedLat.toFixed(4)}, ${pickedLng.toFixed(4)}`
              : 'Click map to set destination'}
          </span>
        </div>
        {!locationLocked && (
          <button style={s.findBtn} onClick={() => onFindNearest?.()}><SearchOutlined style={{ fontSize: '10px', verticalAlign: 'middle', marginRight: 4 }} /> Find Nearest Unit</button>
        )}
      </div>

      {pickedLat && (
        <div style={{ ...s.coordDisp, ...(locationLocked ? { borderColor: 'rgba(249,168,37,.3)', color: LOCKED_COLOR, background: 'rgba(249,168,37,.06)' } : {}) }}>
          <EnvironmentOutlined style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 4 }} /> {pickedLat.toFixed(6)}, {pickedLng.toFixed(6)}
        </div>
      )}
    </div>
  );
}

const s = {
  card: {
    background: '#161B22', border: '1px solid #30363D',
    borderRadius: 14, padding: 20, marginBottom: 16,
  },
  cardTitle: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '1.5px', color: '#8B949E', marginBottom: 14,
  },
  presetRow:   { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  presetBtn: {
    padding: '4px 11px', borderRadius: 14, fontSize: 10, fontWeight: 600,
    border: '1px solid #30363D', background: '#0D1117', color: '#8B949E',
    cursor: 'pointer', fontFamily: 'Sora, sans-serif',
  },
  searchWrap:  { position: 'relative', marginBottom: 10 },
  searchIcon: {
    position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
    fontSize: 15, pointerEvents: 'none', zIndex: 2,
  },
  searchInput: {
    width: '100%', background: '#0D1117', border: '1.5px solid #1A73E8',
    color: '#E6EDF3', borderRadius: 9, padding: '9px 36px 9px 36px',
    fontFamily: 'Sora, sans-serif', fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
    boxShadow: '0 0 0 3px rgba(26,115,232,.1)',
  },
  clearBtn: {
    position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
    fontSize: 14, cursor: 'pointer', color: '#8B949E', zIndex: 2,
    background: 'none', border: 'none',
  },
  resolvedAddr: {
    fontSize: 11, color: '#34A853', padding: '4px 0 8px',
    display: 'flex', alignItems: 'center', gap: 5,
  },
  map: {
    width: '100%', height: 400, borderRadius: 10,
    border: '1px solid #30363D', overflow: 'hidden', marginBottom: 12,
  },
  lockOverlay: {
    position: 'absolute', top: 10, right: 10, zIndex: 10,
    background: 'rgba(249,168,37,.15)', border: '1px solid rgba(249,168,37,.35)',
    borderRadius: 8, padding: '5px 11px',
    fontSize: 10, fontWeight: 700, color: '#F9A825',
    backdropFilter: 'blur(4px)',
  },
  statusBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 10px', background: 'rgba(26,115,232,.06)',
    border: '1px solid rgba(26,115,232,.15)', borderRadius: 8, marginBottom: 10, fontSize: 11,
  },
  statusLeft:  { display: 'flex', alignItems: 'center', gap: 10 },
  dot:         { width: 7, height: 7, borderRadius: '50%', display: 'inline-block' },
  statusInfo:  { color: '#8B949E' },
  findBtn: {
    padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(26,115,232,.4)',
    background: 'rgba(26,115,232,.1)', color: '#82B4FF',
    fontFamily: 'Sora, sans-serif', fontSize: 10, fontWeight: 700, cursor: 'pointer',
  },
  coordDisp: {
    fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#1A73E8',
    padding: '7px 11px', background: 'rgba(26,115,232,.08)',
    borderRadius: 7, border: '1px solid transparent',
  },
};