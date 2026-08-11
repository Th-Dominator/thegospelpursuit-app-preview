/* The Gospel Pursuit — cloud sync client (drop-in).
   Final home: repo/js/sync.js, loaded from index.html BEFORE js/app.js.

   Design goal: sync without rewriting every save site in app.js. The app
   already writes all its state to localStorage under `tgp.*` keys; this module
   mirrors those keys to the backend:

     - on sign-in:  pull the cloud copy and merge it in (newest wins), then
                    reload so the app reads the merged state;
     - while open:  every few seconds (and on tab-hide) diff the watched keys
                    against the last pushed snapshot and PUT what changed.

   It needs a Clerk session token. Wire `getToken` to Clerk's
   `window.Clerk.session.getToken()`. Set API_BASE to your Vercel origin
   (or '' if the API is served from the same origin as the app). */
(function () {
  'use strict';

  var API_BASE = '';   // '' = same origin (recommended). Else e.g. 'https://gp-api.vercel.app'
  var PUSH_EVERY_MS = 8000;

  // the localStorage keys worth syncing (device-only caches are excluded)
  var KEYS = [
    'tgp.annotations', 'tgp.apoloDifficulty', 'tgp.apologetics', 'tgp.apologistLevel',
    'tgp.customDefinitions', 'tgp.customPlans', 'tgp.language', 'tgp.myDevotionals',
    'tgp.narrationStyle', 'tgp.plans', 'tgp.progress', 'tgp.savedVerses',
    'tgp.settings', 'tgp.theme', 'tgp.verseVideos'
  ];

  var lastSnapshot = {};   // key -> raw string last known to be in the cloud
  var getToken = null;     // set by init()

  function api(path, opts) {
    return getToken().then(function (token) {
      opts = opts || {};
      opts.headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opts.headers || {});
      return fetch(API_BASE + path, opts);
    });
  }

  // pull the cloud copy and merge into localStorage (cloud wins for now — see note)
  function pull() {
    return api('/api/sync').then(function (r) { return r.ok ? r.json() : {}; }).then(function (cloud) {
      var changed = false;
      KEYS.forEach(function (k) {
        var entry = cloud[k];
        if (!entry) return;
        var raw = JSON.stringify(entry.data);
        lastSnapshot[k] = raw;
        if (localStorage.getItem(k) !== raw) { localStorage.setItem(k, raw); changed = true; }
      });
      return changed;
    });
  }

  // push any watched key whose value changed since the last known cloud copy
  function push() {
    var jobs = [];
    KEYS.forEach(function (k) {
      var raw = localStorage.getItem(k);
      if (raw == null || raw === lastSnapshot[k]) return;
      var data; try { data = JSON.parse(raw); } catch (e) { return; }
      jobs.push(
        api('/api/sync', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ namespace: k, data: data })
        }).then(function (r) { if (r.ok) lastSnapshot[k] = raw; })
      );
    });
    return Promise.all(jobs);
  }

  // public: call once the user is signed in and Clerk can mint tokens
  function init(opts) {
    getToken = opts.getToken;
    if (opts.apiBase != null) API_BASE = opts.apiBase;
    // first pull merges the cloud copy; reload so app.js reads merged state
    pull().then(function (changed) {
      if (changed) location.reload();
      setInterval(push, PUSH_EVERY_MS);
      window.addEventListener('pagehide', push);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') push();
      });
    });
  }

  window.TGPSync = { init: init, pushNow: push };
})();

/* Wiring in index.html (add after Clerk loads and the user is signed in):

   <script src="js/sync.js"></script>
   <script>
     window.Clerk.load().then(function () {
       if (window.Clerk.user) {
         TGPSync.init({ getToken: function () { return window.Clerk.session.getToken(); } });
       }
     });
   </script>

   NOTE on merge policy: this first version is "cloud wins on sign-in, then
   mirror local changes up." That's correct for a single active device. When you
   add multi-device editing, switch to per-namespace `updatedAt` comparison
   (the API already returns it) so the newer side wins field-by-field. */
