-- The Gospel Pursuit — accounts & sync store (Neon / Postgres)
-- Run this once in the Neon SQL editor after creating the project.
--
-- One row per (user, namespace). A "namespace" is one of the app's existing
-- localStorage keys (tgp.progress, tgp.savedVerses, …) so the app can mirror
-- what it already stores, with no data redesign. `data` holds the same JSON
-- the app keeps on-device today.

create table if not exists user_sync (
  user_id    text        not null,   -- Clerk user id (payload.sub)
  namespace  text        not null,   -- e.g. 'tgp.progress'
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, namespace)
);

-- fast "give me everything for this user" reads
create index if not exists user_sync_user_idx on user_sync (user_id);
