import express from 'express';
import cors from 'cors';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Express + Socket.io + Redis adapter ─────────────────────────────────────

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

// Redis pub/sub — allows realtime sync across multiple BFF instances
// (e.g. when scaled horizontally behind Nginx)
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

const pubClient = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
const subClient = pubClient.duplicate();

// ioredis connects automatically on creation — no .connect() needed
pubClient.on('ready', () => {
  io.adapter(createAdapter(pubClient, subClient));
  console.log('✅ Redis adapter connected');
});
pubClient.on('error', (err) => {
  console.warn('⚠️  Redis error — Socket.io runs in single-node mode:', err.message);
});

app.use(cors());
app.use(express.json());

// ─── PostgreSQL pool ──────────────────────────────────────────────────────────

const pool = new pg.Pool({
  host:     process.env.DB_HOST     || 'postgres',
  port:     parseInt(process.env.DB_PORT || '5432'),
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME     || 'minitable',
});

// ─── CSV parser (supports multiline quoted fields) ───────────────────────────

const parseCSV = (csvContent: string): any[] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char     = csvContent[i];
    const nextChar = csvContent[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (currentField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        currentField = '';
      }
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
      if (char === '\r' && nextChar === '\n') i++;
    } else {
      currentField += char;
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
  }
  if (currentRow.length > 0) rows.push(currentRow);
  if (rows.length < 2) return [];

  const headers  = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const dataRows: any[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row: any = {};
    headers.forEach((header, idx) => { row[header] = rows[i][idx] || ''; });
    dataRows.push(row);
  }
  return dataRows;
};

// ─── DB setup & seed ─────────────────────────────────────────────────────────

const setupDb = async () => {
  try {
    // Create table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creative_tasks (
        id                SERIAL PRIMARY KEY,
        tasks_name        TEXT,
        compose           TEXT,
        link_to_ad        TEXT,
        stage             TEXT,
        task_owner        TEXT,
        deadline          TEXT,
        team              TEXT,
        ai_services       TEXT,
        purchases         TEXT,
        platform          TEXT,
        product           TEXT,
        localization      TEXT,
        size              TEXT,
        concept           TEXT,
        status            TEXT,
        compose_creator   TEXT,
        compose_done_date TEXT,
        attachments       TEXT,
        impressions       TEXT,
        test_status       TEXT
      );
    `);

    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) FROM creative_tasks');

    if (parseInt(count) === 0) {
      // Try importing CSV first
      try {
        const csvPath = path.join(__dirname, '../Utilities Flow-🔍 search.csv');
        if (fs.existsSync(csvPath)) {
          const csvRows = parseCSV(fs.readFileSync(csvPath, 'utf-8'));
          for (const row of csvRows) {
            await pool.query(
              `INSERT INTO creative_tasks
                (tasks_name, compose, link_to_ad, stage, task_owner, deadline,
                 team, ai_services, purchases, platform, product, localization,
                 size, concept, status, compose_creator, compose_done_date,
                 attachments, impressions, test_status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
              [
                row.tasks_name || '', row.compose || '', row.link_to_ad || '',
                row.stage || '', row.task_owner || '', row.deadline || '',
                row.team || '', row.ai_services || '', row.purchases || '',
                row.platform || '', row.product || '', row.localization || '',
                row.size || '', row.concept || '', row.status || '',
                row.compose_creator || '', row.compose_done_date || '',
                row.attachments || '', row.impressions || '', row.test_status || '',
              ]
            );
          }
          console.log(`✅ Imported ${csvRows.length} rows from CSV`);
        }
      } catch {
        console.log('ℹ️  No CSV found — skipping import');
      }

      // Generate 50,000 synthetic rows
      console.log('⏳ Generating 50,000 test rows…');
      await pool.query(`
        INSERT INTO creative_tasks (
          tasks_name, compose, link_to_ad, stage, task_owner, deadline,
          team, ai_services, purchases, platform, product, localization,
          size, concept, status, compose_creator, compose_done_date,
          attachments, impressions, test_status
        )
        SELECT
          'Task_' || gs || '_' ||
            (ARRAY['Creative','Design','Video','Animation','AI','Marketing','Social','Campaign'])[1 + (gs % 8)],
          'Hook: ' || (ARRAY['Engaging opening','Clear message','Upbeat track','Modern design'])[1 + (gs % 4)] ||
            CASE WHEN gs % 10 = 0 THEN ' — extended creative brief with additional context.' ELSE '.' END,
          'https://dropbox.com/task/' || gs,
          (ARRAY['Compositing','Draft','Review','Final','Approved'])[1 + (gs % 5)],
          (ARRAY['John Doe','Jane Smith','Bob Wilson','Alice Brown','Charlie Davis'])[1 + (gs % 5)],
          (CURRENT_DATE + (gs % 90 || ' days')::interval)::text,
          (ARRAY['Internal','External','Agency','Freelance'])[1 + (gs % 4)],
          (ARRAY['Nano Banana','Oliveia','AI Team','Creative Studio'])[1 + (gs % 4)],
          (ARRAY['','Purchase A','Purchase B'])[1 + (gs % 3)],
          (ARRAY['Facebook','Instagram','TikTok','YouTube','Twitter'])[1 + (gs % 5)],
          (ARRAY['Visify','Product A','Product B','Product C'])[1 + (gs % 4)],
          (ARRAY['English (_en_)','Spanish','French','German'])[1 + (gs % 4)],
          (ARRAY['9x16','16x9','1x1','4x5'])[1 + (gs % 4)],
          (ARRAY['New Concept','Variation','Remix','Original'])[1 + (gs % 4)],
          (ARRAY['Done','In Progress','Planned','In Approve'])[1 + (gs % 4)],
          (ARRAY['Creator 1','Creator 2','Creator 3',''])[1 + (gs % 4)],
          CASE WHEN gs % 3 = 0 THEN (CURRENT_DATE - (gs % 30 || ' days')::interval)::text ELSE '' END,
          CASE WHEN gs % 5 = 0 THEN 'attachment_' || gs || '.pdf' ELSE '' END,
          CASE WHEN gs % 7 = 0 THEN (10000 + gs * 17)::text ELSE '' END,
          (ARRAY['','Passed','Failed','Pending'])[1 + (gs % 4)]
        FROM generate_series(1, 50000) gs
      `);
      console.log('✅ Generated 50,000 rows');
    }

    console.log('✅ Database ready');
  } catch (err) {
    console.error('❌ DB setup error:', err);
  }
};

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`🔌 Client disconnected: ${socket.id}`));
});

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// GET /api/rows?limit=150&offset=0
app.get('/api/rows', async (req, res) => {
  try {
    const limit  = Math.min(Math.max(1, parseInt(req.query.limit  as string) || 150), 500);
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

    const [dataResult, countResult] = await Promise.all([
      pool.query('SELECT * FROM creative_tasks ORDER BY id ASC LIMIT $1 OFFSET $2', [limit, offset]),
      pool.query('SELECT COUNT(*)::int AS total FROM creative_tasks'),
    ]);

    res.json({
      data:   dataResult.rows,
      total:  countResult.rows[0].total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('GET /api/rows error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /api/rows/:id — update cell(s) + broadcast realtime event
app.patch('/api/rows/:id', async (req, res) => {
  try {
    const id      = parseInt(req.params.id);
    const updates = req.body as Record<string, string>;

    const fields = Object.keys(updates);
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Build parameterized SET clause
    const setClause = fields
      .map((f, i) => `${f.toLowerCase().replace(/\s+/g, '_')} = $${i + 1}`)
      .join(', ');
    const values = [...fields.map((f) => updates[f]), id];

    const result = await pool.query(
      `UPDATE creative_tasks SET ${setClause} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Row not found' });
    }

    const updatedRow = result.rows[0];

    // Broadcast to ALL connected clients (realtime sync)
    io.emit('cell-updated', updatedRow);

    res.json(updatedRow);
  } catch (err) {
    console.error('PATCH /api/rows/:id error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3001');

httpServer.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 BFF running on port ${PORT}`);
  await setupDb();
});
