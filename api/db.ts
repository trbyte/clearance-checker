import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Single serverless endpoint for ClearPass.
 *   GET  /api/db?action=ping            -> verifies the access code
 *   GET  /api/db[?since=<version>]      -> full state (or {changed:false} if nothing new)
 *   GET  /api/db?action=backup          -> raw tables for JSON backup
 *   POST /api/db  { op, ...payload }    -> mutations
 *
 * Env vars: DATABASE_URL (Postgres / Neon), APP_ACCESS_CODE (shared team code)
 */

const sha = (s: string) => createHash('sha256').update(s).digest();

function authorized(req: VercelRequest): boolean {
  const expected = process.env.APP_ACCESS_CODE;
  if (!expected) throw new Error('APP_ACCESS_CODE is not configured on the server.');
  const given = String(req.headers['x-access-code'] ?? '');
  return timingSafeEqual(sha(given), sha(expected));
}

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured on the server.');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

let schemaReady: Promise<void> | null = null;
function ensureSchema() {
  if (!schemaReady) {
    const sql = getSql();
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS students (
        id text PRIMARY KEY, key text NOT NULL,
        student_id text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '',
        first_name text NOT NULL DEFAULT '', program text NOT NULL DEFAULT '',
        year_level text NOT NULL DEFAULT '', remarks text NOT NULL DEFAULT '')`;
      await sql`CREATE INDEX IF NOT EXISTS students_key_idx ON students (key)`;
      await sql`CREATE TABLE IF NOT EXISTS events (
        id text PRIMARY KEY, name text NOT NULL, file_name text NOT NULL DEFAULT '',
        uploaded_at double precision NOT NULL DEFAULT 0, clearance_col_name text,
        recs jsonb NOT NULL DEFAULT '[]'::jsonb)`;
      await sql`CREATE TABLE IF NOT EXISTS edits (
        id text PRIMARY KEY, val text NOT NULL, updated_at double precision NOT NULL DEFAULT 0)`;
      await sql`CREATE TABLE IF NOT EXISTS clearances (
        id text PRIMARY KEY, val text NOT NULL, updated_at double precision NOT NULL DEFAULT 0)`;
      await sql`CREATE TABLE IF NOT EXISTS meta (
        id text PRIMARY KEY, master_file_name text, overall_clearance_col_name text,
        last_updated double precision NOT NULL DEFAULT 0)`;
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

const rows = (r: unknown) => r as Record<string, any>[];

async function readState() {
  const sql = getSql();
  const [students, events, edits, clrs, meta] = await Promise.all([
    sql`SELECT id, key, student_id AS "studentId", last_name AS "lastName", first_name AS "firstName",
               program, year_level AS "yearLevel", remarks FROM students`,
    sql`SELECT id, name, file_name AS "fileName", uploaded_at AS "uploadedAt",
               clearance_col_name AS "clearanceColName", recs FROM events ORDER BY uploaded_at, id`,
    sql`SELECT id, val FROM edits`,
    sql`SELECT id, val FROM clearances`,
    sql`SELECT id, master_file_name AS "masterFileName", overall_clearance_col_name AS "overallClearanceColName",
               last_updated AS "lastUpdated" FROM meta WHERE id = 'meta_main'`,
  ]);
  const editsMap: Record<string, string> = {};
  for (const e of rows(edits)) editsMap[e.id] = e.val;
  const clr: Record<string, string> = {};
  for (const c of rows(clrs)) clr[c.id] = c.val;
  const m = rows(meta)[0];
  return {
    version: m ? Number(m.lastUpdated) : 0,
    students: rows(students),
    events: rows(events).map((e) => ({ ...e, clearanceColName: e.clearanceColName ?? undefined })),
    edits: editsMap,
    clr,
    meta: m
      ? {
          id: 'meta_main',
          masterFileName: m.masterFileName ?? undefined,
          overallClearanceColName: m.overallClearanceColName ?? undefined,
          lastUpdated: Number(m.lastUpdated),
        }
      : undefined,
  };
}

async function readBackup() {
  const sql = getSql();
  const [students, events, edits, clearances, meta] = await Promise.all([
    sql`SELECT id, key, student_id AS "studentId", last_name AS "lastName", first_name AS "firstName",
               program, year_level AS "yearLevel", remarks FROM students`,
    sql`SELECT id, name, file_name AS "fileName", uploaded_at AS "uploadedAt",
               clearance_col_name AS "clearanceColName", recs FROM events ORDER BY uploaded_at, id`,
    sql`SELECT id, val, updated_at AS "updatedAt" FROM edits`,
    sql`SELECT id, val, updated_at AS "updatedAt" FROM clearances`,
    sql`SELECT id, master_file_name AS "masterFileName", overall_clearance_col_name AS "overallClearanceColName",
               last_updated AS "lastUpdated" FROM meta`,
  ]);
  return { students, events, edits, clearances, meta };
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

async function applyOp(op: string, b: Record<string, any>) {
  const sql = getSql();
  const now = Date.now();
  // Every mutation bumps meta.last_updated so other users' polling notices the change.
  const touch = () => sql`INSERT INTO meta (id, last_updated) VALUES ('meta_main', ${now})
    ON CONFLICT (id) DO UPDATE SET last_updated = GREATEST(meta.last_updated + 1, EXCLUDED.last_updated)`;

  const insertStudents = (list: unknown[]) => sql`INSERT INTO students
      (id, key, student_id, last_name, first_name, program, year_level, remarks)
    SELECT id, key, coalesce("studentId",''), coalesce("lastName",''), coalesce("firstName",''),
           coalesce(program,''), coalesce("yearLevel",''), coalesce(remarks,'')
    FROM jsonb_to_recordset(${JSON.stringify(list)}::jsonb) AS x(id text, key text, "studentId" text,
      "lastName" text, "firstName" text, program text, "yearLevel" text, remarks text)`;

  switch (op) {
    case 'saveMasterList': {
      if (!isArr(b.students)) throw new Error('students must be an array');
      const fileName = isStr(b.fileName) && b.fileName ? b.fileName : 'Uploaded Master List';
      await sql.transaction([
        sql`DELETE FROM students`,
        insertStudents(b.students),
        sql`INSERT INTO meta (id, master_file_name, last_updated) VALUES ('meta_main', ${fileName}, ${now})
            ON CONFLICT (id) DO UPDATE SET master_file_name = EXCLUDED.master_file_name,
              last_updated = GREATEST(meta.last_updated + 1, EXCLUDED.last_updated)`,
      ]);
      return;
    }
    case 'saveSingleEvent': {
      const e = b.event;
      if (!e || !isStr(e.id) || !isStr(e.name)) throw new Error('invalid event');
      await sql.transaction([
        sql`INSERT INTO events (id, name, file_name, uploaded_at, clearance_col_name, recs)
            VALUES (${e.id}, ${e.name}, ${e.fileName ?? ''}, ${Number(e.uploadedAt) || now},
                    ${e.clearanceColName ?? null}, ${JSON.stringify(e.recs ?? [])}::jsonb)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, file_name = EXCLUDED.file_name,
              uploaded_at = EXCLUDED.uploaded_at, clearance_col_name = EXCLUDED.clearance_col_name,
              recs = EXCLUDED.recs`,
        touch(),
      ]);
      return;
    }
    case 'removeEventById': {
      if (!isStr(b.eventId)) throw new Error('eventId required');
      await sql.transaction([sql`DELETE FROM events WHERE id = ${b.eventId}`, touch()]);
      return;
    }
    case 'saveAttendanceEdit':
    case 'saveClearanceOverride': {
      if (!isStr(b.key) || !isStr(b.val)) throw new Error('key and val required');
      const q =
        op === 'saveAttendanceEdit'
          ? sql`INSERT INTO edits (id, val, updated_at) VALUES (${b.key}, ${b.val}, ${now})
                ON CONFLICT (id) DO UPDATE SET val = EXCLUDED.val, updated_at = EXCLUDED.updated_at`
          : sql`INSERT INTO clearances (id, val, updated_at) VALUES (${b.key}, ${b.val}, ${now})
                ON CONFLICT (id) DO UPDATE SET val = EXCLUDED.val, updated_at = EXCLUDED.updated_at`;
      await sql.transaction([q, touch()]);
      return;
    }
    case 'removeAttendanceEdit': {
      if (!isStr(b.key)) throw new Error('key required');
      await sql.transaction([sql`DELETE FROM edits WHERE id = ${b.key}`, touch()]);
      return;
    }
    case 'removeClearanceOverrides': {
      if (!isArr(b.keys) || !b.keys.every(isStr)) throw new Error('keys must be string[]');
      await sql.transaction([
        sql`DELETE FROM clearances WHERE id = ANY(${b.keys as string[]}::text[])`,
        touch(),
      ]);
      return;
    }
    case 'renameEvent': {
      if (!isStr(b.oldName) || !isStr(b.newName)) throw new Error('oldName and newName required');
      const { oldName, newName } = b;
      const migrate = (table: 'edits' | 'clearances') =>
        table === 'edits'
          ? sql`UPDATE edits SET id = left(id, length(id) - length(${oldName}::text)) || ${newName}::text,
                  updated_at = ${now}
                WHERE right(id, length(${oldName}::text) + 2) = '||' || ${oldName}::text`
          : sql`UPDATE clearances SET id = left(id, length(id) - length(${oldName}::text)) || ${newName}::text,
                  updated_at = ${now}
                WHERE right(id, length(${oldName}::text) + 2) = '||' || ${oldName}::text`;
      await sql.transaction([
        sql`UPDATE events SET name = ${newName} WHERE name = ${oldName}`,
        migrate('edits'),
        migrate('clearances'),
        touch(),
      ]);
      return;
    }
    case 'updateEventClearanceColName': {
      if (!isStr(b.eventId) || !isStr(b.colName)) throw new Error('eventId and colName required');
      await sql.transaction([
        sql`UPDATE events SET clearance_col_name = ${b.colName} WHERE id = ${b.eventId}`,
        touch(),
      ]);
      return;
    }
    case 'updateOverallClearanceColName': {
      if (!isStr(b.colName)) throw new Error('colName required');
      await sql.transaction([
        sql`INSERT INTO meta (id, overall_clearance_col_name, last_updated) VALUES ('meta_main', ${b.colName}, ${now})
            ON CONFLICT (id) DO UPDATE SET overall_clearance_col_name = EXCLUDED.overall_clearance_col_name,
              last_updated = GREATEST(meta.last_updated + 1, EXCLUDED.last_updated)`,
      ]);
      return;
    }
    case 'clearAll': {
      await sql.transaction([
        sql`DELETE FROM students`,
        sql`DELETE FROM events`,
        sql`DELETE FROM edits`,
        sql`DELETE FROM clearances`,
        sql`DELETE FROM meta`,
        touch(),
      ]);
      return;
    }
    case 'restoreBackup': {
      const d = b.data;
      if (!d || !isArr(d.students) || !isArr(d.events)) throw new Error('Invalid backup file format.');
      const edits = isArr(d.edits) ? d.edits : [];
      const clearances = isArr(d.clearances) ? d.clearances : [];
      const meta = isArr(d.meta) ? d.meta : [];
      const metaRow = (meta[0] ?? {}) as Record<string, any>;
      await sql.transaction([
        sql`DELETE FROM students`,
        sql`DELETE FROM events`,
        sql`DELETE FROM edits`,
        sql`DELETE FROM clearances`,
        sql`DELETE FROM meta`,
        insertStudents(d.students),
        sql`INSERT INTO events (id, name, file_name, uploaded_at, clearance_col_name, recs)
            SELECT id, name, coalesce("fileName",''), coalesce("uploadedAt", 0), "clearanceColName",
                   coalesce(recs, '[]'::jsonb)
            FROM jsonb_to_recordset(${JSON.stringify(d.events)}::jsonb) AS x(id text, name text,
              "fileName" text, "uploadedAt" float8, "clearanceColName" text, recs jsonb)`,
        sql`INSERT INTO edits (id, val, updated_at)
            SELECT id, val, coalesce("updatedAt", 0)
            FROM jsonb_to_recordset(${JSON.stringify(edits)}::jsonb) AS x(id text, val text, "updatedAt" float8)`,
        sql`INSERT INTO clearances (id, val, updated_at)
            SELECT id, val, coalesce("updatedAt", 0)
            FROM jsonb_to_recordset(${JSON.stringify(clearances)}::jsonb) AS x(id text, val text, "updatedAt" float8)`,
        sql`INSERT INTO meta (id, master_file_name, overall_clearance_col_name, last_updated)
            VALUES ('meta_main', ${metaRow.masterFileName ?? null}, ${metaRow.overallClearanceColName ?? null}, ${now})`,
      ]);
      return;
    }
    default:
      throw new Error(`Unknown op: ${op}`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!authorized(req)) return res.status(401).json({ error: 'Invalid access code' });

    if (req.method === 'GET') {
      if (req.query.action === 'ping') return res.status(200).json({ ok: true });
      await ensureSchema();
      if (req.query.action === 'backup') return res.status(200).json(await readBackup());

      const since = req.query.since !== undefined ? Number(req.query.since) : NaN;
      if (!Number.isNaN(since)) {
        const m = rows(await getSql()`SELECT last_updated FROM meta WHERE id = 'meta_main'`)[0];
        const current = m ? Number(m.last_updated) : 0;
        if (current === since) return res.status(200).json({ changed: false });
      }
      return res.status(200).json({ changed: true, ...(await readState()) });
    }

    if (req.method === 'POST') {
      await ensureSchema();
      const { op, ...rest } = (req.body ?? {}) as Record<string, any>;
      if (!isStr(op)) return res.status(400).json({ error: 'op required' });
      await applyOp(op, rest);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('[api/db]', err);
    const msg = String(err?.message ?? 'Server error');
    const client = /required|must be|invalid|Unknown op|Invalid backup/i.test(msg);
    return res.status(client ? 400 : 500).json({ error: client ? msg : 'Server error. Check function logs.' });
  }
}
