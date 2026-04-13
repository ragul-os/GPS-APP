/**
 * server.js — Emergency Control System  v5.2
 *
 * TRACKING PHILOSOPHY:
 *  - /heartbeat   → keep-alive only (every 10s from AlertScreen)
 *                   updates in-memory lastSeen + unit.location
 *                   NO database insert — avoids idle noise rows
 *                   EXCEPTION: if unit was offline → came back → ONE insert (device_status='online')
 *
 *  - /track       → INSERT to PostgreSQL (every 3s from MapScreen)
 *                   only called when unit is on an active trip
 *                   THE ONLY source of trip movement rows
 *
 *  - /update-dispatch-status → status change events (on button press)
 *                   inserts ONE row to DB to record the transition
 *
 *  - /register-unit / /register-ambulance → inserts ONE row (device_status='online')
 *                   records when a unit first comes online
 *
 *  - 15s offline checker → inserts ONE row (device_status='offline')
 *                   when unit misses heartbeats beyond HEARTBEAT_TIMEOUT_MS
 *
 *  Result: DB has only meaningful rows:
 *    - trip movement rows (from /track)
 *    - status transition rows (from /update-dispatch-status)
 *    - online/offline event rows (from registration, heartbeat comeback, offline checker)
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const mysql      = require('mysql2/promise');
const { Pool }   = require('pg');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT                 = process.env.PORT || 5000;
const GOOGLE_KEY           = process.env.GOOGLE_KEY;
const HEARTBEAT_TIMEOUT_MS = 30000;

app.use(cors({ origin: '*' }));
app.use(bodyParser.json());

// ══════════════════════════════════════════════════════════════════════════════
// MYSQL — forms, submissions
// ══════════════════════════════════════════════════════════════════════════════
const db = mysql.createPool({
  host:               process.env.MYSQL_HOST,
  port:               parseInt(process.env.MYSQL_PORT) || 3306,
  user:               process.env.MYSQL_USER,
  password:           process.env.MYSQL_PASSWORD,
  database:           process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit:    10,
});
(async () => {
  try   { await db.query('SELECT 1'); console.log(`✅ MySQL → ${process.env.MYSQL_DATABASE}`); }
  catch (err) { console.warn('⚠️  MySQL not connected:', err.message); }
})();

// ══════════════════════════════════════════════════════════════════════════════
// POSTGRESQL — unit_locations (insert-only)
// ══════════════════════════════════════════════════════════════════════════════
const pgPool = new Pool({
  host:              process.env.PG_HOST,
  port:              parseInt(process.env.PG_PORT) || 5432,
  user:              process.env.PG_USER,
  password:          process.env.PG_PASSWORD,
  database:          process.env.PG_DATABASE,
  max:               10,
  idleTimeoutMillis: 30000,
});
(async () => {
  try   { await pgPool.query('SELECT 1'); console.log(`✅ PostgreSQL → ${process.env.PG_DATABASE}`); }
  catch (err) { console.warn('⚠️  PostgreSQL not connected:', err.message); }
})();

// ══════════════════════════════════════════════════════════════════════════════
// IN-MEMORY STATE
// ══════════════════════════════════════════════════════════════════════════════
const units         = new Map();
const assignments   = new Map();
const incidents     = new Map();
const unitTripState = new Map();

let ambulanceLocation = makeFreshTripState({ tripStatus: 'idle' });
let currentAlert = { id: null, status: 'waiting', patientName: '', patientPhone: '', address: '', destination: null, notes: '', reason: '' };
let pushTokens = new Set();

// ══════════════════════════════════════════════════════════════════════════════
// OFFLINE DETECTION — checks lastSeen set by /heartbeat
// When a unit transitions to offline → insert ONE DB row recording the event
// ══════════════════════════════════════════════════════════════════════════════
setInterval(() => {
  const now = Date.now();
  for (const [id, unit] of units.entries()) {
    if (now - unit.lastSeen > HEARTBEAT_TIMEOUT_MS && unit.status !== 'offline') {
      unit.status = 'offline';
      console.log(`📴 Unit offline: ${id}`);

      const ts  = unitTripState.get(id);
      // Best coords: prefer unitTripState (most recent from /track or heartbeat),
      // fall back to unit.location (set by heartbeat), skip insert if nothing known
      const offLat = ts?.latitude  || unit.location?.latitude;
      const offLng = ts?.longitude || unit.location?.longitude;
      const offSpd = ts?.speed     || unit.location?.speed || 0;

      if (offLat && offLng) {
        trackInsert({
          unitId:            id,
          latitude:          offLat,
          longitude:         offLng,
          speed:             offSpd,
          tripStatus:        ts?.tripStatus || 'idle',
          locationInfo:      null,
          forceDeviceStatus: 'offline',
        }).catch(() => {});
        console.log(`🔴 DB: ${id} → offline @ ${offLat},${offLng}`);
      } else {
        console.log(`🔴 Unit ${id} went offline — no coords available, skipping DB insert`);
      }
    }
  }
}, 15000);

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function makeFreshTripState(overrides = {}) {
  return { latitude: null, longitude: null, heading: 0, speed: 0, remainingDistM: 0, remainingTimeS: 0, tripStatus: 'dispatched', stepIdx: 0, totalSteps: 0, distToDest: 0, timestamp: null, trail: [], ...overrides };
}

function haversineMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000, φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dφ = (lat2 - lat1) * Math.PI / 180, dλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resetLegacyLocation() { ambulanceLocation = makeFreshTripState({ tripStatus: 'dispatched' }); }

function dispatchToNearestUnits(alert, type) {
  const nearby = Array.from(units.values())
    .filter(u => u.type === type && u.status === 'available' && u.location)
    .map(u => ({ ...u, distance: haversineMetres(alert.destination?.latitude, alert.destination?.longitude, u.location.latitude, u.location.longitude) }))
    .sort((a, b) => a.distance - b.distance).slice(0, 5);
  nearby.forEach(unit => assignments.set(unit.id, alert));
  return nearby;
}

function validateAnswers(fields, answers) {
  const errors = [];
  for (const field of fields) {
    if (!field.required) continue;
    const val = answers[field.id];
    if (val === undefined || val === null || val === '' || (Array.isArray(val) && !val.length)) errors.push(`"${field.label}" is required`);
  }
  return errors;
}

async function reverseGeocode(lat, lng) {
  try {
    const data = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_KEY}`).then(r => r.json());
    if (data.status === 'OK' && data.results.length > 0) {
      const c = data.results[0].address_components;
      const locality = c.find(x => x.types.includes('locality'))?.long_name;
      const state    = c.find(x => x.types.includes('administrative_area_level_1'))?.long_name;
      if (locality && state) return `${locality}, ${state}`;
      return data.results[0].formatted_address.split(',').slice(0, 2).join(',').trim();
    }
  } catch { /* silent */ }
  return null;
}

// ── THE ONLY FUNCTION WRITING TO POSTGRESQL ───────────────────────────────
// forceDeviceStatus: if provided, overrides the lastSeen-based online/offline calc.
//   Used for: registration (→ 'online'), offline-checker (→ 'offline'), comeback (→ 'online')
async function trackInsert({ unitId, latitude, longitude, speed = 0, tripStatus = 'idle', locationInfo = null, forceDeviceStatus = null }) {
  if (!unitId || latitude == null || longitude == null) return;
  const unit          = units.get(unitId);
  const unit_status   = unit?.assignedIncidentId ? 'busy' : 'available';
  const isOnline      = unit ? (Date.now() - unit.lastSeen < HEARTBEAT_TIMEOUT_MS) : false;
  // forceDeviceStatus lets callers hard-set 'online' or 'offline' for event rows
  const device_status = forceDeviceStatus || (isOnline ? 'online' : 'offline');
  const location_info = locationInfo || await reverseGeocode(latitude, longitude);
  try {
    await pgPool.query(
      `INSERT INTO public.unit_locations ("timestamp",unit_id,unit_type,user_name,latitude,longitude,unit_status,device_status,ticket_no,trip_status,speed,location_info,remarks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [new Date(), unitId, unit?.type || 'ambulance', unit?.name || unitId, parseFloat(latitude), parseFloat(longitude), unit_status, device_status, unit?.assignedIncidentId || null, tripStatus, parseFloat(speed) || 0, location_info || null, null]
    );
    console.log(`📍 DB ✅ ${unitId} | ${tripStatus} | ${device_status} | spd=${speed}`);
  } catch (err) { console.error('❌ DB INSERT failed:', err.message); }
}

async function sendPushToToken(token, alert) {
  if (!token) return;
  try {
    const r = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify([{ to: token, sound: 'default', priority: 'high', channelId: 'emergency-alerts', ttl: 300, title: `🚨 Emergency — ${alert.patientName || 'Incident'}`, body: `📍 ${alert.address || 'Location pending'}\n📝 ${alert.notes || ''}`, data: { type: 'emergency_alert', ...alert } }]) });
    const item = (await r.json()).data?.[0];
    if (item?.status === 'ok') console.log('✅ Push sent'); else console.warn('❌ Push failed:', item?.message);
  } catch (err) { console.error('Push error:', err.message); }
}

async function broadcastPush(alert) {
  if (!pushTokens.size) return;
  try {
    const r = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify([...pushTokens].map(token => ({ to: token, sound: 'default', priority: 'high', channelId: 'emergency-alerts', ttl: 300, title: `🚨 Emergency — ${alert.patientName || 'Incident'}`, body: `📍 ${alert.address || 'Location pending'}`, data: { type: 'emergency_alert', ...alert } }))) });
    (await r.json()).data?.forEach((item, i) => { if (item.details?.error === 'DeviceNotRegistered') pushTokens.delete([...pushTokens][i]); });
  } catch (err) { console.error('Broadcast push error:', err.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
// FORM ROUTES
// ══════════════════════════════════════════════════════════════════════════════
app.get('/forms/:unitType', async (req, res) => {
  try { const [rows] = await db.query(`SELECT f.*, ft.name AS type_name FROM forms f JOIN form_types ft ON f.form_type_id = ft.id WHERE f.unit_type = ? AND f.form_type_id = 1 AND f.is_active = 1 LIMIT 1`, [req.params.unitType]); if (!rows.length) return res.status(404).json({ success: false, error: 'Form not found' }); res.json({ success: true, data: rows[0] }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/forms/scene/assessment', async (req, res) => {
  try { const [rows] = await db.query(`SELECT f.*, ft.name AS type_name FROM forms f JOIN form_types ft ON f.form_type_id = ft.id WHERE f.form_type_id = 2 AND f.is_active = 1 LIMIT 1`); if (!rows.length) return res.status(404).json({ success: false, error: 'Scene form not found' }); res.json({ success: true, data: rows[0] }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.post('/forms/:formId/submit', async (req, res) => {
  try {
    const { answers = {}, incidentId, submittedBy = 'dispatcher' } = req.body;
    const [rows] = await db.query('SELECT * FROM forms WHERE id = ? AND is_active = 1', [req.params.formId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Form not found' });
    const form = rows[0], fields = typeof form.fields === 'string' ? JSON.parse(form.fields) : form.fields, errors = validateAnswers(fields, answers);
    if (errors.length) return res.status(400).json({ success: false, errors });
    const [result] = await db.query(`INSERT INTO form_submissions (form_id, incident_id, submitted_by, answers) VALUES (?, ?, ?, ?)`, [form.id, incidentId || null, submittedBy, JSON.stringify(answers)]);
    res.json({ success: true, submissionId: result.insertId });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/forms/submissions/:incidentId', async (req, res) => {
  try { const [rows] = await db.query(`SELECT fs.*, f.name AS form_name, f.unit_type, ft.name AS form_type_name FROM form_submissions fs JOIN forms f ON fs.form_id = f.id JOIN form_types ft ON f.form_type_id = ft.id WHERE fs.incident_id = ? ORDER BY fs.submitted_at DESC`, [req.params.incidentId]); res.json({ success: true, data: rows }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/admin/forms', async (req, res) => {
  try { const [rows] = await db.query(`SELECT f.id, f.name, f.unit_type, f.is_active, ft.name AS type_name, JSON_LENGTH(f.fields) AS field_count, f.created_at, f.updated_at FROM forms f JOIN form_types ft ON f.form_type_id = ft.id ORDER BY f.form_type_id, f.unit_type`); res.json({ success: true, data: rows }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/admin/forms/:id', async (req, res) => {
  try { const [rows] = await db.query('SELECT f.*, ft.name AS type_name FROM forms f JOIN form_types ft ON f.form_type_id = ft.id WHERE f.id = ?', [req.params.id]); if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' }); res.json({ success: true, data: rows[0] }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.post('/admin/forms', async (req, res) => {
  try { const { form_type_id, name, unit_type, fields } = req.body; if (!name || !unit_type || !fields?.length) return res.status(400).json({ success: false, error: 'name, unit_type, fields required' }); const [result] = await db.query('INSERT INTO forms (form_type_id, name, unit_type, fields) VALUES (?, ?, ?, ?)', [form_type_id || 1, name, unit_type, JSON.stringify(fields)]); res.json({ success: true, id: result.insertId }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.put('/admin/forms/:id', async (req, res) => {
  try { const { fields, name, is_active } = req.body, updates = [], vals = []; if (fields) { updates.push('fields = ?'); vals.push(JSON.stringify(fields)); } if (name) { updates.push('name = ?'); vals.push(name); } if (is_active !== undefined) { updates.push('is_active = ?'); vals.push(is_active ? 1 : 0); } if (!updates.length) return res.status(400).json({ success: false, error: 'Nothing to update' }); vals.push(req.params.id); await db.query(`UPDATE forms SET ${updates.join(', ')} WHERE id = ?`, vals); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/admin/form-types', async (req, res) => {
  try { const [rows] = await db.query('SELECT * FROM form_types ORDER BY id'); res.json({ success: true, data: rows }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// UNIT REGISTRATION — pure in-memory setup only. NO database insert here.
//
// WHY: Registration fires before GPS is ready on the mobile side, so coords
// are always missing at this point. The heartbeat (sent every 10s) arrives
// WITH real lat/lng — that is the correct moment to record 'online' in the DB.
//
// _needsOnlineInsert = true tells the heartbeat handler to write the DB row
// on the very first heartbeat it receives with valid coords.
// ══════════════════════════════════════════════════════════════════════════════
function handleRegister(req, res) {
  const unitId    = req.body.unitId || req.body.ambulanceId;
  const name      = req.body.name;
  const type      = req.body.type || 'ambulance';
  const pushToken = req.body.pushToken || null;
  if (!unitId || !name) return res.status(400).json({ error: 'unitId and name required' });

  const existing = units.get(unitId);

  const unit = {
    id:                 unitId,
    name,
    type,
    status:             existing?.status === 'busy' ? 'busy' : 'available',
    lastSeen:           Date.now(),
    registeredAt:       existing?.registeredAt || Date.now(),
    pushToken:          pushToken || existing?.pushToken || null,
    assignedIncidentId: existing?.assignedIncidentId || null,
    location:           existing?.location || null,
    _needsOnlineInsert: true,  // heartbeat will write the 'online' DB row with real coords
  };

  units.set(unitId, unit);
  if (pushToken) pushTokens.add(pushToken);
  if (!unitTripState.has(unitId)) unitTripState.set(unitId, makeFreshTripState({ tripStatus: 'idle' }));
  console.log(`✅ Unit registered: ${name} (${unitId}) — waiting for first heartbeat to record online event`);

  res.json({ success: true, unit });
}
app.post('/register-unit',      handleRegister);
app.post('/register-ambulance', handleRegister);

// ══════════════════════════════════════════════════════════════════════════════
// HEARTBEAT — keep-alive ONLY. Updates lastSeen + in-memory location.
// ONLY inserts to DB when a unit COMES BACK online after being offline.
// Normal heartbeats (unit already online) → NO database insert.
// ══════════════════════════════════════════════════════════════════════════════
app.post('/heartbeat', (req, res) => {
  const unitId = req.body.unitId || req.body.ambulanceId;
  const unit   = units.get(unitId);
  if (!unit) return res.status(404).json({ error: 'Unit not registered' });

  unit.lastSeen = Date.now(); // offline timer reads this

  const wasOffline = unit.status === 'offline';

  if (wasOffline) {
    unit.status = unit.assignedIncidentId ? 'busy' : 'available';
    console.log(`🔄 Unit back online: ${unit.name} (${unitId})`);
  }

  const lat   = parseFloat(req.body.latitude);
  const lng   = parseFloat(req.body.longitude);
  const spd   = parseFloat(req.body.speed) >= 0 ? parseFloat(req.body.speed) : 0;
  const hdg   = parseFloat(req.body.heading) >= 0 ? parseFloat(req.body.heading) : 0;
  const hasCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

  if (hasCoords) {
    unit.location = { latitude: lat, longitude: lng, heading: hdg, speed: spd, updatedAt: Date.now() };
    const prev = unitTripState.get(unitId) || makeFreshTripState();
    unitTripState.set(unitId, { ...prev, latitude: lat, longitude: lng, heading: hdg, speed: spd, timestamp: Date.now(), trail: [...(prev.trail || []).slice(-149), { latitude: lat, longitude: lng, heading: hdg, speed: spd }] });
    ambulanceLocation = { ...ambulanceLocation, latitude: lat, longitude: lng, heading: hdg, speed: spd, timestamp: Date.now() };
  }

  const ts = unitTripState.get(unitId);
  // Use fresh GPS if available, else fall back to last cached position
  const insertLat = hasCoords ? lat : (ts?.latitude || unit.location?.latitude);
  const insertLng = hasCoords ? lng : (ts?.longitude || unit.location?.longitude);
  const insertSpd = hasCoords ? spd : (ts?.speed || 0);

  // Insert ONE 'online' DB row in two cases — both handled the same way:
  //   1. Unit just registered (_needsOnlineInsert=true) and this is its first heartbeat with GPS
  //   2. Unit was offline and just came back (wasOffline=true)
  // Both cases: unit was not-online, now it is, we have real coords → record it.
  const shouldInsertOnline = (unit._needsOnlineInsert || wasOffline) && hasCoords;
  if (shouldInsertOnline) {
    unit._needsOnlineInsert = false;  // clear flag so subsequent heartbeats don't re-insert
    const reason = wasOffline ? 'comeback after offline' : 'first heartbeat after registration';
    trackInsert({
      unitId,
      latitude:          lat,
      longitude:         lng,
      speed:             spd,
      tripStatus:        ts?.tripStatus || 'idle',
      locationInfo:      null,
      forceDeviceStatus: 'online',
    }).catch(() => {});
    console.log(`🟢 DB: ${unitId} → online (${reason}) @ ${lat},${lng}`);
  }

  // ✅ No insert for normal keep-alive heartbeats — avoids idle noise rows
  res.json({ success: true, hasLocation: hasCoords });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /track — ONLY DB-WRITING LOCATION ENDPOINT for trip movement
// Called from MapScreen every 3s during an active trip.
// ══════════════════════════════════════════════════════════════════════════════
app.post('/track', async (req, res) => {
  try {
    const { unitId, latitude, longitude, speed = 0, tripStatus = 'idle', locationInfo = null } = req.body;
    if (!unitId) return res.status(400).json({ error: 'unitId required' });
    const lat = parseFloat(latitude), lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'Invalid coordinates' });

    const unit = units.get(unitId);
    if (unit) { unit.lastSeen = Date.now(); unit.location = { latitude: lat, longitude: lng, speed, updatedAt: Date.now() }; }

    const prev = unitTripState.get(unitId) || makeFreshTripState();
    unitTripState.set(unitId, { ...prev, latitude: lat, longitude: lng, speed, tripStatus, timestamp: Date.now() });

    // No forceDeviceStatus here — let trackInsert compute from lastSeen normally
    trackInsert({ unitId, latitude: lat, longitude: lng, speed, tripStatus, locationInfo }).catch(() => {});

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// LOCATION READ ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/ambulance-location', (req, res) => res.json(ambulanceLocation));
app.get('/unit-location/:unitId', (req, res) => { const data = unitTripState.get(req.params.unitId); if (!data) return res.json({ trip_status: 'idle' }); res.json(data); });
app.get('/all-locations', (req, res) => { const now = Date.now(); res.json({ success: true, data: Array.from(units.values()).filter(u => u.location?.latitude).map(u => ({ id: u.id, name: u.name, type: u.type, status: u.status, isOnline: now - u.lastSeen < HEARTBEAT_TIMEOUT_MS, latitude: u.location.latitude, longitude: u.location.longitude, heading: u.location.heading || 0, speed: u.location.speed || 0, updatedAt: u.location.updatedAt })) }); });
app.get('/units', (req, res) => { const now = Date.now(); res.json({ success: true, data: Array.from(units.values()).map(u => ({ ...u, isOnline: now - u.lastSeen < HEARTBEAT_TIMEOUT_MS, secondsAgo: Math.floor((now - u.lastSeen) / 1000), distanceM: null })), total: units.size }); });
app.get('/ambulances', (req, res) => { const now = Date.now(); res.json({ success: true, data: Array.from(units.values()).map(u => ({ ...u, isOnline: now - u.lastSeen < HEARTBEAT_TIMEOUT_MS, secondsAgo: Math.floor((now - u.lastSeen) / 1000) })), total: units.size }); });
app.get('/nearest', (req, res) => {
  try {
    const destLat = parseFloat(req.query.lat), destLng = parseFloat(req.query.lng), typeFilter = req.query.type && req.query.type !== 'null' ? req.query.type : null, limit = parseInt(req.query.limit) || 5, now = Date.now();
    if (isNaN(destLat) || isNaN(destLng)) return res.status(400).json({ error: 'lat and lng required' });
    const available = Array.from(units.values()).filter(u => { const online = now - u.lastSeen < HEARTBEAT_TIMEOUT_MS, locLat = parseFloat(u.location?.latitude), locLng = parseFloat(u.location?.longitude), hasLoc = !isNaN(locLat) && !isNaN(locLng) && locLat !== 0 && locLng !== 0, typeOk = !typeFilter || u.type === typeFilter; return online && hasLoc && u.status === 'available' && typeOk; }).map(u => ({ id: u.id, name: u.name, type: u.type, status: u.status, isOnline: true, secondsAgo: Math.floor((now - u.lastSeen) / 1000), location: u.location, distanceM: Math.round(haversineMetres(destLat, destLng, parseFloat(u.location.latitude), parseFloat(u.location.longitude))) })).sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);
    res.json({ success: true, data: available });
  } catch (err) { res.status(500).json({ success: false, error: err.message, data: [] }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// POSTGRESQL HISTORY QUERIES
// ══════════════════════════════════════════════════════════════════════════════
app.get('/track-history/:unitId', async (req, res) => {
  try { const { rows } = await pgPool.query(`SELECT * FROM public.unit_locations WHERE unit_id = $1 ORDER BY "timestamp" DESC LIMIT $2`, [req.params.unitId, parseInt(req.query.limit) || 200]); res.json({ success: true, total: rows.length, data: rows }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/track-history/ticket/:ticketNo', async (req, res) => {
  try { const { rows } = await pgPool.query(`SELECT * FROM public.unit_locations WHERE ticket_no = $1 ORDER BY "timestamp" ASC`, [req.params.ticketNo]); res.json({ success: true, total: rows.length, data: rows }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── NEW: Online/Offline event history for a specific unit ─────────────────
// Returns only the status-event rows (registration, comeback, offline drops)
// Useful for the dispatch page's "history log" panel
app.get('/unit-status-history/:unitId', async (req, res) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT "timestamp", unit_id, user_name, device_status, trip_status, latitude, longitude, location_info
       FROM public.unit_locations
       WHERE unit_id = $1
         AND trip_status IN ('idle')
         AND (device_status = 'online' OR device_status = 'offline')
       ORDER BY "timestamp" DESC
       LIMIT $2`,
      [req.params.unitId, parseInt(req.query.limit) || 100]
    );
    res.json({ success: true, total: rows.length, data: rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── NEW: Online/Offline event history — all units (for dispatch overview) ──
app.get('/all-status-history', async (req, res) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT "timestamp", unit_id, user_name, unit_type, device_status, trip_status, latitude, longitude, location_info
       FROM public.unit_locations
       WHERE trip_status = 'idle'
         AND (device_status = 'online' OR device_status = 'offline')
       ORDER BY "timestamp" DESC
       LIMIT $1`,
      [parseInt(req.query.limit) || 200]
    );
    res.json({ success: true, total: rows.length, data: rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// DISPATCH & ASSIGNMENT
// ══════════════════════════════════════════════════════════════════════════════
app.post('/assign', async (req, res) => {
  const { unitId, ambulanceId, patientName, patientPhone, address, destination, notes, vehicleType, severity, formId, answers } = req.body;
  const id = unitId || ambulanceId, unit = units.get(id);
  if (!unit) return res.status(404).json({ error: `Unit ${id} not found` });
  if (unit.status === 'busy') return res.status(400).json({ error: `${unit.name} is already on an active incident` });
  const incidentId = uuidv4(); let submissionId = null;
  if (formId && answers && Object.keys(answers).length > 0) {
    try {
      const [rows] = await db.query('SELECT fields FROM forms WHERE id = ?', [formId]);
      if (rows.length) { const fields = typeof rows[0].fields === 'string' ? JSON.parse(rows[0].fields) : rows[0].fields, errors = validateAnswers(fields, answers); if (errors.length) return res.status(400).json({ success: false, errors }); }
      const [result] = await db.query('INSERT INTO form_submissions (form_id, incident_id, submitted_by, answers) VALUES (?, ?, ?, ?)', [formId, incidentId, 'dispatcher', JSON.stringify(answers)]);
      submissionId = result.insertId;
    } catch (dbErr) { console.warn('DB submission save failed:', dbErr.message); }
  }
  const alertData = { id: incidentId, status: 'pending', unitId: id, patientName: patientName || (answers?.f1 ?? ''), patientPhone: patientPhone || (answers?.f2 ?? ''), address: address || (answers?.f3 ?? ''), destination: destination || null, notes: notes || (answers?.f7 ?? answers?.f8 ?? ''), vehicleType: vehicleType || unit.type, severity: severity || (answers?.f5 ?? answers?.f7 ?? 'high'), assignedAt: Date.now(), submissionId, roomId: req.body.roomId || '', matrixRoomId: req.body.matrixRoomId || '', reason: '' };
  assignments.set(id, alertData); incidents.set(incidentId, { ...alertData, unitName: unit.name, unitType: unit.type });
  unit.status = 'busy'; unit.assignedIncidentId = incidentId; currentAlert = { ...alertData };
  unitTripState.set(id, makeFreshTripState({ tripStatus: 'dispatched' })); resetLegacyLocation();
  console.log(`🚨 Assigned ${unit.name} → incident ${incidentId.slice(0, 8)}`);
  if (unit.pushToken) await sendPushToToken(unit.pushToken, alertData);
  res.json({ success: true, id: incidentId, unitName: unit.name, submissionId });
});

app.post('/send-alert', async (req, res) => {
  const id = uuidv4();
  currentAlert = { id, status: 'pending', patientName: req.body.patientName || '', patientPhone: req.body.patientPhone || '', address: req.body.address || '', destination: req.body.destination, notes: req.body.notes || '', vehicleType: req.body.vehicleType || 'ambulance', severity: req.body.severity || 'high', roomId: req.body.roomId || '', matrixRoomId: req.body.matrixRoomId || '', reason: '' };
  resetLegacyLocation();
  const selectedUnits = dispatchToNearestUnits(currentAlert, currentAlert.vehicleType);
  await broadcastPush(currentAlert);
  res.json({ success: true, id, assignedUnits: selectedUnits.map(u => u.id) });
});

app.get('/my-alert', (req, res) => {
  const unitId = req.query.unitId || req.query.ambulanceId;
  if (!unitId) return res.status(400).json({ error: 'unitId required' });
  const unit = units.get(unitId); if (unit) unit.lastSeen = Date.now();
  res.json({ alert: assignments.get(unitId) || { id: null, status: 'waiting' } });
});

app.get('/status', (req, res) => res.json({ alert: currentAlert }));

app.post('/accept-assignment', (req, res) => {
  const unitId = req.body.unitId || req.body.ambulanceId, assign = assignments.get(unitId);
  if (!assign) return res.status(400).json({ error: 'No assignment' });
  if (assign.status === 'accepted') return res.status(400).json({ error: 'Already taken by another unit' });
  assign.status = 'accepted'; currentAlert.status = 'accepted';
  for (const [id, a] of assignments.entries()) { if (a.id === assign.id && id !== unitId) assignments.delete(id); }
  res.json({ success: true });
});

app.post('/accept', (req, res) => { if (!currentAlert.id) return res.status(400).json({ error: 'No active alert' }); currentAlert.status = 'accepted'; ambulanceLocation.trail = []; res.json({ success: true }); });

app.post('/reject-assignment', (req, res) => {
  const unitId = req.body.unitId || req.body.ambulanceId, reason = req.body.reason || 'manual', assign = assignments.get(unitId);
  if (assign) { assign.status = 'rejected'; assign.reason = reason; }
  const unit = units.get(unitId); if (unit) { unit.status = 'available'; unit.assignedIncidentId = null; }
  assignments.delete(unitId); currentAlert.status = 'rejected'; currentAlert.reason = reason;
  res.json({ success: true });
});

app.post('/reject', (req, res) => { currentAlert.status = 'rejected'; currentAlert.reason = req.body.reason || 'manual'; res.json({ success: true }); });

app.post('/complete-trip', (req, res) => {
  const unitId = req.body.unitId || req.body.ambulanceId, unit = units.get(unitId);
  if (unit) { unit.status = 'available'; unit.assignedIncidentId = null; }
  assignments.delete(unitId);
  if (unitId && unitTripState.has(unitId)) unitTripState.set(unitId, { ...unitTripState.get(unitId), tripStatus: 'completed' });
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// UPDATE DISPATCH STATUS — inserts ONE status-event row to DB on button press
// ══════════════════════════════════════════════════════════════════════════════
app.post('/update-dispatch-status', async (req, res) => {
  const allowed = ['dispatched', 'accepted', 'en_route', 'on_action', 'arrived', 'completed', 'abandoned', 'idle'];
  const { tripStatus, unitId, ambulanceId } = req.body;
  if (!allowed.includes(tripStatus)) return res.status(400).json({ error: `Invalid: ${tripStatus}` });
  const uid = unitId || ambulanceId;
  if (!uid) return res.status(400).json({ error: 'unitId is required' });
  if (!unitTripState.has(uid)) unitTripState.set(uid, makeFreshTripState());
  const prev = unitTripState.get(uid);
  unitTripState.set(uid, { ...prev, tripStatus, timestamp: Date.now() });
  console.log(`✅ ${uid} → ${tripStatus}`);

  if (prev.latitude && prev.longitude) {
    trackInsert({ unitId: uid, latitude: prev.latitude, longitude: prev.longitude, speed: prev.speed || 0, tripStatus }).catch(() => {});
  }

  const assignedUnits = Array.from(assignments.keys());
  if (assignedUnits.length > 0 && assignedUnits.every(id => unitTripState.get(id)?.tripStatus === 'completed')) {
    console.log('🎉 All units completed → Ticket completed'); currentAlert.status = 'completed';
  }
  ambulanceLocation.tripStatus = tripStatus;
  res.json({ success: true, unitId: uid, tripStatus });
});

app.get('/incidents', (req, res) => res.json({ success: true, data: Array.from(incidents.values()).sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0)) }));
app.post('/register-token', (req, res) => { const { token } = req.body; if (!token) return res.status(400).json({ error: 'No token' }); pushTokens.add(token); res.json({ success: true, devices: pushTokens.size }); });

app.get('/directions', async (req, res) => {
  const { originLat, originLng, destLat, destLng, mode } = req.query;
  if (!originLat || !originLng || !destLat || !destLng) return res.status(400).json({ error: 'Missing params' });
  const tMode = mode || 'driving', traffic = tMode === 'driving' ? '&departure_time=now&traffic_model=best_guess' : '';
  try { const data = await fetch(`https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&mode=${tMode}&alternatives=true${traffic}&key=${GOOGLE_KEY}`).then(r => r.json()); res.json(data); }
  catch { res.status(500).json({ error: 'Directions fetch failed' }); }
});

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), units: units.size, incidents: incidents.size, unitTripStates: unitTripState.size }));
app.use((err, req, res, next) => { console.error('❌', req.path, err.message); res.status(500).json({ success: false, error: err.message, data: [] }); });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚨 Emergency Control System v5.2 → http://0.0.0.0:${PORT}`);
  console.log(`💓 Heartbeat (keep-alive, DB only on comeback) → POST /heartbeat`);
  console.log(`📍 Live tracking (DB insert)                   → POST /track`);
  console.log(`🟢 Registration online event                   → POST /register-unit`);
  console.log(`📜 Trip history                                → GET  /track-history/:unitId`);
  console.log(`📜 History by ticket                           → GET  /track-history/ticket/:ticketNo`);
  console.log(`🔋 Unit status history (online/offline events) → GET  /unit-status-history/:unitId`);
  console.log(`🔋 All units status history                    → GET  /all-status-history`);
});