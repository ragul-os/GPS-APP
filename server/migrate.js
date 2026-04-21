// ─────────────────────────────────────────────────────────────────────────────
// Database migration runner (additive)
// Runs every .sql file in server/sql/ against PostgreSQL in alphabetical order.
// Each migration file is written to be idempotent (CREATE ... IF NOT EXISTS),
// so it is safe to run on every boot.
//
// Usage:
//   Standalone CLI ─ creates its own connection and exits:
//     node server/migrate.js
//
//   Embedded in an app ─ reuses an existing pool, never calls process.exit:
//     const { runMigrations } = require('./migrate');
//     await runMigrations(pgPool);
//
// Env vars (reuses the same ones server.js reads):
//   POSTGRES_HOST  POSTGRES_PORT  POSTGRES_USER  POSTGRES_PASSWORD  POSTGRES_DB
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

/**
 * Run every .sql file in server/sql/ (alphabetical) against the given pg pool.
 * Never throws on migration failures — returns a summary object instead, so
 * callers embedding this in app startup can log and continue.
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ applied: number, failed: number, files: string[] }>}
 */
async function runMigrations(pool) {
  const sqlDir = path.join(__dirname, 'sql');
  if (!fs.existsSync(sqlDir)) {
    console.warn(`⚠️  [migrations] directory not found: ${sqlDir}`);
    return { applied: 0, failed: 0, files: [] };
  }

  const files = fs
    .readdirSync(sqlDir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('ℹ️  [migrations] no .sql files in server/sql/');
    return { applied: 0, failed: 0, files: [] };
  }

  console.log(`🗃️  [migrations] running ${files.length} file(s)`);
  let applied = 0;
  let failed = 0;
  for (const file of files) {
    const full = path.join(sqlDir, file);
    const sql = fs.readFileSync(full, 'utf8');
    try {
      await pool.query(sql);
      console.log(`   ✅ ${file}`);
      applied++;
    } catch (e) {
      console.error(`   ❌ ${file}: ${e.message}`);
      failed++;
    }
  }
  if (failed === 0) console.log(`🎉 [migrations] all ${applied} applied`);
  else console.log(`⚠️  [migrations] ${failed} of ${applied + failed} failed`);
  return { applied, failed, files };
}

module.exports = { runMigrations };

// ── Standalone CLI mode ──
if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pg = new Pool({
    user: process.env.POSTGRES_USER || 'postgres',
    host: process.env.POSTGRES_HOST || '192.168.9.30',
    database: process.env.POSTGRES_DB || 'synapse',
    password: process.env.POSTGRES_PASSWORD || 'Admin@123',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  });

  (async () => {
    try {
      const r = await pg.query(
        'SELECT current_database() AS db, current_user AS usr, version()',
      );
      console.log(
        `✅ Connected → database "${r.rows[0].db}" as "${r.rows[0].usr}"`,
      );
      console.log(`   ${String(r.rows[0].version).split(',')[0]}\n`);
    } catch (e) {
      console.error(`❌ Connection failed: ${e.message}`);
      console.error(
        `   Host: ${process.env.POSTGRES_HOST || '192.168.9.30'}:${process.env.POSTGRES_PORT || '5432'}`,
      );
      console.error(`   DB:   ${process.env.POSTGRES_DB || 'synapse'}`);
      console.error(`   User: ${process.env.POSTGRES_USER || 'postgres'}`);
      await pg.end().catch(() => {});
      process.exit(1);
    }

    const result = await runMigrations(pg);
    await pg.end();
    process.exit(result.failed === 0 ? 0 : 1);
  })().catch(async (err) => {
    console.error('Fatal:', err.message);
    await pg.end().catch(() => {});
    process.exit(1);
  });
}
