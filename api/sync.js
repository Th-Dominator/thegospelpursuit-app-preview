// Vercel serverless function — GET/PUT the signed-in user's saved data.
//
//   GET  /api/sync            -> { "tgp.progress": { data, updatedAt }, ... }
//   PUT  /api/sync  { namespace, data }   -> upsert one namespace
//
// Auth: a Clerk session token in the Authorization header (Bearer <token>).
// Storage: Neon (serverless Postgres) via its HTTP driver.
//
// Env vars (set in the Vercel project settings):
//   DATABASE_URL      — Neon connection string (the "pooled" one)
//   CLERK_SECRET_KEY  — from the Clerk dashboard
//   ALLOWED_ORIGIN    — your site origin (e.g. https://thegospelpursuit.app);
//                       omit to allow any origin during setup.

import { neon } from '@neondatabase/serverless';
import { verifyToken } from '@clerk/backend';

const sql = neon(process.env.DATABASE_URL);

// Only these namespaces may be stored — never trust arbitrary keys from a client.
// Mirrors the app's syncable localStorage keys (tgp.genCache.v1 stays device-only).
const ALLOWED = new Set([
  'tgp.annotations', 'tgp.apoloDifficulty', 'tgp.apologetics', 'tgp.apologistLevel',
  'tgp.customDefinitions', 'tgp.customPlans', 'tgp.language', 'tgp.myDevotionals',
  'tgp.narrationStyle', 'tgp.plans', 'tgp.progress', 'tgp.savedVerses',
  'tgp.settings', 'tgp.theme', 'tgp.verseVideos'
]);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

async function userIdFrom(req) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    return payload.sub || null;   // Clerk user id
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const userId = await userIdFrom(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  try {
    if (req.method === 'GET') {
      const rows = await sql`
        select namespace, data, updated_at
        from user_sync where user_id = ${userId}`;
      const out = {};
      for (const r of rows) out[r.namespace] = { data: r.data, updatedAt: r.updated_at };
      return res.status(200).json(out);
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { namespace, data } = body;
      if (!ALLOWED.has(namespace)) return res.status(400).json({ error: 'bad namespace' });
      await sql`
        insert into user_sync (user_id, namespace, data, updated_at)
        values (${userId}, ${namespace}, ${JSON.stringify(data)}::jsonb, now())
        on conflict (user_id, namespace)
        do update set data = excluded.data, updated_at = now()`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
