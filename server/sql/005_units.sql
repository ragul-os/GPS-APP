-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: public.units
-- Registered field units (ambulances, fire trucks, police cars, etc.).
-- Idempotent: safe to run repeatedly (uses CREATE ... IF NOT EXISTS).
-- Run:
--   psql -h <host> -U <user> -d <db> -f server/sql/005_units.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.units (
    unit_id         TEXT           PRIMARY KEY,            -- e.g. AMB-N0AIDZ
    user_name       TEXT           NOT NULL UNIQUE,
    password        TEXT           NOT NULL,
    email_id        TEXT,
    contact_number  TEXT,
    unit_type       TEXT           NOT NULL,               -- ambulance | fire | police | rescue | hazmat
    unit_status     TEXT           NOT NULL DEFAULT 'available', -- available | busy | offline
    device_status   TEXT          NOT NULL DEFAULT 'offline',   -- online | offline
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    remarks         TEXT
);

CREATE INDEX IF NOT EXISTS idx_units_unit_type
    ON public.units (unit_type);

CREATE INDEX IF NOT EXISTS idx_units_unit_status
    ON public.units (unit_status);

CREATE INDEX IF NOT EXISTS idx_units_user_name
    ON public.units (user_name);
