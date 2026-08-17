/* Service worker for The Gospel Pursuit.
   Two jobs:
   1. Offline app shell — precache the core files and serve them with no
      connection, so the app opens instantly and works on a plane or a weak
      signal. Reference answers (chapter guides, verse context, quizzes, etc.)
      are cached separately in the page via localStorage.
   2. Background push reminders — sent by the n8n reminder workflow.

   Lives at the site root so its scope covers the whole app. */

var CACHE = 'tgp-cache-v16';

/* The app's own code changes on every deploy, so it must be served
   network-first (freshest wins online, cache is the offline fallback) — never
   stale-while-revalidate, which would leave the reader a deploy behind. Large,
   rarely-changing data (xref-data.js, lang/*.js) stays stale-while-revalidate. */
var FRESH_CODE = ['js/app.js', 'js/i18n.js', 'js/config.js', 'css/style.css',
  'js/apologetics-data.js', 'js/apologetics-objections.js'];
function isFreshCode(url) {
  return FRESH_CODE.some(function (p) { return url.pathname.endsWith('/' + p) || url.pathname === '/' + p; });
}

/* The minimum needed to boot the app offline. Dynamically-loaded files
   (xref-data.js, lang/*.js) and Google Fonts are cached at runtime the first
   time they're used, so they're available offline afterwards too. */
var CORE = [
  './',
  'index.html',
  'css/style.css',
  'js/config.js',
  'js/i18n.js',
  'js/apologetics-data.js',
  'js/apologetics-objections.js',
  'js/app.js',
  'manifest.webmanifest'
];

/* ---- install: precache the shell, then take over immediately ---- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // {cache:'reload'} bypasses the HTTP cache so we precache fresh copies
      return Promise.all(CORE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { /* skip a miss */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

/* ---- activate: drop old caches, claim open pages ---- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* ---- fetch: how each request is served ---- */
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;                       // POST API calls go straight to network

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  // Never intercept the n8n backend — those answers must stay fresh (and the
  // page handles offline failures itself).
  if (!sameOrigin && /n8n|hstgr\.cloud/.test(url.hostname)) return;

  // Page navigations: network-first so a new deploy always wins; fall back to
  // the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('index.html').then(function (m) { return m || caches.match('./'); });
      })
    );
    return;
  }

  // The app's own code: network-first so a new deploy always wins online, with
  // the cached copy as the offline fallback.
  if (sameOrigin && isFreshCode(url)) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // Same-origin assets + Google Fonts: stale-while-revalidate — serve the cache
  // instantly, refresh it in the background.
  var isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (sameOrigin || isFont) {
    event.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          var net = fetch(req).then(function (res) {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(function () { return hit; });
          return hit || net;
        });
      })
    );
  }
});

/* ---- push reminders (n8n reminder workflow) ---- */
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  var title = data.title || 'The Gospel Pursuit';
  var options = {
    body: data.body || 'Time to spend a moment in the Word.',
    tag: data.tag || 'daily-reminder',
    renotify: true,
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Tapping the notification focuses an open tab or opens the app. */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
