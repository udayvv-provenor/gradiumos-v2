#!/usr/bin/env node
/**
 * BC 185 — Restore drill verification script.
 *
 * Compares row counts for 11 key tables between a source (production) DB
 * and a target (restored drill) DB. Exits 0 if all counts are within 0.1%
 * of each other (floor: 1 row tolerance). Exits 1 if any table exceeds the
 * threshold or if a connection error occurs.
 *
 * Usage:
 *   node scripts/verify-restore.js \
 *     --source postgresql://user:pass@host/gradium_v3 \
 *     --target postgresql://localhost/gradium_v3_drill
 *
 * Requires: pg  (npm install pg  — already in dependencies as a transitive dep;
 *               if missing, run: npm install pg)
 */

import pg from 'pg';

const TABLES = [
  'User',
  'Learner',
  'Institution',
  'Employer',
  'EmployerRole',
  'AssessmentAttemptV2',
  'CompetencyScore',
  'GradiumSignal',
  'Application',
  'Notification',
  'AuditLog',
  'ConsentRecord',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  const source = get('--source');
  const target = get('--target');
  if (!source || !target) {
    console.error('Usage: node verify-restore.js --source <connstr> --target <connstr>');
    process.exit(1);
  }
  return { source, target };
}

async function countRows(client, table) {
  // Prisma uses quoted PascalCase table names in PostgreSQL.
  const res = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
  return res.rows[0].n;
}

async function main() {
  const { source, target } = parseArgs();

  const srcClient = new pg.Client({ connectionString: source });
  const tgtClient = new pg.Client({ connectionString: target });

  await srcClient.connect();
  await tgtClient.connect();

  const THRESHOLD = 0.001; // 0.1%
  let allPass = true;

  const rows = [];

  for (const table of TABLES) {
    let srcCount, tgtCount;
    try {
      [srcCount, tgtCount] = await Promise.all([
        countRows(srcClient, table),
        countRows(tgtClient, table),
      ]);
    } catch (err) {
      console.error(`ERROR querying table "${table}": ${err.message}`);
      allPass = false;
      rows.push({ table, src: 'ERR', tgt: 'ERR', delta: 'ERR', pass: 'FAIL' });
      continue;
    }

    const tolerance = Math.max(1, Math.ceil(srcCount * THRESHOLD));
    const delta = Math.abs(srcCount - tgtCount);
    const pass = delta <= tolerance;
    if (!pass) allPass = false;

    rows.push({
      table,
      src: srcCount,
      tgt: tgtCount,
      delta,
      pass: pass ? 'PASS' : 'FAIL',
    });
  }

  await srcClient.end();
  await tgtClient.end();

  // Print comparison table
  const col = (s, w) => String(s).padStart(w);
  console.log('');
  console.log(
    'Table'.padEnd(24) +
    col('Source', 10) +
    col('Restored', 10) +
    col('Delta', 8) +
    col('Result', 8),
  );
  console.log('─'.repeat(62));
  for (const r of rows) {
    console.log(
      r.table.padEnd(24) +
      col(r.src, 10) +
      col(r.tgt, 10) +
      col(r.delta, 8) +
      col(r.pass, 8),
    );
  }
  console.log('─'.repeat(62));
  console.log('');

  if (allPass) {
    console.log('All tables within 0.1% threshold. Restore drill: PASSED.');
    process.exit(0);
  } else {
    console.error('One or more tables exceeded the 0.1% threshold. Restore drill: FAILED.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
