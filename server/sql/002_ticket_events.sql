-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: public.ticket_events
-- Append-only event log for every ticket lifecycle change. Nothing is ever
-- updated or deleted. Current state is reconstructed by folding all rows for a
-- ticket_id in created_at ascending order.
-- Idempotent: safe to run repeatedly.
-- Run:
--   psql -h <host> -U <user> -d <db> -f server/sql/002_ticket_events.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ticket_events (
    id              BIGSERIAL      PRIMARY KEY,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    -- Ticket identity
    ticket_id       TEXT           NOT NULL,

    -- Who triggered the event
    event_source    TEXT           NOT NULL,           -- agent | dispatcher | unit
    source_id       TEXT,
    source_name     TEXT,

    -- What happened
    event_type      TEXT           NOT NULL,           -- creation | dispatched | assigned | accepted | en_route | arrived | on_action | completed
    ticket_status   TEXT,                              -- created | on_going | assigned | accepted | en_route | arrived | on_action | completed

    -- Core data (JSON)
    ticket_details  JSONB,
    location        JSONB,

    -- Unit info (multi-unit support)
    unit_id         JSONB,                             -- array of unit ID strings
    unit_details    JSONB,                             -- array of unit detail objects

    -- Room / staging info
    room_details    JSONB,

    -- Free-form extras
    remarks         JSONB          DEFAULT '{}'::jsonb
);

-- Indexes for the common query patterns
-- State reconstruction: WHERE ticket_id = $1 ORDER BY created_at ASC, id ASC
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_id_created_at
    ON public.ticket_events (ticket_id, created_at);

-- Dispatcher dashboards: latest state per ticket
CREATE INDEX IF NOT EXISTS idx_ticket_events_created_at
    ON public.ticket_events (created_at DESC);

-- Filter by role (agent vs dispatcher vs unit events) when auditing
CREATE INDEX IF NOT EXISTS idx_ticket_events_event_source
    ON public.ticket_events (event_source);

-- Filter open/active tickets
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_status
    ON public.ticket_events (ticket_status);
