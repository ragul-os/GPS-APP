-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: public.unit_locations
-- Append-only location/status log for every unit heartbeat and live trip point.
-- Idempotent: safe to run repeatedly (uses CREATE ... IF NOT EXISTS).
-- Run:
--   psql -h <host> -U <user> -d <db> -f server/sql/001_unit_locations.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.unit_locations (
    id              BIGSERIAL PRIMARY KEY,
    "timestamp"     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    -- Unit identity
    unit_id         TEXT              NOT NULL,
    unit_type       TEXT,                               -- ambulance | fire | police | rescue | hazmat
    user_name       TEXT,

    -- Position (stored as TEXT to match existing production schema)
    latitude        TEXT,
    longitude       TEXT,

    -- Status flags
    unit_status     TEXT,                               -- available | busy
    device_status   TEXT,                               -- online | offline

    -- Trip context
    ticket_no       TEXT,                               -- nullable (null when not on a trip)
    trip_status     TEXT,                               -- dispatched | en_route | arrived | on_action | completed | idle
    speed           TEXT,                               -- stored as TEXT to match existing production schema

    -- Extra data
    location_info   TEXT,                               -- reverse-geocode result / address string or JSON-encoded text
    remarks         TEXT
);

-- Indexes for the common query patterns
CREATE INDEX IF NOT EXISTS idx_unit_locations_ticket_no_ts
    ON public.unit_locations (ticket_no, "timestamp");

CREATE INDEX IF NOT EXISTS idx_unit_locations_unit_id_ts
    ON public.unit_locations (unit_id, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS idx_unit_locations_ts
    ON public.unit_locations ("timestamp" DESC);
