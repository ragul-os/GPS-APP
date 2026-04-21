// ─────────────────────────────────────────────────────────────────────────────
// Ticket Events Routes (additive module)
// Mounted onto the existing Express app in server.js via register(app, deps).
// Reuses the caller's pgPool and NATS client — no separate connections, no
// new port. Writes only to public.ticket_events. Does not touch other routes.
// ─────────────────────────────────────────────────────────────────────────────

const UNIT_TYPES = ['ambulance', 'fire', 'police', 'rescue', 'hazmat'];
const TYPE_SPECIFIC_FIELD = {
  ambulance: 'medical_condition',
  fire: 'fire_type',
  police: 'incident_type',
  rescue: 'rescue_type',
  hazmat: 'hazard_type',
};
const UNIT_FLOW = [
  'assigned',
  'accepted',
  'en_route',
  'arrived',
  'on_action',
  'completed',
];
const UNIT_PREV = {
  assigned: 'on_going',
  accepted: 'assigned',
  en_route: 'accepted',
  arrived: 'en_route',
  on_action: 'arrived',
  completed: 'on_action',
};

const err = (res, code, msg) =>
  res.status(code).json({ success: false, error: msg });
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function validateAgentPayload(body) {
  const { ticket_id, ticket_details, location } = body;
  if (!ticket_id || typeof ticket_id !== 'string')
    return 'ticket_id (string) required';
  if (!ticket_details || typeof ticket_details !== 'object')
    return 'ticket_details (object) required';
  const { unit_type, priority, patient_name, phone_number } = ticket_details;
  if (!UNIT_TYPES.includes(unit_type))
    return `ticket_details.unit_type must be one of ${UNIT_TYPES.join(', ')}`;
  if (!priority) return 'ticket_details.priority required';
  if (!patient_name) return 'ticket_details.patient_name required';
  if (!phone_number) return 'ticket_details.phone_number required';
  const tField = TYPE_SPECIFIC_FIELD[unit_type];
  if (!ticket_details[tField])
    return `ticket_details.${tField} required for unit_type ${unit_type}`;
  if (
    !location ||
    !isNumber(location.latitude) ||
    !isNumber(location.longitude)
  )
    return 'location.latitude and location.longitude (numbers) required';
  if (
    body.unit_id != null ||
    body.unit_details != null ||
    body.room_details != null ||
    body.remarks != null
  )
    return 'unit_id, unit_details, room_details, and remarks must be null at creation';
  return null;
}

function validateDispatcherPayload(body) {
  if (!Array.isArray(body.unit_id) || body.unit_id.length === 0)
    return 'unit_id must be a non-empty array of unit ID strings';
  if (
    !Array.isArray(body.unit_details) ||
    body.unit_details.length !== body.unit_id.length
  )
    return 'unit_details must be an array with the same length as unit_id';
  for (const u of body.unit_details) {
    if (!u || typeof u !== 'object')
      return 'each unit_details entry must be an object';
    if (!u.name && !u.unit_name)
      return 'each unit_details entry needs a name (or unit_name)';
  }
  return null;
}

function validateUnitPayload(body, currentStatus, currentUnitIds) {
  const { event_type, ticket_status } = body;
  if (!event_type || !ticket_status)
    return 'event_type and ticket_status required';
  if (event_type !== ticket_status)
    return 'event_type must equal ticket_status for unit events';
  if (!UNIT_FLOW.includes(event_type))
    return `event_type must be one of ${UNIT_FLOW.join(', ')}`;
  const expected = UNIT_PREV[event_type];
  if (currentStatus !== expected)
    return `cannot transition to ${event_type} from ${currentStatus} (expected ${expected})`;
  if (
    body.source_id &&
    Array.isArray(currentUnitIds) &&
    currentUnitIds.length > 0 &&
    !currentUnitIds.includes(body.source_id)
  )
    return `source_id ${body.source_id} is not assigned to this ticket`;
  return null;
}

function register(app, { pgPool, getNc, sc }) {
  function publish(subject, payload) {
    const nc = typeof getNc === 'function' ? getNc() : null;
    if (!nc) return;
    try {
      nc.publish(subject, sc.encode(JSON.stringify(payload)));
    } catch (e) {
      console.warn('[ticket-events] NATS publish failed:', e.message);
    }
  }

  async function fetchEvents(ticketId) {
    const { rows } = await pgPool.query(
      `SELECT id, created_at, ticket_id, event_source, source_id, source_name,
              event_type, ticket_status, ticket_details, location,
              unit_id, unit_details, room_details, remarks
         FROM public.ticket_events
        WHERE ticket_id = $1
        ORDER BY created_at ASC, id ASC`,
      [ticketId],
    );
    return rows;
  }

  function reconstruct(rows) {
    if (!rows || rows.length === 0) return null;
    const state = {
      ticket_id: rows[0].ticket_id,
      ticket_status: null,
      ticket_details: null,
      location: null,
      unit_id: null,
      unit_details: null,
      room_details: null,
      remarks: null,
      created_at: rows[0].created_at,
      updated_at: rows[rows.length - 1].created_at,
      events_count: rows.length,
      source_history: [],
    };
    for (const r of rows) {
      if (r.ticket_status != null) state.ticket_status = r.ticket_status;
      if (r.ticket_details != null)
        state.ticket_details = {
          ...(state.ticket_details || {}),
          ...r.ticket_details,
        };
      if (r.location != null) state.location = r.location;
      if (r.unit_id != null) state.unit_id = r.unit_id;
      if (r.unit_details != null) state.unit_details = r.unit_details;
      if (r.room_details != null) state.room_details = r.room_details;
      if (r.remarks != null) state.remarks = r.remarks;
      state.source_history.push({
        at: r.created_at,
        source: r.event_source,
        source_id: r.source_id,
        source_name: r.source_name,
        event_type: r.event_type,
        ticket_status: r.ticket_status,
      });
    }
    return state;
  }

  async function insertEvent(row) {
    const { rows } = await pgPool.query(
      `INSERT INTO public.ticket_events
         (ticket_id, event_source, source_id, source_name, event_type, ticket_status,
          ticket_details, location, unit_id, unit_details, room_details, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, created_at`,
      [
        row.ticket_id,
        row.event_source,
        row.source_id || null,
        row.source_name || null,
        row.event_type,
        row.ticket_status || null,
        row.ticket_details != null ? JSON.stringify(row.ticket_details) : null,
        row.location != null ? JSON.stringify(row.location) : null,
        row.unit_id != null ? JSON.stringify(row.unit_id) : null,
        row.unit_details != null ? JSON.stringify(row.unit_details) : null,
        row.room_details != null ? JSON.stringify(row.room_details) : null,
        row.remarks != null ? JSON.stringify(row.remarks) : null,
      ],
    );
    return rows[0];
  }

  // Agent — create ticket (first event)
  app.post('/api/ticket-events/agent/create', async (req, res) => {
    const msg = validateAgentPayload(req.body);
    if (msg) return err(res, 400, msg);
    try {
      const existing = await fetchEvents(req.body.ticket_id);
      if (existing.length > 0) return err(res, 409, 'ticket already exists');
      const inserted = await insertEvent({
        ticket_id: req.body.ticket_id,
        event_source: 'agent',
        source_id: req.body.source_id,
        source_name: req.body.source_name,
        event_type: 'creation',
        ticket_status: 'created',
        ticket_details: req.body.ticket_details,
        location: req.body.location,
      });
      publish('ticket.events.created', {
        ticket_id: req.body.ticket_id,
        created_at: inserted.created_at,
        ticket_details: req.body.ticket_details,
        location: req.body.location,
        source_id: req.body.source_id,
        source_name: req.body.source_name,
      });
      res.json({
        success: true,
        id: inserted.id,
        created_at: inserted.created_at,
      });
    } catch (e) {
      console.error('[ticket-events][agent/create]', e.message);
      err(res, 500, e.message);
    }
  });

  // Dispatcher — assign units to an existing ticket
  app.post('/api/ticket-events/:ticketId/dispatch', async (req, res) => {
    const { ticketId } = req.params;
    const msg = validateDispatcherPayload(req.body);
    if (msg) return err(res, 400, msg);
    try {
      const rows = await fetchEvents(ticketId);
      if (rows.length === 0) return err(res, 404, 'ticket not found');
      const state = reconstruct(rows);
      if (state.ticket_status !== 'created')
        return err(
          res,
          409,
          `ticket is in status '${state.ticket_status}', cannot dispatch`,
        );
      const inserted = await insertEvent({
        ticket_id: ticketId,
        event_source: 'dispatcher',
        source_id: req.body.source_id,
        source_name: req.body.source_name,
        event_type: 'dispatched',
        ticket_status: 'on_going',
        unit_id: req.body.unit_id,
        unit_details: req.body.unit_details,
        room_details: req.body.room_details || null,
      });
      for (const uid of req.body.unit_id) {
        publish(`ticket.events.unit.${uid}`, {
          type: 'TICKET_DISPATCHED',
          ticket_id: ticketId,
          unit_id: uid,
          ticket_details: state.ticket_details,
          location: state.location,
          room_details: req.body.room_details || null,
          dispatched_at: inserted.created_at,
        });
      }
      publish('ticket.events.dispatched', {
        ticket_id: ticketId,
        unit_id: req.body.unit_id,
        at: inserted.created_at,
      });
      res.json({
        success: true,
        id: inserted.id,
        created_at: inserted.created_at,
      });
    } catch (e) {
      console.error('[ticket-events][dispatch]', e.message);
      err(res, 500, e.message);
    }
  });

  // Unit — state progression (assigned → accepted → en_route → arrived → on_action → completed)
  app.post('/api/ticket-events/:ticketId/unit', async (req, res) => {
    const { ticketId } = req.params;
    try {
      const rows = await fetchEvents(ticketId);
      if (rows.length === 0) return err(res, 404, 'ticket not found');
      const state = reconstruct(rows);
      const currentUnitIds = Array.isArray(state.unit_id) ? state.unit_id : [];
      const msg = validateUnitPayload(
        req.body,
        state.ticket_status,
        currentUnitIds,
      );
      if (msg) return err(res, 400, msg);
      const inserted = await insertEvent({
        ticket_id: ticketId,
        event_source: 'unit',
        source_id: req.body.source_id,
        source_name: req.body.source_name,
        event_type: req.body.event_type,
        ticket_status: req.body.ticket_status,
        ticket_details: req.body.ticket_details || null,
        location: req.body.location || null,
        unit_details: req.body.unit_details || null,
        room_details: req.body.room_details || null,
        remarks: req.body.remarks || null,
      });
      publish(`ticket.events.progress.${ticketId}`, {
        ticket_id: ticketId,
        event_type: req.body.event_type,
        ticket_status: req.body.ticket_status,
        source_id: req.body.source_id,
        source_name: req.body.source_name,
        location: req.body.location || null,
        at: inserted.created_at,
      });
      res.json({
        success: true,
        id: inserted.id,
        created_at: inserted.created_at,
      });
    } catch (e) {
      console.error('[ticket-events][unit]', e.message);
      err(res, 500, e.message);
    }
  });

  // GET — reconstructed state + raw event history for one ticket
  app.get('/api/ticket-events/:ticketId', async (req, res) => {
    try {
      const rows = await fetchEvents(req.params.ticketId);
      if (rows.length === 0) return err(res, 404, 'ticket not found');
      const state = reconstruct(rows);
      res.json({ success: true, state, events: rows });
    } catch (e) {
      console.error('[ticket-events][get]', e.message);
      err(res, 500, e.message);
    }
  });

  // GET — list latest state per ticket (optional ?status= filter)
  app.get('/api/ticket-events', async (req, res) => {
    try {
      const { status } = req.query;
      const params = [];
      let where = '';
      if (status) {
        params.push(status);
        where = `WHERE ticket_status = $1`;
      }
      const sql = `
        SELECT DISTINCT ON (ticket_id)
               ticket_id, created_at, event_source, event_type, ticket_status,
               ticket_details, location, unit_id, unit_details, room_details
          FROM public.ticket_events
          ${where}
          ORDER BY ticket_id, created_at DESC, id DESC`;
      const { rows } = await pgPool.query(sql, params);
      res.json({ success: true, tickets: rows, total: rows.length });
    } catch (e) {
      console.error('[ticket-events][list]', e.message);
      err(res, 500, e.message);
    }
  });

  console.log('🎫 Ticket events routes registered → /api/ticket-events/*');
}

module.exports = { register };
