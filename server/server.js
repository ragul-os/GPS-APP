/**
 * server.js — Emergency Control System  v5.2
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

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { connect: connectNats, StringCodec } = require('nats');
const { Pool: PgPool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const GOOGLE_KEY = process.env.GOOGLE_MAP_API_KEY || 'AIzaSyAVz9omOzS8B29CEi50AkrNPMPn3JXhbcg';
const HEARTBEAT_TIMEOUT_MS = 30000;

app.use(cors({ origin: '*' }));
app.use(bodyParser.json());

// ══════════════════════════════════════════════════════════════════════════════
// MYSQL — forms, submissions
// ══════════════════════════════════════════════════════════════════════════════
const db = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'Admin@123',
  database: process.env.MYSQL_DB || 'emergency_db',
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

// PostgreSQL Pool for NATS location updates
const pgPool = new PgPool({
  user: process.env.POSTGRES_USER || 'postgres',
  host: process.env.POSTGRES_HOST || '192.168.9.30',
  database: process.env.POSTGRES_DB || 'synapse',
  password: process.env.POSTGRES_PASSWORD || 'Admin@123',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
});

(async () => {
  try {
    await pgPool.query('SELECT 1');
    console.log('✅ PostgreSQL connected → synapse');
  } catch (err) {
    console.warn('⚠️  PostgreSQL not connected:', err.message);
  }
})();

// NATS Integration
const sc = StringCodec();
let nc = null;

// ══════════════════════════════════════════════════════════════════════════════
// IN-MEMORY STATE
// ══════════════════════════════════════════════════════════════════════════════
const units = new Map();
const assignments = new Map();
const incidents = new Map();
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

      const ts = unitTripState.get(id);
      // Best coords: prefer unitTripState (most recent from /track or heartbeat),
      // fall back to unit.location (set by heartbeat), skip insert if nothing known
      const offLat = ts?.latitude || unit.location?.latitude;
      const offLng = ts?.longitude || unit.location?.longitude;
      const offSpd = ts?.speed || unit.location?.speed || 0;

      if (offLat && offLng) {
        trackInsert({
          unitId: id,
          latitude: offLat,
          longitude: offLng,
          speed: offSpd,
          tripStatus: ts?.tripStatus || 'idle',
          locationInfo: null,
          forceDeviceStatus: 'offline',
        }).catch(() => { });
        console.log(`🔴 DB: ${id} → offline @ ${offLat},${offLng}`);
      } else {
        console.log(`🔴 Unit ${id} went offline — no coords available, skipping DB insert`);
      }
    }
  }
}, 15000);

// Initialize NATS Subscriber
(async () => {
  try {
    const natsUrl = process.env.NATS_URL || 'nats://192.168.9.56:4222';
    const natsOptions = { servers: natsUrl };

    let tlsEnabled = false;
    try {
      const certsDir = path.join(__dirname, 'certs');
      if (fs.existsSync(certsDir)) {
        const caFiles = ['ca.crt', 'ca-cert.crt'];
        const cas = [];
        caFiles.forEach(f => {
          const p = path.join(certsDir, f);
          if (fs.existsSync(p)) cas.push(fs.readFileSync(p, 'utf8'));
        });

        const certPath = path.join(certsDir, 'server.crt');
        const keyPath = path.join(certsDir, 'server.key');

        if (cas.length > 0 && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
          natsOptions.tls = {
            ca: cas,
            cert: fs.readFileSync(certPath, 'utf8'),
            key: fs.readFileSync(keyPath, 'utf8'),
            rejectUnauthorized: false
          };
          tlsEnabled = true;
        }
      }
    } catch (e) {
      console.warn('⚠️  Could not load NATS TLS certificates:', e.message);
    }

    try {
      nc = await connectNats(natsOptions);
      console.log(`✅ NATS connected → ${natsUrl}${tlsEnabled ? ' (TLS)' : ' (Plain)'}`);
    } catch (tlsErr) {
      // If TLS failed, attempt plain text fallback
      if (tlsEnabled) {
        console.warn('⚠️  NATS TLS connection failed. Attempting plain connection...');
        delete natsOptions.tls;
        nc = await connectNats(natsOptions);
        console.log(`✅ NATS connected → ${natsUrl} (Plain fallback)`);
      } else {
        throw tlsErr;
      }
    }

    const sub = nc.subscribe('gps.stream.req');
    (async () => {
      for await (const msg of sub) {
        try {
          const data = JSON.parse(sc.decode(msg.data));
          if (!data.unit_id && !data.ticket_no && !data.unitId) continue;

          const unitId = data.unit_id || data.unitId || data.ambulanceId;
          const ticketNo = data.ticket_no || data.ticketNo || '';
          console.log(`📥 NATS RECV [gps.stream.req] -> Unit: ${unitId}, Ticket: ${ticketNo}`);

          let lat = parseFloat(data.latitude);
          let lng = parseFloat(data.longitude);
          const speed = parseFloat(data.speed) || 0;
          const tripStatus = data.trip_status || data.tripStatus || 'en_route';
          const heading = parseFloat(data.heading) || 0;

          if (isNaN(lat) || isNaN(lng)) continue;

          // Store in PostgreSQL
          await pgPool.query(
            `INSERT INTO public.unit_locations (
              "timestamp", unit_id, unit_type, user_name, latitude, longitude, unit_status, device_status, ticket_no, trip_status, speed, location_info, remarks
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              data.timestamp || new Date().toISOString(),
              unitId,
              data.unit_type || 'ambulance',
              data.user_name || 'matrixuser',
              lat, lng,
              data.unit_status || 'busy',
              data.device_status || 'online',
              ticketNo,
              tripStatus,
              speed,
              JSON.stringify(data.location_info || {}),
              data.remarks || ''
            ]
          );

          // Update In-Memory State
          const unit = units.get(unitId);
          if (unit) {
            unit.lastSeen = Date.now();
            unit.location = { latitude: lat, longitude: lng, heading, speed, updatedAt: Date.now() };
          }

          const key = `${ticketNo}:${unitId}`;

const prevState = unitTripState.get(key) || makeFreshTripState();

const point = {
  latitude: lat,
  longitude: lng,
  heading,
  speed,
  remainingDistM: data.remainingDistM || 0,
  remainingTimeS: data.remainingTimeS || 0,
  tripStatus: prevState.tripStatus === 'completed' ? 'completed' : tripStatus,
  stepIdx: data.stepIdx || 0,
  totalSteps: data.totalSteps || 0,
  distToDest: data.distToDest || 0,
  timestamp: Date.now(),
};

unitTripState.set(key, {
  ...prevState,
  ...point,
  trail: [...(prevState.trail || []).slice(-149), point],
});

          ambulanceLocation = { ...point, trail: [...ambulanceLocation.trail.slice(-149), point] };

          // Publish response to NATS (which gets written to Redis by bridge)
          nc.publish('gps.stream.res', sc.encode(JSON.stringify({
            unit_id: unitId,
            ticket_no: ticketNo,
            ...point
          })));

        } catch (e) {
          console.error('❌ Error processing gps.stream.req:', e.message);
        }
      }
    })().then();

    // 🌟 THE GATEWAY FIX: Listen for system alerts from Webhook Engine
    const systemSub = nc.subscribe('webhook.gps.system_alert');
    (async () => {
      for await (const msg of systemSub) {
        try {
          const data = JSON.parse(sc.decode(msg.data));
          if (data.alert_type === 'dispatch' || data.alert_type === 'assignment') {
            const { unit_id, ticket_data } = data;
            const targetUnit = unit_id || ticket_data?.unitId || 'matrixuser';

            console.log(`📡 [NATS DISPATCH] Received from Webhook for Unit: ${targetUnit}`);

            // 1. Sync internal state (Memory)
            if (!units.has(targetUnit)) {
              units.set(targetUnit, { id: targetUnit, name: targetUnit, status: 'online', type: ticket_data?.vehicleType || 'ambulance', lastSeen: Date.now() });
            }
            const unit = units.get(targetUnit);

            const alertId = ticket_data.id || uuidv4();
            const alertObj = {
              ...ticket_data,
              id: alertId,
              status: 'pending',
              assignedAt: Date.now(),
              unitId: targetUnit,
              unitName: unit.name
            };

            assignments.set(targetUnit, alertObj);
            incidents.set(alertId, alertObj);
            unit.status = 'busy';
            unit.assignedIncidentId = alertId;
            const key = `${alertId}:${targetUnit}`;
unitTripState.set(key, makeFreshTripState({ tripStatus: 'dispatched' }));

            // 2. Persistent Storage (MySQL)
            try {
              // We attempt a generic insert into an incidents table
              await db.query(
                'INSERT INTO incidents (id, agent_ticket_id, patient_name, address, status, unit_id) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status=VALUES(status)',
                [alertId, ticket_data.agentTicketId || '', ticket_data.patientName || '', ticket_data.address || '', 'pending', targetUnit]
              ).catch(e => console.warn('DB Sync Warning:', e.message));
            } catch (dbErr) {
              console.warn('⚠️ MySQL Alert Save Failed:', dbErr.message);
            }

            // 3. Publish back to NATS Unit Inbox for the Webhook Bridge to pick up
            const inboxSubject = `unit.inbox.${targetUnit}`;
            nc.publish(inboxSubject, sc.encode(JSON.stringify({
              type: 'NEW_ALERT',
              alert: alertObj,
              timestamp: Date.now()
            })));

            console.log(`✅ [NATS DISPATCH] Successfully handled and routed to ${inboxSubject}`);
          }
        } catch (err) {
          console.error('❌ Error in system_alert NATS handler:', err.message);
        }
      }
    })();

    // 🔍 SYSTEM QUERY RESPONDER: Answer questions from the Webhook Engine
    const querySub = nc.subscribe('system.query.>');
    (async () => {
      for await (const msg of querySub) {
        try {
          const data = JSON.parse(sc.decode(msg.data));
          const { replyTo } = data;
          if (!replyTo) continue;

          if (msg.subject.endsWith('.getUnits')) {
            console.log(`🙋 [NATS QUERY] Providing Unit List to ${replyTo}`);
            const now = Date.now();
            const list = Array.from(units.values()).map(u => ({
              ...u,
              isOnline: now - u.lastSeen < HEARTBEAT_TIMEOUT_MS,
              secondsAgo: Math.floor((now - u.lastSeen) / 1000),
              distanceM: null,
            }));
            nc.publish(replyTo, sc.encode(JSON.stringify({ success: true, data: list, total: list.length })));
          } else if (msg.subject.endsWith('.getStatus')) {
            console.log(`🙋 [NATS QUERY] Providing System Status to ${replyTo}`);
            nc.publish(replyTo, sc.encode(JSON.stringify({ alert: currentAlert })));
          } else if (msg.subject.endsWith('.getNearestUnits')) {
            console.log(`🙋 [NATS QUERY] Providing Nearest Units to ${replyTo}`);
            // Simple filter for nearest (re-implementing the REST logic)
            const { lat, lng, type } = data.params || {};
            const unitsArray = Array.from(units.values())
              .filter(u => u.status !== 'offline')
              .filter(u => !type || u.type === type)
              .map(u => ({
                ...u,
                distance: Math.sqrt(Math.pow((u.location?.latitude || 0) - lat, 2) + Math.pow((u.location?.longitude || 0) - lng, 2))
              }))
              .sort((a, b) => a.distance - b.distance)
              .slice(0, 10);
            nc.publish(replyTo, sc.encode(JSON.stringify({ success: true, data: unitsArray })));
          } else if (data.alert_type === 'registration') {
            handleRegister({ body: data.unit_data }, { json: (r) => console.log('✅ NATS Registration Done') });
          } else if (data.alert_type === 'location_update') {
            handleLocationUpdate({ body: data.unit_data }, { json: (r) => { } });
          }
        } catch (err) {
          console.error('❌ Error handling NATS query:', err.message);
        }
      }
    })();

  } catch (err) {
    console.warn('⚠️  NATS connection failed:', err.message);
  }
})();

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function makeFreshTripState(overrides = {}) {
  return { latitude: null, longitude: null, heading: 0, speed: 0, remainingDistM: 0, remainingTimeS: 0, tripStatus: 'dispatched', stepIdx: 0, totalSteps: 0, distToDest: 0, timestamp: null, trail: [], ...overrides };
}

// NEW HELPER - finds the correct folder name
function tripKey(unitId, ticketNo) {
  if (ticketNo) return `${ticketNo}:${unitId}`;
  // If no ticketNo given, search existing folders
  for (const k of unitTripState.keys()) {
    if (k === unitId || k.endsWith(`:${unitId}`)) return k;
  }
  return unitId; // last resort fallback
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
      const state = c.find(x => x.types.includes('administrative_area_level_1'))?.long_name;
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
  const unit = units.get(unitId);
  const unit_status = unit?.assignedIncidentId ? 'busy' : 'available';
  const isOnline = unit ? (Date.now() - unit.lastSeen < HEARTBEAT_TIMEOUT_MS) : false;
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
  const unitId = req.body.unitId || req.body.ambulanceId;
  const name = req.body.name;
  const type = req.body.type || 'ambulance';
  const pushToken = req.body.pushToken || null;
  if (!unitId || !name) return res.status(400).json({ error: 'unitId and name required' });

  const existing = units.get(unitId);

  const unit = {
    id: unitId,
    name,
    type,
    status: existing?.status === 'busy' ? 'busy' : 'available',
    lastSeen: Date.now(),
    registeredAt: existing?.registeredAt || Date.now(),
    pushToken: pushToken || existing?.pushToken || null,
    assignedIncidentId: existing?.assignedIncidentId || null,
    location: existing?.location || null,
    _needsOnlineInsert: true,  // heartbeat will write the 'online' DB row with real coords
  };

  units.set(unitId, unit);
  if (pushToken) pushTokens.add(pushToken);
  if (!unitTripState.has(unitId)) unitTripState.set(unitId, makeFreshTripState({ tripStatus: 'idle' }));
  console.log(`✅ Unit registered: ${name} (${unitId}) — waiting for first heartbeat to record online event`);

  res.json({ success: true, unit });
}
app.post('/register-unit', handleRegister);
app.post('/register-ambulance', handleRegister);

// ══════════════════════════════════════════════════════════════════════════════
// HEARTBEAT — keep-alive ONLY. Updates lastSeen + in-memory location.
// ONLY inserts to DB when a unit COMES BACK online after being offline.
// Normal heartbeats (unit already online) → NO database insert.
// ══════════════════════════════════════════════════════════════════════════════
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
  const spd = parseFloat(req.body.speed) >= 0 ? parseFloat(req.body.speed) : 0;
  const hdg = parseFloat(req.body.heading) >= 0 ? parseFloat(req.body.heading) : 0;
  const hasCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

  if (hasCoords) {
    unit.location = { latitude: lat, longitude: lng, heading: hdg, speed: spd, updatedAt: Date.now() };
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
  const ticketNo = req.body.ticketNo || req.body.ticket_no || null;
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
  const key = tripKey(unitId, ticketNo);
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
    unitTripState.set(key, { // USE key NOT unitId
      ...point,
      trail: [...(prevState.trail || []).slice(-149), point],
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
// REPLACE WITH:
app.get('/unit-location/:unitId', (req, res) => {
  const uid = req.params.unitId;
  const ticketNo = req.query.ticket_no || null; // read ticket from URL
  const unit = units.get(uid);

  const key = tripKey(uid, ticketNo); // USE CORRECT FOLDER NAME
  const tripState = unitTripState.get(key) || makeFreshTripState({ tripStatus: 'idle' });
  
  console.log(`📖 Reading key="${key}" → tripStatus="${tripState.tripStatus}"`);
  if (!unit) {
    // Return 200 with idle state for units not yet heartbeated (prevents red 404 console errors)
    return res.json({
      ...tripState,
      unitId: req.params.unitId,
      name: 'Unknown Unit',
      status: 'offline',
      tripStatus: 'idle'
    });
  }

  // Get this unit's own trip state (never shared with other units)
  // Prefilled above from actual store or fresh idle state

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
        : (tripState.tripStatus || 'idle'),
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
    agentTicketId: req.body.agentTicketId || '',
    roomId: req.body.roomId || '',   // ← ADD THIS
    matrixRoomId: req.body.matrixRoomId || '',   // ← ADD THIS
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

  // Publish to NATS unit inbox so the webhook app's bridge writes it to Redis.
  // This covers the case where the dispatch came in via direct HTTP to /assign
  // rather than through the NATS system_alert path.
  if (nc) {
    try {
      nc.publish(`unit.inbox.${id}`, sc.encode(JSON.stringify({
        type: 'NEW_ALERT', alert: alertData, timestamp: Date.now()
      })));
      console.log(`📨 [NATS] Published unit.inbox.${id}`);
    } catch (natsErr) {
      console.warn('⚠️  NATS unit.inbox publish failed:', natsErr.message);
    }
  }

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
    agentTicketId: req.body.agentTicketId || '',
    roomId: req.body.roomId || '',   // ← ADD THIS
    matrixRoomId: req.body.matrixRoomId || '',   // ← ADD THIS
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
  const unit = units.get(unitId); if (unit) unit.lastSeen = Date.now();
  res.json({ alert: assignments.get(unitId) || { id: null, status: 'waiting' } });
});

app.get('/status', (req, res) => res.json({ alert: currentAlert }));

app.post('/accept-assignment', (req, res) => {  
  const unitId = req.body.unitId || req.body.ambulanceId, assign = assignments.get(unitId);
  if (!assign) return res.status(400).json({ error: 'No assignment' });
  if (assign.status === 'accepted') return res.status(400).json({ error: 'Already taken by another unit' });
 assign.status = 'accepted'; 
currentAlert.status = 'accepted';

// Remove this alert from ALL other units so they don't show it
for (const [id, a] of assignments.entries()) { 
  if (a.id === assign.id && id !== unitId) {
    assignments.delete(id);
    console.log(`🚫 Removed assignment from unit ${id} — accepted by ${unitId}`);
  }
}
// Publish cancellation to all other unit inboxes via NATS
if (nc) {
  for (const [id] of units.entries()) {
    if (id !== unitId) {
      try {
        nc.publish(`unit.inbox.${id}`, sc.encode(JSON.stringify({
          type: 'ALERT_CANCELLED',
          alertId: assign.id,
          agentTicketId: assign.agentTicketId,
          reason: 'accepted_by_other_unit',
          timestamp: Date.now()
        })));
      } catch {}
    }
  }
}

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
// REPLACE WITH (fixed code):
app.post('/update-dispatch-status', async (req, res) => {
  const allowed = ['dispatched', 'accepted', 'en_route', 'on_action', 'arrived', 'completed', 'abandoned', 'idle'];
  const { tripStatus, unitId, ambulanceId, ticketNo } = req.body; // added ticketNo
  if (!allowed.includes(tripStatus)) return res.status(400).json({ error: `Invalid: ${tripStatus}` });
  const uid = unitId || ambulanceId;
  if (!uid) return res.status(400).json({ error: 'unitId is required' });

  const key = tripKey(uid, ticketNo); // USE CORRECT FOLDER NAME
  if (!unitTripState.has(key)) unitTripState.set(key, makeFreshTripState());
  const prev = unitTripState.get(key);

  // SAFETY: never go back from completed
  if (prev.tripStatus === 'completed') {
    console.log(`🔒 ${uid} already completed — ignoring ${tripStatus}`);
    return res.json({ success: true, unitId: uid, tripStatus: 'completed' });
  }

  unitTripState.set(key, { ...prev, tripStatus, timestamp: Date.now() });
  console.log(`✅ ${uid} → ${tripStatus} (key=${key})`);

  if (prev.latitude && prev.longitude) {
    trackInsert({ unitId: uid, latitude: prev.latitude, longitude: prev.longitude, speed: prev.speed || 0, tripStatus }).catch(() => { });
  }

  const assignedUnits = Array.from(assignments.keys());
  if (assignedUnits.length > 0 && assignedUnits.every(id => unitTripState.get(id)?.tripStatus === 'completed')) {
    console.log('🎉 All units completed → Ticket completed'); currentAlert.status = 'completed';
  }
  ambulanceLocation.tripStatus = tripStatus;
  res.json({ success: true, unitId: uid, tripStatus });
});

// ═══════════════════════════════════════════════════════════════
// ROUTE REPLAY API (for RouteReplayPage)
// ═══════════════════════════════════════════════════════════════
app.get('/api/unit-locations/replay', async (req, res) => {
  try {
    const ticketNo = req.query.ticket_no;

    if (!ticketNo) {
      return res.status(400).json({ error: 'ticket_no is required' });
    }

    console.log("🎥 REPLAY API called for ticket:", ticketNo);

    const { rows } = await pgPool.query(
      `SELECT 
         timestamp,
         unit_id,
         latitude,
         longitude,
         speed,
         trip_status,
         location_info,
         remarks
       FROM public.unit_locations
       WHERE ticket_no = $1
       ORDER BY "timestamp" ASC`,
      [ticketNo]
    );

    console.log("📦 REPLAY rows fetched:", rows);

    res.json({
      success: true,
      rows: rows
    });

  } catch (err) {
    console.error("❌ Replay API error:", err.message);
    res.status(500).json({ error: err.message });
  }
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