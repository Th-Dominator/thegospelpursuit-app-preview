// Vercel serverless function — GET/PUT the signed-in user's saved data.
//
//   GET  /api/sync            -> { "tgp.progress": { data, updatedAt }, ... }
//   PUT  /api/sync  { namespace, data }   -> upsert one namespace
//   GET  /api/sync?health=1   -> config check (no auth), for debugging
//
// Auth: a Clerk session token in the Authorization header (Bearer <token>).
// Storage: Neon (serverless Postgres) via its HTTP driver.
//
// Env vars (Vercel → project → Settings → Environment Variables, all scopes):
//   DATABASE_URL      — Neon pooled connection string
//   CLERK_SECRET_KEY  — from the Clerk dashboard
//   ALLOWED_ORIGIN    — your site origin; omit to allow any origin.
//
// Dependencies are imported dynamically so a missing package or env var returns
// a clear JSON message instead of a bare FUNCTION_INVOCATION_FAILED crash.

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

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise(function (resolve) {
    var data = '';
    req.on('data', function (c) { data += c; });
    req.on('end', function () { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', function () { resolve({}); });
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  var url = new URL(req.url, 'http://localhost');
  var isHealth = url.searchParams.has('health');

  // Load deps dynamically so a missing package yields a message, not a crash.
  var neon, verifyToken, depsError = null;
  try {
    ({ neon } = await import('@neondatabase/serverless'));
    ({ verifyToken } = await import('@clerk/backend'));
  } catch (e) {
    depsError = String((e && e.message) || e);
  }

  // Health check — no auth. Lets us see what's configured from the outside.
  if (isHealth) {
    return res.status(200).json({
      ok: !depsError,
      hasDbUrl: !!process.env.DATABASE_URL,
      hasClerkKey: !!process.env.CLERK_SECRET_KEY,
      deps: { neon: !!neon, clerk: !!verifyToken },
      depsError: depsError
    });
  }

  if (depsError) return res.status(500).json({ error: 'deps_missing', detail: depsError });
  if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'missing_database_url' });
  if (!process.env.CLERK_SECRET_KEY) return res.status(500).json({ error: 'missing_clerk_secret' });

  // Authenticate.
  var userId = null;
  try {
    var token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (token) {
      var payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
      userId = payload.sub || null;
    }
  } catch (e) {
    return res.status(401).json({ error: 'bad_token', detail: String((e && e.message) || e) });
  }
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  var sql = neon(process.env.DATABASE_URL);
  try {
    if (req.method === 'GET') {
      var rows = await sql`
        select namespace, data, updated_at
        from user_sync where user_id = ${userId}`;
      var out = {};
      for (var i = 0; i < rows.length; i++) out[rows[i].namespace] = { data: rows[i].data, updatedAt: rows[i].updated_at };
      return res.status(200).json(out);
    }

    if (req.method === 'PUT') {
      var body = await readJson(req);
      var namespace = body.namespace, data = body.data;
      if (!ALLOWED.has(namespace)) return res.status(400).json({ error: 'bad_namespace' });
      await sql`
        insert into user_sync (user_id, namespace, data, updated_at)
        values (${userId}, ${namespace}, ${JSON.stringify(data)}::jsonb, now())
        on conflict (user_id, namespace)
        do update set data = excluded.data, updated_at = now()`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'db_error', detail: String((e && e.message) || e) });
  }
}
