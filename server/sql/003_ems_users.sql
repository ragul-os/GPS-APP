-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: public.ems_users
-- EMS application user accounts (agents, dispatchers, admins).
-- Uses table name ems_users to avoid conflict with any existing public.users table.
-- Idempotent: safe to run repeatedly (uses CREATE ... IF NOT EXISTS).
-- Run:
--   psql -h <host> -U <user> -d <db> -f server/sql/003_ems_users.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ems_users (
    user_id         BIGSERIAL      PRIMARY KEY,
    user_name       TEXT           NOT NULL UNIQUE,
    password        TEXT           NOT NULL,
    role            TEXT           NOT NULL,               -- agent | dispatcher | admin
    available       TEXT           NOT NULL DEFAULT 'inactive', -- active | inactive
    created_by      TEXT,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    remarks         TEXT
);

CREATE INDEX IF NOT EXISTS idx_ems_users_user_name ON public.ems_users (user_name);
CREATE INDEX IF NOT EXISTS idx_ems_users_role       ON public.ems_users (role);
