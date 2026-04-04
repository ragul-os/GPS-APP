/**
 * server.js — Emergency Control System  v4.1
 *
 * KEY FIX vs v4.0:
 * ─────────────────────────────────────────────────────────────────────────────
 * The shared `ambulanceLocation` object was overwritten by whichever unit
 * posted last — so /ambulance-location and /unit-location/:unitId both
 * returned mixed data from different units.
 *
 * Now:
 *   • `unitTripState`  Map<unitId, tripStateObj> — per-unit trip state
 *   • POST /update-unit-location   writes to unitTripState[unitId]
 *   • POST /update-ambulance-location same
 *   • POST /heartbeat              writes location to unit.location AND
 *                                  unitTripState[unitId] (no overwrite of others)
 *   • GET  /unit-location/:unitId  returns ONLY that unit's trip state
 *   • GET  /ambulance-location     kept for legacy; returns last-writer's state
 *   • GET  /all-locations          unchanged (reads unit.location per unit)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const GOOGLE_KEY = 'AIzaSyAVz9omOzS8B29CEi50AkrNPMPn3JXhbcg';
const HEARTBEAT_TIMEOUT_MS = 30000;

app.use(cors({ origin: '*' }));
app.use(bodyParser.json());

// ══════════════════════════════════════════════════════════════════════════════
// DATABASE
// ══════════════════════════════════════════════════════════════════════════════
const db = mysql.createPool({
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'Admin@123',
  database: 'emergency_db',
  waitForConnections: true,
  connectionLimit: 10,
});

(async () => {
  try {
    await db.query('SELECT 1');
    console.log('✅ MySQL connected → emergency_db');
  } catch (err) {
    console.warn('⚠️  MySQL not connected:', err.message);
  }
})();

// ══════════════════════════════════════════════════════════════════════════════
// IN-MEMORY STATE
// ══════════════════════════════════════════════════════════════════════════════
const units = new Map();
const assignments = new Map();
const incidents = new Map();

// ── PER-UNIT trip state (THE FIX) ─────────────────────────────────────────
// Each unit that posts a location update gets its own slot here.
// /unit-location/:unitId reads ONLY from unitTripState.get(unitId).
const unitTripState = new Map(); // Map<unitId, tripStateObj>

function makeFreshTripState(overrides = {}) {
  return {
    latitude: null,
    longitude: null,
    heading: 0,
    speed: 0,
    remainingDistM: 0,
    remainingTimeS: 0,
    tripStatus: 'dispatched',
    stepIdx: 0,
    totalSteps: 0,
    distToDest: 0,
    timestamp: null,
    trail: [],
    ...overrides,
  };
}

// Legacy single-unit shared state — kept so /ambulance-location still works
// for any old clients. NOT used by the new per-unit tracking.
let ambulanceLocation = makeFreshTripState({ tripStatus: 'idle' });

let currentAlert = {
  id: null, status: 'waiting', patientName: '',
  patientPhone: '', address: '', destination: null, notes: '', reason: ''
};

let pushTokens = new Set();

setInterval(() => {
  const now = Date.now();
  for (const [id, unit] of units.entries()) {
    if (now - unit.lastSeen > HEARTBEAT_TIMEOUT_MS && unit.status !== 'offline') {
      unit.status = 'offline';
      console.log(`📴 Unit offline: ${id}`);
    }
  }
}, 15000);

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function haversineMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dφ = (lat2 - lat1) * Math.PI / 180;
  const dλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resetUnitTripState(unitId) {
  unitTripState.set(unitId, makeFreshTripState({ tripStatus: 'dispatched' }));
}

function resetLegacyLocation() {
  ambulanceLocation = makeFreshTripState({ tripStatus: 'dispatched' });
}

function dispatchToNearestUnits(alert, type) {
  const nearby = Array.from(units.values())
    .filter(u => u.type === type && u.status === 'available' && u.location)
    .map(u => ({
      ...u,
      distance: haversineMetres(
        alert.destination?.latitude, alert.destination?.longitude,
        u.location.latitude, u.location.longitude
      )
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
  nearby.forEach(unit => assignments.set(unit.id, alert));
  return nearby;
}

async function sendPushToToken(token, alert) {
  if (!token) return;
  try {
    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        to: token, sound: 'default', priority: 'high',
        channelId: 'emergency-alerts', ttl: 300,
        title: `🚨 Emergency — ${alert.patientName || 'Incident'}`,
        body: `📍 ${alert.address || 'Location pending'}\n📝 ${alert.notes || ''}`,
        data: { type: 'emergency_alert', ...alert },
      }]),
    });
    const result = await r.json();
    const item = result.data?.[0];
    if (item?.status === 'ok') console.log(`✅ Push sent`);
    else console.warn(`❌ Push failed:`, item?.message);
  } catch (err) { console.error('Push error:', err.message); }
}

async function broadcastPush(alert) {
  if (!pushTokens.size) return;
  const messages = [...pushTokens].map(token => ({
    to: token, sound: 'default', priority: 'high',
    channelId: 'emergency-alerts', ttl: 300,
    title: `🚨 Emergency — ${alert.patientName || 'Incident'}`,
    body: `📍 ${alert.address || 'Location pending'}`,
    data: { type: 'emergency_alert', ...alert },
  }));
  try {
    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    const result = await r.json();
    result.data?.forEach((item, i) => {
      if (item.status === 'ok') console.log(`✅ Broadcast push device ${i + 1}`);
      else if (item.details?.error === 'DeviceNotRegistered')
        pushTokens.delete([...pushTokens][i]);
    });
  } catch (err) { console.error('Broadcast push error:', err.message); }
}

function validateAnswers(fields, answers) {
  const errors = [];
  for (const field of fields) {
    if (!field.required) continue;
    const val = answers[field.id];
    const empty = val === undefined || val === null || val === '' ||
      (Array.isArray(val) && val.length === 0);
    if (empty) errors.push(`"${field.label}" is required`);
  }
  return errors;
}

// ══════════════════════════════════════════════════════════════════════════════
// FORM ROUTES (unchanged from v4.0)
// ══════════════════════════════════════════════════════════════════════════════
app.get('/forms/:unitType', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT f.*, ft.name AS type_name FROM forms f
       JOIN form_types ft ON f.form_type_id = ft.id
       WHERE f.unit_type = ? AND f.form_type_id = 1 AND f.is_active = 1 LIMIT 1`,
      [req.params.unitType]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Form not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/forms/scene/assessment', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT f.*, ft.name AS type_name FROM forms f
       JOIN form_types ft ON f.form_type_id = ft.id
       WHERE f.form_type_id = 2 AND f.is_active = 1 LIMIT 1`
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Scene form not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/forms/:formId/submit', async (req, res) => {
  try {
    const { answers = {}, incidentId, submittedBy = 'dispatcher' } = req.body;
    const [rows] = await db.query('SELECT * FROM forms WHERE id = ? AND is_active = 1', [req.params.formId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Form not found' });
    const form = rows[0];
    const fields = typeof form.fields === 'string' ? JSON.parse(form.fields) : form.fields;
    const errors = validateAnswers(fields, answers);
    if (errors.length) return res.status(400).json({ success: false, errors });
    const [result] = await db.query(
      `INSERT INTO form_submissions (form_id, incident_id, submitted_by, answers) VALUES (?, ?, ?, ?)`,
      [form.id, incidentId || null, submittedBy, JSON.stringify(answers)]
    );
    res.json({ success: true, submissionId: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/forms/submissions/:incidentId', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT fs.*, f.name AS form_name, f.unit_type, ft.name AS form_type_name
       FROM form_submissions fs
       JOIN forms f ON fs.form_id = f.id
       JOIN form_types ft ON f.form_type_id = ft.id
       WHERE fs.incident_id = ? ORDER BY fs.submitted_at DESC`,
      [req.params.incidentId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/admin/forms', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT f.id, f.name, f.unit_type, f.is_active,
              ft.name AS type_name, JSON_LENGTH(f.fields) AS field_count,
              f.created_at, f.updated_at
       FROM forms f JOIN form_types ft ON f.form_type_id = ft.id
       ORDER BY f.form_type_id, f.unit_type`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/admin/forms/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT f.*, ft.name AS type_name FROM forms f JOIN form_types ft ON f.form_type_id = ft.id WHERE f.id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/forms', async (req, res) => {
  try {
    const { form_type_id, name, unit_type, fields } = req.body;
    if (!name || !unit_type || !fields?.length)
      return res.status(400).json({ success: false, error: 'name, unit_type, fields required' });
    const [result] = await db.query(
      'INSERT INTO forms (form_type_id, name, unit_type, fields) VALUES (?, ?, ?, ?)',
      [form_type_id || 1, name, unit_type, JSON.stringify(fields)]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/admin/forms/:id', async (req, res) => {
  try {
    const { fields, name, is_active } = req.body;
    const updates = [], vals = [];
    if (fields) { updates.push('fields = ?'); vals.push(JSON.stringify(fields)); }
    if (name) { updates.push('name = ?'); vals.push(name); }
    if (is_active !== undefined) { updates.push('is_active = ?'); vals.push(is_active ? 1 : 0); }
    if (!updates.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    vals.push(req.params.id);
    await db.query(`UPDATE forms SET ${updates.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/admin/form-types', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM form_types ORDER BY id');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// UNIT REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════
function handleRegister(req, res) {
  const unitId = req.body.unitId || req.body.ambulanceId;
  const name = req.body.name;
  const type = req.body.type || 'ambulance';
  const pushToken = req.body.pushToken || null;
  if (!unitId || !name) return res.status(400).json({ error: 'unitId and name required' });
  const existing = units.get(unitId);
  const unit = {
    id: unitId, name, type,
    status: existing?.status === 'busy' ? 'busy' : 'available',
    lastSeen: Date.now(),
    registeredAt: existing?.registeredAt || Date.now(),
    pushToken: pushToken || existing?.pushToken || null,
    assignedIncidentId: existing?.assignedIncidentId || null,
    location: existing?.location || null,
  };
  units.set(unitId, unit);
  if (pushToken) pushTokens.add(pushToken);
  // Ensure this unit has its own trip state slot
  if (!unitTripState.has(unitId)) {
    unitTripState.set(unitId, makeFreshTripState());
  }
  console.log(`✅ Unit registered: ${name} (${unitId})`);
  res.json({ success: true, unit });
}
app.post('/register-unit', handleRegister);
app.post('/register-ambulance', handleRegister);

app.post('/heartbeat', (req, res) => {
  const unitId = req.body.unitId || req.body.ambulanceId;
  const unit = units.get(unitId);
  if (!unit) return res.status(404).json({ error: 'Unit not registered' });

  unit.lastSeen = Date.now();

  if (unit.status === 'offline') {
    unit.status = unit.assignedIncidentId ? 'busy' : 'available';
    console.log(`🔄 Unit back online: ${unit.name} (${unitId})`);
  }

  const lat = parseFloat(req.body.latitude);
  const lng = parseFloat(req.body.longitude);

  if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
    unit.location = {
      latitude: lat,
      longitude: lng,
      heading: parseFloat(req.body.heading) || unit.location?.heading || 0,
      speed: parseFloat(req.body.speed) || unit.location?.speed || 0,
      updatedAt: Date.now(),
    };

    // ── Update THIS unit's trip state only ────────────────────────────────
    const prev = unitTripState.get(unitId) || makeFreshTripState();
    unitTripState.set(unitId, {
      ...prev,
      latitude: lat,
      longitude: lng,
      heading: unit.location.heading,
      speed: unit.location.speed,
      timestamp: Date.now(),
      trail: [...(prev.trail || []).slice(-149), {
        latitude: lat, longitude: lng,
        heading: unit.location.heading,
        speed: unit.location.speed,
      }],
    });

    // Legacy shared store — last writer wins (kept for old clients only)
    ambulanceLocation = {
      ...ambulanceLocation,
      latitude: lat, longitude: lng,
      heading: unit.location.heading, speed: unit.location.speed,
      timestamp: Date.now(),
    };
  }

  res.json({ success: true, hasLocation: !isNaN(lat) && !isNaN(lng) });
});

app.get('/units', (req, res) => {
  const now = Date.now();
  const list = Array.from(units.values()).map(u => ({
    ...u,
    isOnline: now - u.lastSeen < HEARTBEAT_TIMEOUT_MS,
    secondsAgo: Math.floor((now - u.lastSeen) / 1000),
    distanceM: null,
  }));
  res.json({ success: true, data: list, total: list.length });
});

app.get('/ambulances', (req, res) => {
  const now = Date.now();
  const list = Array.from(units.values()).map(u => ({
    ...u,
    isOnline: now - u.lastSeen < HEARTBEAT_TIMEOUT_MS,
    secondsAgo: Math.floor((now - u.lastSeen) / 1000),
  }));
  res.json({ success: true, data: list, total: list.length });
});

app.get('/nearest', (req, res) => {
  try {
    const destLat = parseFloat(req.query.lat);
    const destLng = parseFloat(req.query.lng);
    const typeFilter = req.query.type && req.query.type !== 'null' ? req.query.type : null;
    const limit = parseInt(req.query.limit) || 5;
    const now = Date.now();
    if (isNaN(destLat) || isNaN(destLng))
      return res.status(400).json({ error: 'lat and lng required' });

    const available = Array.from(units.values())
      .filter(u => {
        const online = now - u.lastSeen < HEARTBEAT_TIMEOUT_MS;
        const locLat = parseFloat(u.location?.latitude);
        const locLng = parseFloat(u.location?.longitude);
        const hasLoc = !isNaN(locLat) && !isNaN(locLng) && locLat !== 0 && locLng !== 0;
        const typeOk = !typeFilter || u.type === typeFilter;
        return online && hasLoc && u.status === 'available' && typeOk;
      })
      .map(u => ({
        id: u.id, name: u.name, type: u.type, status: u.status,
        isOnline: true,
        secondsAgo: Math.floor((now - u.lastSeen) / 1000),
        location: u.location,
        distanceM: Math.round(haversineMetres(
          destLat, destLng,
          parseFloat(u.location.latitude),
          parseFloat(u.location.longitude)
        )),
      }))
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, limit);

    res.json({ success: true, data: available });
  } catch (err) {
    console.error('/nearest error:', err.message);
    res.status(500).json({ success: false, error: err.message, data: [] });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// LOCATION UPDATES — now writes to per-unit store
// ══════════════════════════════════════════════════════════════════════════════
function handleLocationUpdate(req, res) {
  const unitId = req.body.unitId || req.body.ambulanceId;
  const lat = parseFloat(req.body.latitude);
  const lng = parseFloat(req.body.longitude);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'Invalid coordinates' });

  // Update unit.location (for /all-locations)
  const unit = units.get(unitId);
  if (unit) {
    unit.lastSeen = Date.now();
    unit.location = {
      latitude: lat, longitude: lng,
      heading: req.body.heading || 0, speed: req.body.speed || 0,
      updatedAt: Date.now(),
    };
  }

  const prevState = unitTripState.get(unitId) || makeFreshTripState();



  const point = {
    latitude: lat,
    longitude: lng,
    heading: req.body.heading || 0,
    speed: req.body.speed || 0,
    remainingDistM: req.body.remainingDistM || 0,
    remainingTimeS: req.body.remainingTimeS || 0,
    tripStatus: prevState.tripStatus === 'completed'
      ? 'completed'
      : (req.body.tripStatus || prevState.tripStatus || 'en_route'),
    stepIdx: req.body.stepIdx || 0,
    totalSteps: req.body.totalSteps || 0,
    distToDest: req.body.distToDest || 0,
    timestamp: Date.now(),
  };
  console.log(`🚑 ${unitId} | speed=${point.speed} | ETA=${point.remainingTimeS}`);

  if (unitId) {
    // ── Write to THIS unit's own trip state ────────────────────────────────
    const prev = unitTripState.get(unitId) || makeFreshTripState();
    unitTripState.set(unitId, {
      ...point,
      trail: [...(prev.trail || []).slice(-149), point],
    });
  }

  // Legacy shared store — last writer wins, kept for backward compat
  ambulanceLocation = { ...point, trail: [...ambulanceLocation.trail.slice(-149), point] };

  res.json({ success: true });
}

app.post('/update-unit-location', handleLocationUpdate);
app.post('/update-ambulance-location', handleLocationUpdate);
app.post('/update-location', handleLocationUpdate);

// GET /ambulance-location — legacy, returns last-writer's data
app.get('/ambulance-location', (req, res) => res.json(ambulanceLocation));

// GET /unit-location/:unitId — THE FIX: returns ONLY this unit's trip state
app.get('/unit-location/:unitId', (req, res) => {
  const unit = units.get(req.params.unitId);
  if (!unit) return res.status(404).json({ error: 'Unit not found' });

  // Get this unit's own trip state (never shared with other units)
  const tripState = unitTripState.get(req.params.unitId) || makeFreshTripState();

  // Also pull the per-unit assignment to get tripStatus from /my-alert side
  const assignment = assignments.get(req.params.unitId);

  res.json({
    // Trip state (position, speed, ETA, nav steps) — all unit-specific
    ...tripState,
    // Unit identity
    unitId: unit.id,
    name: unit.name,
    type: unit.type,
    status: unit.status,
    // If the unit hasn't posted a full location update yet, fall back to unit.location
    latitude: tripState.latitude ?? unit.location?.latitude ?? null,
    longitude: tripState.longitude ?? unit.location?.longitude ?? null,
    // tripStatus: prefer the assignment's status if available (set by mobile app)
    tripStatus:
      tripState.tripStatus === 'completed'
        ? 'completed'
        : (tripState.tripStatus || 'dispatched'),
  });
});

app.get('/all-locations', (req, res) => {
  const now = Date.now();
  const data = Array.from(units.values()).filter(u => u.location?.latitude).map(u => ({
    id: u.id, name: u.name, type: u.type, status: u.status,
    isOnline: now - u.lastSeen < HEARTBEAT_TIMEOUT_MS,
    latitude: u.location.latitude, longitude: u.location.longitude,
    heading: u.location.heading || 0, speed: u.location.speed || 0,
    updatedAt: u.location.updatedAt,
  }));
  res.json({ success: true, data });
});

// ══════════════════════════════════════════════════════════════════════════════
// DISPATCH & ASSIGNMENT
// ══════════════════════════════════════════════════════════════════════════════
app.post('/assign', async (req, res) => {
  const {
    unitId, ambulanceId,
    patientName, patientPhone, address,
    destination, notes, vehicleType, severity,
    formId, answers,
  } = req.body;

  const id = unitId || ambulanceId;
  const unit = units.get(id);
  if (!unit) return res.status(404).json({ error: `Unit ${id} not found` });
  if (unit.status === 'busy')
    return res.status(400).json({ error: `${unit.name} is already on an active incident` });

  const incidentId = uuidv4();
  let submissionId = null;

  if (formId && answers && Object.keys(answers).length > 0) {
    try {
      const [rows] = await db.query('SELECT fields FROM forms WHERE id = ?', [formId]);
      if (rows.length) {
        const fields = typeof rows[0].fields === 'string' ? JSON.parse(rows[0].fields) : rows[0].fields;
        const errors = validateAnswers(fields, answers);
        if (errors.length) return res.status(400).json({ success: false, errors });
      }
      const [result] = await db.query(
        'INSERT INTO form_submissions (form_id, incident_id, submitted_by, answers) VALUES (?, ?, ?, ?)',
        [formId, incidentId, 'dispatcher', JSON.stringify(answers)]
      );
      submissionId = result.insertId;
    } catch (dbErr) {
      console.warn('DB submission save failed (continuing):', dbErr.message);
    }
  }

  const alertData = {
    id: incidentId,
    status: 'pending',
    unitId: id,
    patientName: patientName || (answers?.f1 ?? ''),
    patientPhone: patientPhone || (answers?.f2 ?? ''),
    address: address || (answers?.f3 ?? ''),
    destination: destination || null,
    notes: notes || (answers?.f7 ?? answers?.f8 ?? ''),
    vehicleType: vehicleType || unit.type,
    severity: severity || (answers?.f5 ?? answers?.f7 ?? 'high'),
    assignedAt: Date.now(),
    submissionId,
    reason: '',
  };

  assignments.set(id, alertData);
  incidents.set(incidentId, { ...alertData, unitName: unit.name, unitType: unit.type });
  unit.status = 'busy';
  unit.assignedIncidentId = incidentId;
  currentAlert = { ...alertData };

  // Reset THIS unit's trip state (not all units)
  unitTripState.set(id, makeFreshTripState({ tripStatus: 'dispatched' }));
  resetLegacyLocation();

  console.log(`🚨 Assigned ${unit.name} → incident ${incidentId.slice(0, 8)}`);
  if (unit.pushToken) await sendPushToToken(unit.pushToken, alertData);

  res.json({ success: true, id: incidentId, unitName: unit.name, submissionId });
});

app.post('/send-alert', async (req, res) => {
  const id = uuidv4();
  currentAlert = {
    id, status: 'pending',
    patientName: req.body.patientName || '',
    patientPhone: req.body.patientPhone || '',
    address: req.body.address || '',
    destination: req.body.destination,
    notes: req.body.notes || '',
    vehicleType: req.body.vehicleType || 'ambulance',
    severity: req.body.severity || 'high',
    reason: '',
  };
  resetLegacyLocation();
  const selectedUnits = dispatchToNearestUnits(currentAlert, currentAlert.vehicleType);
  await broadcastPush(currentAlert);
  res.json({ success: true, id, assignedUnits: selectedUnits.map(u => u.id) });
});

app.get('/my-alert', (req, res) => {
  const unitId = req.query.unitId || req.query.ambulanceId;
  if (!unitId) return res.status(400).json({ error: 'unitId required' });
  const unit = units.get(unitId);
  if (unit) unit.lastSeen = Date.now();
  res.json({ alert: assignments.get(unitId) || { id: null, status: 'waiting' } });
});

app.get('/status', (req, res) => res.json({ alert: currentAlert }));

app.post('/accept-assignment', (req, res) => {
  const unitId = req.body.unitId || req.body.ambulanceId;
  const assign = assignments.get(unitId);
  if (!assign) return res.status(400).json({ error: 'No assignment' });
  if (assign.status === 'accepted') return res.status(400).json({ error: 'Already taken by another unit' });
  assign.status = 'accepted'; currentAlert.status = 'accepted';
  for (const [id, a] of assignments.entries()) {
    if (a.id === assign.id && id !== unitId) assignments.delete(id);
  }
  res.json({ success: true });
});

app.post('/accept', (req, res) => {
  if (!currentAlert.id) return res.status(400).json({ error: 'No active alert' });
  currentAlert.status = 'accepted'; ambulanceLocation.trail = [];
  res.json({ success: true });
});

app.post('/reject-assignment', (req, res) => {
  const unitId = req.body.unitId || req.body.ambulanceId;
  const reason = req.body.reason || 'manual';
  const assign = assignments.get(unitId);
  if (assign) { assign.status = 'rejected'; assign.reason = reason; }
  const unit = units.get(unitId);
  if (unit) { unit.status = 'available'; unit.assignedIncidentId = null; }
  assignments.delete(unitId);
  currentAlert.status = 'rejected'; currentAlert.reason = reason;
  res.json({ success: true });
});

app.post('/reject', (req, res) => {
  currentAlert.status = 'rejected'; currentAlert.reason = req.body.reason || 'manual';
  res.json({ success: true });
});

app.post('/complete-trip', (req, res) => {
  const unitId = req.body.unitId || req.body.ambulanceId;
  const unit = units.get(unitId);
  if (unit) { unit.status = 'available'; unit.assignedIncidentId = null; }
  assignments.delete(unitId);
  // Mark this unit's trip as completed in its own trip state
  if (unitId && unitTripState.has(unitId)) {
    const prev = unitTripState.get(unitId);
    unitTripState.set(unitId, { ...prev, tripStatus: 'completed' });
  }
  res.json({ success: true });
});

app.post('/update-dispatch-status', (req, res) => {
  const { tripStatus, unitId, ambulanceId } = req.body;

  const allowed = [
    'dispatched',
    'accepted',
    'en_route',
    'on_action',
    'arrived',
    'completed',
    'abandoned',
    'idle'
  ];

  // 🚨 Validate status
  if (!allowed.includes(tripStatus)) {
    return res.status(400).json({ error: `Invalid: ${tripStatus}` });
  }

  // ✅ Get unitId correctly
  const uid = unitId || ambulanceId;

  if (!uid) {
    return res.status(400).json({ error: 'unitId is required' });
  }

  // ✅ Ensure unit exists in map
  if (!unitTripState.has(uid)) {
    console.log(`⚠️ Creating new trip state for ${uid}`);
    unitTripState.set(uid, makeFreshTripState());
  }

  // ✅ Update ONLY this unit
  const prev = unitTripState.get(uid);

  const updatedState = {
    ...prev,
    tripStatus,
    timestamp: Date.now()
  };

  unitTripState.set(uid, updatedState);

  console.log(`✅ ${uid} → ${tripStatus}`);

  // ─────────────────────────────────────────────
  // 🔥 AUTO COMPLETE LOGIC (VERY IMPORTANT)
  // ─────────────────────────────────────────────

  // Get all assigned units
  const assignedUnits = Array.from(assignments.keys());

  if (assignedUnits.length > 0) {
    const allCompleted = assignedUnits.every(id => {
      const st = unitTripState.get(id)?.tripStatus;
      return st === 'completed';
    });

    if (allCompleted) {
      console.log('🎉 All units completed → Ticket completed');
      currentAlert.status = 'completed';
    }
  }

  // Legacy fallback
  ambulanceLocation.tripStatus = tripStatus;

  res.json({
    success: true,
    unitId: uid,
    tripStatus
  });
});

app.get('/incidents', (req, res) => {
  const list = Array.from(incidents.values()).sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0));
  res.json({ success: true, data: list });
});

app.post('/register-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'No token' });
  pushTokens.add(token);
  res.json({ success: true, devices: pushTokens.size });
});

app.get('/directions', async (req, res) => {
  const { originLat, originLng, destLat, destLng, mode } = req.query;
  if (!originLat || !originLng || !destLat || !destLng)
    return res.status(400).json({ error: 'Missing params' });
  const tMode = mode || 'driving';
  const traffic = tMode === 'driving' ? '&departure_time=now&traffic_model=best_guess' : '';
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&mode=${tMode}&alternatives=true${traffic}&key=${GOOGLE_KEY}`;
  try {
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (err) { res.status(500).json({ error: 'Directions fetch failed' }); }
});

app.get('/health', (req, res) => res.json({
  status: 'ok', uptime: process.uptime(),
  units: units.size, incidents: incidents.size,
  unitTripStates: unitTripState.size,
}));

app.use((err, req, res, next) => {
  console.error('❌ Unhandled error on', req.path, ':', err.message);
  res.status(500).json({ success: false, error: err.message, data: [] });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚨 Emergency Control System running → http://0.0.0.0:${PORT}`);
  console.log(`📋 Forms          → GET  /forms/:unitType`);
  console.log(`📝 Scene form     → GET  /forms/scene/assessment`);
  console.log(`✅ Submit form    → POST /forms/:formId/submit`);
  console.log(`🔧 Admin forms    → GET/POST/PUT /admin/forms`);
  console.log(`📍 Per-unit loc   → GET  /unit-location/:unitId`);
});