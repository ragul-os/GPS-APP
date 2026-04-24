-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: public.ticket_events
-- Append-only event log for every ticket lifecycle change. Nothing is ever
-- updated or deleted. Current state is reconstructed by folding all rows for a
-- ticket_id in timestamp ascending order.
--
-- Event taxonomy:
--   event        : CREATED | UPDATED_INFO | ASSIGNED_DISPATCHER | ASSIGNED_UNITS |
--                  ACKNOWLEDGED | REJECTED | ENROUTE | ARRIVED | ON_ACTION |
--                  COMPLETED | CLOSED
--   event_type   : ENTRY | UPDATE | PROGRESS | EXIT
--   ticket_status: Stage 1 | Stage 2 | Stage 3 | Stage 4  (derived server-side)
--
-- NOTE: This migration DROPs the previous ticket_events table and rebuilds it
-- with the new schema. Safe only while the table is empty.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop old table only when it still has the legacy schema (column `created_at`
-- exists but new column `event` does not). On subsequent boots this is a no-op.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'ticket_events'
           AND column_name  = 'created_at'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'ticket_events'
           AND column_name  = 'event'
    ) THEN
        EXECUTE 'DROP TABLE public.ticket_events CASCADE';
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.ticket_events (
    id              BIGSERIAL      PRIMARY KEY,
    timestamp       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    -- Ticket identity
    ticket_id       TEXT           NOT NULL,

    -- What happened
    event           TEXT           NOT NULL,
    event_type      TEXT           NOT NULL,

    -- Who triggered the event
    source_id       TEXT,
    source_name     TEXT,

    -- Core data (JSON, event-dependent shape)
    ticket_details  JSONB,
    ticket_status   TEXT           NOT NULL,           -- Stage 1..4
    priority        TEXT,
    team_details    JSONB,
    room_details    JSONB,

    -- Free-form remark (plain text)
    remarks         TEXT
);

CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_id_timestamp
    ON public.ticket_events (ticket_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_ticket_events_timestamp
    ON public.ticket_events (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_events_event
    ON public.ticket_events (event);

CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_status
    ON public.ticket_events (ticket_status);
