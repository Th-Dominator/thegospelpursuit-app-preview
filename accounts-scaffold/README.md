# Accounts & sync — setup

This folder is a **staged scaffold**. It is not wired into the live app yet, so
the site keeps working untouched. Follow the steps below; the code is ready.

## What this gives you

Sign-in, plus cloud backup of a user's data (progress, saved verses, notes,
plans, custom definitions, devotionals, settings). Today everything lives only
in the browser — reinstall or switch phones and it's gone. This fixes that.

## Architecture (recommended: one origin)

```
Browser (the app + Clerk sign-in)
      │  Bearer <clerk token>
      ▼
Vercel  /api/sync  (serverless function)
      │
      ▼
Neon (serverless Postgres)  ── user_sync table
```

- **Neon** = the database. **Vercel** = hosts the app *and* the `/api/sync`
  function. **Clerk** = sign-in; gives each user a stable id.
- **n8n stays as-is** for the AI features. This only adds accounts + data sync.
- Serving the app and the API from the **same Vercel origin** avoids CORS and
  makes Clerk "just work." Moving off GitHub Pages is a one-time import.

## The two things only you can do

1. **Create the accounts** (I can't create accounts or handle your keys):
   - **Neon** → new project → open the SQL editor → paste `db/schema.sql` → run.
     Copy the **pooled** connection string.
   - **Clerk** → new application → copy the **Secret key** and **Publishable key**.
   - **Vercel** → import the repo (or a copy) as a project.

2. **Set the env vars** in the Vercel project (Settings → Environment Variables):
   - `DATABASE_URL` = Neon pooled connection string
   - `CLERK_SECRET_KEY` = Clerk secret key
   - `ALLOWED_ORIGIN` = your site origin (leave unset while testing)

## What I do once those exist

- Move `api/sync.js`, `package.json` to the repo root and `js/sync.js` to
  `repo/js/`; add the Clerk `<script>` + a sign-in button to `index.html`.
- Wire `TGPSync.init(...)` to Clerk's token, set `API_BASE`, and set the
  Publishable key.
- Test end-to-end on a Vercel preview deploy (sign in, save a verse, reload in a
  private window, confirm it restored), then flip it live.

## Files here

| File | Final home | Purpose |
|---|---|---|
| `db/schema.sql` | run in Neon | the one table |
| `api/sync.js` | `repo/api/sync.js` | GET/PUT the user's data |
| `package.json` | `repo/package.json` | function dependencies |
| `js/sync.js` | `repo/js/sync.js` | mirrors localStorage ⇄ cloud |

## Data that syncs

All 15 `tgp.*` keys except `tgp.genCache.v1` (a device-side answer cache that
should stay local). See the `KEYS` / `ALLOWED` lists in `js/sync.js` and
`api/sync.js` — they must match.
