-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: public.tickets
-- One row per active ticket created by an agent.
-- Idempotent: safe to run repeatedly (uses CREATE ... IF NOT EXISTS).
-- Run:
--   psql -h <host> -U <user> -d <db> -f server/sql/004_tickets.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tickets (
    ticket_id       TEXT           PRIMARY KEY,            -- TICKET-<epoch>-<5char>
    ani             TEXT,                                  -- caller phone / auto-number-identify
    ticket_details  JSONB,                                 -- patient name, address, lat/lng, type, etc.
    ticket_status   TEXT           NOT NULL DEFAULT 'pending', -- pending | dispatched | completed | closed
    priority        TEXT,                                  -- low | medium | high | critical
    agent_name      TEXT,
    dispatcher_id   TEXT,
    dispatcher_name TEXT,
    units           JSONB,                                 -- array of assigned unit IDs / objects
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    remarks         TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_ticket_status
    ON public.tickets (ticket_status);

CREATE INDEX IF NOT EXISTS idx_tickets_agent_name
    ON public.tickets (agent_name);

CREATE INDEX IF NOT EXISTS idx_tickets_dispatcher_id
    ON public.tickets (dispatcher_id);

CREATE INDEX IF NOT EXISTS idx_tickets_created_at
    ON public.tickets (created_at DESC);
