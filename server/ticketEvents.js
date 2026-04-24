// ─────────────────────────────────────────────────────────────────────────────
// Ticket Events (additive module) — NATS-only transport
// register(app, { pgPool, getNc, sc }) subscribes on:
//   • ticket.events.inbox.create        (CREATED)
//   • ticket.events.inbox.update-info   (UPDATED_INFO)
//   • ticket.events.inbox.dispatch      (ASSIGNED_DISPATCHER + ASSIGNED_UNITS)
//   • ticket.events.inbox.unit          (ACKNOWLEDGED/REJECTED/ENROUTE/ARRIVED/
//                                        ON_ACTION/COMPLETED)
//   • ticket.events.inbox.close         (CLOSED)
//   • ticket.events.query.get
//   • ticket.events.query.list
// Fanout (no reply) on:
//   • ticket.events.out.created
//   • ticket.events.out.dispatched
//   • ticket.events.out.unit.{unitId}
//   • ticket.events.out.progress.{ticketId}
// Writes only to public.ticket_events. `app` parameter kept for signature
// compatibility with server.js but no HTTP routes are mounted.
// ─────────────────────────────────────────────────────────────────────────────

// Event → event_type. ticket_status (Stage 1..4) is derived from the full
// event history at insert time; see deriveStage() below.
const EVENT_TYPE = {
  CREATED: 'ENTRY',
  UPDATED_INFO: 'UPDATE',
  ASSIGNED_DISPATCHER: 'UPDATE',
  ASSIGNED_UNITS: 'UPDATE',
  ACKNOWLEDGED: 'PROGRESS',
  REJECTED: 'PROGRESS',
  ENROUTE: 'PROGRESS',
  ARRIVED: 'PROGRESS',
  ON_ACTION: 'PROGRESS',
  COMPLETED: 'PROGRESS',
  CLOSED: 'EXIT',
};
const UNIT_EVENTS = [
  'ACKNOWLEDGED',
  'REJECTED',
  'ENROUTE',
  'ARRIVED',
  'ON_ACTION',
  'COMPLETED',
];
const UNIT_TYPES = ['ambulance', 'fire', 'police', 'rescue', 'hazmat'];

function deriveStage(priorEvents, newEvent) {
  if (newEvent === 'CLOSED') return 'Stage 4';
  const all = priorEvents.concat([newEvent]);
  if (all.some((e) => EVENT_TYPE[e] === 'PROGRESS')) return 'Stage 3';
  if (all.some((e) => e === 'ASSIGNED_DISPATCHER' || e === 'ASSIGNED_UNITS'))
    return 'Stage 2';
  return 'Stage 1';
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function validateAgentPayload(body) {
  const { ticket_id, ticket_details } = body;
  if (!ticket_id || typeof ticket_id !== 'string')
    return 'ticket_id (string) required';
  if (!ticket_details || typeof ticket_details !== 'object')
    return 'ticket_details (object) required';
  const {
    unit_type,
    priority,
    patient_name,
    phone_number,
    latitude,
    longitude,
  } = ticket_details;
  if (!UNIT_TYPES.includes(unit_type))
    return `ticket_details.unit_type must be one of ${UNIT_TYPES.join(', ')}`;
  if (!priority) return 'ticket_details.priority required';
  if (!patient_name) return 'ticket_details.patient_name required';
  if (!phone_number) return 'ticket_details.phone_number required';
  if (!isNumber(latitude) || !isNumber(longitude))
    return 'ticket_details.latitude and ticket_details.longitude (numbers) required';
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

function validateUnitPayload(body, currentUnitIds) {
  const { event } = body;
  if (!event || !UNIT_EVENTS.includes(event))
    return `event must be one of ${UNIT_EVENTS.join(', ')}`;
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
  function publishSubject(subject, payload) {
    const nc = typeof getNc === 'function' ? getNc() : null;
    if (!nc) return;
    try {
      nc.publish(subject, sc.encode(JSON.stringify(payload)));
    } catch (e) {
      console.warn('[ticket-events] NATS publish failed:', e.message);
    }
  }

  function natsReply(replyTo, payload) {
    if (!replyTo) return;
    publishSubject(replyTo, payload);
  }

  async function fetchEvents(ticketId) {
    const { rows } = await pgPool.query(
      `SELECT id, timestamp, ticket_id, event, event_type, source_id, source_name,
              ticket_details, ticket_status, priority, team_details, room_details, remarks
         FROM public.ticket_events
        WHERE ticket_id = $1
        ORDER BY timestamp ASC, id ASC`,
      [ticketId],
    );
    return rows;
  }

  // Fold the event log into a single view of the ticket: merged ticket_details,
  // current assigned unit set, cumulative team, and the raw event sequence used
  // by handlers for idempotency checks and stage derivation.
  function reconstruct(rows) {
    if (!rows || rows.length === 0) return null;
    const state = {
      ticket_id: rows[0].ticket_id,
      ticket_status: null,
      ticket_details: null,
      priority: null,
      team: {},
      unit_ids: [],
      room_details: null,
      events: [],
      closed: false,
      created_at: rows[0].timestamp,
      updated_at: rows[rows.length - 1].timestamp,
      events_count: rows.length,
      source_history: [],
    };
    for (const r of rows) {
      state.ticket_status = r.ticket_status;
      if (r.ticket_details != null)
        state.ticket_details = {
          ...(state.ticket_details || {}),
          ...r.ticket_details,
        };
      if (r.priority) state.priority = r.priority;
      if (r.room_details != null) state.room_details = r.room_details;
      state.events.push(r.event);
      if (r.event === 'CREATED' || r.event === 'UPDATED_INFO') {
        if (r.source_id) state.team.agent = r.source_id;
      } else if (r.event === 'ASSIGNED_DISPATCHER') {
        if (r.source_id) state.team.dispatcher = r.source_id;
      } else if (r.event === 'ASSIGNED_UNITS') {
        const td = r.team_details || {};
        const units = {};
        const unitIds = [];
        for (const k of Object.keys(td)) {
          if (k.indexOf('unit_') === 0) {
            const id = k.substring('unit_'.length);
            units[id] = td[k];
            unitIds.push(id);
          }
        }
        state.team.units = units;
        state.unit_ids = unitIds;
      } else if (r.event === 'CLOSED') {
        state.closed = true;
      }
      state.source_history.push({
        at: r.timestamp,
        event: r.event,
        event_type: r.event_type,
        source_id: r.source_id,
        source_name: r.source_name,
        ticket_status: r.ticket_status,
      });
    }
    return state;
  }

  async function insertEvent(row) {
    const { rows } = await pgPool.query(
      `INSERT INTO public.ticket_events
         (ticket_id, event, event_type, source_id, source_name,
          ticket_details, ticket_status, priority, team_details, room_details, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, timestamp`,
      [
        row.ticket_id,
        row.event,
        row.event_type,
        row.source_id || null,
        row.source_name || null,
        row.ticket_details != null ? JSON.stringify(row.ticket_details) : null,
        row.ticket_status,
        row.priority || null,
        row.team_details != null ? JSON.stringify(row.team_details) : null,
        row.room_details != null ? JSON.stringify(row.room_details) : null,
        row.remarks || null,
      ],
    );
    return rows[0];
  }

  // ── Handlers (invoked by NATS subscribers below) ──────────────────────────

  // Agent — create ticket (CREATED, Stage 1)
  async function handleCreate(data) {
    const replyTo = data && data.replyTo;
    const body = (data && data.body) || {};
    const msg = validateAgentPayload(body);
    if (msg)
      return natsReply(replyTo, { success: false, code: 400, error: msg });
    const existing = await fetchEvents(body.ticket_id);
    if (existing.length > 0)
      return natsReply(replyTo, {
        success: false,
        code: 409,
        error: 'ticket already exists',
      });
    const agent = body.source_id || 'agent';
    const inserted = await insertEvent({
      ticket_id: body.ticket_id,
      event: 'CREATED',
      event_type: 'ENTRY',
      source_id: body.source_id || null,
      source_name: body.source_name || null,
      ticket_details: body.ticket_details,
      ticket_status: 'Stage 1',
      priority: body.ticket_details.priority || null,
      team_details: { agent },
      remarks: body.remarks || null,
    });
    publishSubject('ticket.events.out.created', {
      ticket_id: body.ticket_id,
      at: inserted.timestamp,
      ticket_details: body.ticket_details,
      source_id: body.source_id,
      source_name: body.source_name,
    });
    natsReply(replyTo, {
      success: true,
      id: inserted.id,
      timestamp: inserted.timestamp,
    });
  }

  // Agent — patch ticket info (UPDATED_INFO, stage unchanged)
  async function handleUpdateInfo(data) {
    const replyTo = data && data.replyTo;
    const ticketId = data && data.ticketId;
    const body = (data && data.body) || {};
    if (!ticketId)
      return natsReply(replyTo, {
        success: false,
        code: 400,
        error: 'ticketId required',
      });
    if (!body.ticket_details || typeof body.ticket_details !== 'object')
      return natsReply(replyTo, {
        success: false,
        code: 400,
        error: 'ticket_details (object) required',
      });
    const rows = await fetchEvents(ticketId);
    if (rows.length === 0)
      return natsReply(replyTo, {
        success: false,
        code: 404,
        error: 'ticket not found',
      });
    const state = reconstruct(rows);
    if (state.closed)
      return natsReply(replyTo, {
        success: false,
        code: 409,
        error: 'ticket already closed',
      });
    const agent = body.source_id || state.team.agent || 'agent';
    const inserted = await insertEvent({
      ticket_id: ticketId,
      event: 'UPDATED_INFO',
      event_type: 'UPDATE',
      source_id: body.source_id || state.team.agent || null,
      source_name: body.source_name || null,
      ticket_details: body.ticket_details,
      ticket_status: deriveStage(state.events, 'UPDATED_INFO'),
      priority: body.ticket_details.priority || state.priority || null,
      team_details: { agent },
      remarks: body.remarks || null,
    });
    publishSubject(`ticket.events.out.progress.${ticketId}`, {
      ticket_id: ticketId,
      event: 'UPDATED_INFO',
      at: inserted.timestamp,
    });
    natsReply(replyTo, {
      success: true,
      id: inserted.id,
      timestamp: inserted.timestamp,
    });
  }

  // Dispatcher — auto-insert ASSIGNED_DISPATCHER (idempotent) then ASSIGNED_UNITS
  async function handleDispatch(data) {
    const replyTo = data && data.replyTo;
    const ticketId = data && data.ticketId;
    const body = (data && data.body) || {};
    if (!ticketId)
      return natsReply(replyTo, {
        success: false,
        code: 400,
        error: 'ticketId required',
      });
    const msg = validateDispatcherPayload(body);
    if (msg)
      return natsReply(replyTo, { success: false, code: 400, error: msg });
    const rows = await fetchEvents(ticketId);
    if (rows.length === 0)
      return natsReply(replyTo, {
        success: false,
        code: 404,
        error: 'ticket not found',
      });
    const state = reconstruct(rows);
    if (state.closed)
      return natsReply(replyTo, {
        success: false,
        code: 409,
        error: 'ticket already closed',
      });
    const priorEvents = state.events.slice();
    const dispatcherId = body.source_id || 'dispatcher';
    const dispatcherName = body.source_name || dispatcherId;
    const agent = state.team.agent || 'agent';

    if (!priorEvents.includes('ASSIGNED_DISPATCHER')) {
      const insDisp = await insertEvent({
        ticket_id: ticketId,
        event: 'ASSIGNED_DISPATCHER',
        event_type: 'UPDATE',
        source_id: dispatcherId,
        source_name: dispatcherName,
        ticket_status: deriveStage(priorEvents, 'ASSIGNED_DISPATCHER'),
        priority: state.priority,
        team_details: { agent, dispatcher: dispatcherId },
      });
      priorEvents.push('ASSIGNED_DISPATCHER');
      publishSubject(`ticket.events.out.progress.${ticketId}`, {
        ticket_id: ticketId,
        event: 'ASSIGNED_DISPATCHER',
        at: insDisp.timestamp,
      });
    }

    const teamUnits = {};
    for (let i = 0; i < body.unit_id.length; i++) {
      const uid = body.unit_id[i];
      const detail = body.unit_details[i] || {};
      teamUnits[`unit_${uid}`] = detail.name || detail.unit_name || uid;
    }
    const inserted = await insertEvent({
      ticket_id: ticketId,
      event: 'ASSIGNED_UNITS',
      event_type: 'UPDATE',
      source_id: dispatcherId,
      source_name: dispatcherName,
      ticket_status: deriveStage(priorEvents, 'ASSIGNED_UNITS'),
      priority: state.priority,
      team_details: teamUnits,
      room_details: body.room_details || null,
    });
    for (const uid of body.unit_id) {
      publishSubject(`ticket.events.out.unit.${uid}`, {
        type: 'TICKET_DISPATCHED',
        ticket_id: ticketId,
        unit_id: uid,
        ticket_details: state.ticket_details,
        room_details: body.room_details || null,
        dispatched_at: inserted.timestamp,
      });
    }
    publishSubject('ticket.events.out.dispatched', {
      ticket_id: ticketId,
      unit_id: body.unit_id,
      at: inserted.timestamp,
    });
    natsReply(replyTo, {
      success: true,
      id: inserted.id,
      timestamp: inserted.timestamp,
    });
  }

  // Unit — ACKNOWLEDGED/REJECTED/ENROUTE/ARRIVED/ON_ACTION/COMPLETED (PROGRESS)
  async function handleUnit(data) {
    const replyTo = data && data.replyTo;
    const ticketId = data && data.ticketId;
    const body = (data && data.body) || {};
    if (!ticketId)
      return natsReply(replyTo, {
        success: false,
        code: 400,
        error: 'ticketId required',
      });
    const rows = await fetchEvents(ticketId);
    if (rows.length === 0)
      return natsReply(replyTo, {
        success: false,
        code: 404,
        error: 'ticket not found',
      });
    const state = reconstruct(rows);
    if (state.closed)
      return natsReply(replyTo, {
        success: false,
        code: 409,
        error: 'ticket already closed',
      });
    const msg = validateUnitPayload(body, state.unit_ids);
    if (msg)
      return natsReply(replyTo, { success: false, code: 400, error: msg });
    const inserted = await insertEvent({
      ticket_id: ticketId,
      event: body.event,
      event_type: 'PROGRESS',
      source_id: body.source_id || null,
      source_name: body.source_name || null,
      ticket_status: deriveStage(state.events, body.event),
      priority: state.priority,
      remarks: body.remarks || null,
    });
    publishSubject(`ticket.events.out.progress.${ticketId}`, {
      ticket_id: ticketId,
      event: body.event,
      source_id: body.source_id,
      source_name: body.source_name,
      at: inserted.timestamp,
    });
    natsReply(replyTo, {
      success: true,
      id: inserted.id,
      timestamp: inserted.timestamp,
    });
  }

  // Dispatcher — CLOSED (Stage 4)
  async function handleClose(data) {
    const replyTo = data && data.replyTo;
    const ticketId = data && data.ticketId;
    const body = (data && data.body) || {};
    if (!ticketId)
      return natsReply(replyTo, {
        success: false,
        code: 400,
        error: 'ticketId required',
      });
    const rows = await fetchEvents(ticketId);
    if (rows.length === 0)
      return natsReply(replyTo, {
        success: false,
        code: 404,
        error: 'ticket not found',
      });
    const state = reconstruct(rows);
    if (state.closed)
      return natsReply(replyTo, {
        success: false,
        code: 409,
        error: 'ticket already closed',
      });
    const inserted = await insertEvent({
      ticket_id: ticketId,
      event: 'CLOSED',
      event_type: 'EXIT',
      source_id: body.source_id || 'dispatcher',
      source_name: body.source_name || body.source_id || 'dispatcher',
      ticket_status: 'Stage 4',
      priority: state.priority,
      remarks: body.remarks || null,
    });
    publishSubject(`ticket.events.out.progress.${ticketId}`, {
      ticket_id: ticketId,
      event: 'CLOSED',
      at: inserted.timestamp,
    });
    natsReply(replyTo, {
      success: true,
      id: inserted.id,
      timestamp: inserted.timestamp,
    });
  }

  // Query — reconstructed state + raw event history for one ticket
  async function handleGet(data) {
    const replyTo = data && data.replyTo;
    const ticketId = data && data.ticketId;
    if (!ticketId)
      return natsReply(replyTo, {
        success: false,
        code: 400,
        error: 'ticketId required',
      });
    const rows = await fetchEvents(ticketId);
    if (rows.length === 0)
      return natsReply(replyTo, {
        success: false,
        code: 404,
        error: 'ticket not found',
      });
    const state = reconstruct(rows);
    natsReply(replyTo, { success: true, state, events: rows });
  }

  // Query — list latest row per ticket (optional query.status = 'Stage N' filter)
  async function handleList(data) {
    const replyTo = data && data.replyTo;
    const query = (data && data.query) || {};
    const params = [];
    let where = '';
    if (query.status) {
      params.push(query.status);
      where = `WHERE ticket_status = $1`;
    }
    const sql = `
      SELECT DISTINCT ON (ticket_id)
             ticket_id, timestamp, event, event_type, ticket_status,
             ticket_details, priority, team_details, room_details
        FROM public.ticket_events
        ${where}
        ORDER BY ticket_id, timestamp DESC, id DESC`;
    const { rows } = await pgPool.query(sql, params);
    natsReply(replyTo, { success: true, tickets: rows, total: rows.length });
  }

  // ── NATS subscription wiring ──────────────────────────────────────────────
  // Subjects are fixed by contract with the webhook bridge (ticket-events.controller.ts).
  const SUBSCRIPTIONS = [
    {
      subject: 'ticket.events.inbox.create',
      handler: handleCreate,
      tag: 'create',
    },
    {
      subject: 'ticket.events.inbox.update-info',
      handler: handleUpdateInfo,
      tag: 'update-info',
    },
    {
      subject: 'ticket.events.inbox.dispatch',
      handler: handleDispatch,
      tag: 'dispatch',
    },
    { subject: 'ticket.events.inbox.unit', handler: handleUnit, tag: 'unit' },
    {
      subject: 'ticket.events.inbox.close',
      handler: handleClose,
      tag: 'close',
    },
    { subject: 'ticket.events.query.get', handler: handleGet, tag: 'get' },
    { subject: 'ticket.events.query.list', handler: handleList, tag: 'list' },
  ];

  function wireSubscribers(nc) {
    for (const { subject, handler, tag } of SUBSCRIPTIONS) {
      const sub = nc.subscribe(subject);
      (async () => {
        for await (const m of sub) {
          let data = {};
          try {
            data = JSON.parse(sc.decode(m.data));
          } catch (e) {
            console.warn(`[ticket-events][${tag}] bad JSON:`, e.message);
            continue;
          }
          try {
            await handler(data);
          } catch (e) {
            console.error(`[ticket-events][${tag}]`, e.message);
            natsReply(data && data.replyTo, {
              success: false,
              code: 500,
              error: e.message,
            });
          }
        }
      })().catch((e) =>
        console.error(
          `[ticket-events][${tag}] subscription loop ended:`,
          e.message,
        ),
      );
    }
    console.log(
      '🎫 Ticket events NATS subscribers registered → ticket.events.{inbox,query}.*',
    );
  }

  // nc may not be ready at register() time (NATS connects asynchronously),
  // so poll until it is available, then wire subscribers exactly once.
  let wired = false;
  const pollMs = 500;
  const poll = setInterval(() => {
    if (wired) return;
    const nc = typeof getNc === 'function' ? getNc() : null;
    if (!nc) return;
    wired = true;
    clearInterval(poll);
    try {
      wireSubscribers(nc);
    } catch (e) {
      console.error('[ticket-events] failed to wire subscribers:', e.message);
    }
  }, pollMs);
}

module.exports = { register };
