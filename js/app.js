(function () {
  'use strict';

  /* ---------- lightweight error capture ----------
     No third-party monitoring service, so instead we keep the last few runtime
     errors in a small on-device ring buffer and quietly attach them to any
     "report a problem" a reader chooses to send. That turns silent breakage into
     something the team can actually see, without shipping anyone's data to an
     ad/telemetry vendor. Purely additive: capped, best-effort, never throws. */
  var APP_VERSION = 'tgp-cache-v26';
  var ERRLOG_KEY = 'tgp.errlog';
  var ERRLOG_MAX = 15;
  function logAppError(kind, message, extra) {
    try {
      var buf = [];
      try { buf = JSON.parse(window.localStorage.getItem(ERRLOG_KEY) || '[]'); } catch (e) { buf = []; }
      if (!Array.isArray(buf)) buf = [];
      buf.push({
        at: new Date().toISOString(), kind: kind,
        msg: String(message || '').slice(0, 300),
        where: String(extra || '').slice(0, 200)
      });
      while (buf.length > ERRLOG_MAX) buf.shift();
      window.localStorage.setItem(ERRLOG_KEY, JSON.stringify(buf));
    } catch (e) { /* storage blocked or full — never let logging break the app */ }
  }
  // a compact diagnostics blob to ride along with a user-submitted report
  function errorDiagnostics() {
    var out = { version: APP_VERSION, ua: '', lang: '', errors: [] };
    try { out.ua = navigator.userAgent || ''; } catch (e) {}
    try { out.lang = currentLang || ''; } catch (e) {}
    try { out.errors = JSON.parse(window.localStorage.getItem(ERRLOG_KEY) || '[]'); } catch (e) {}
    return out;
  }
  window.addEventListener('error', function (ev) {
    logAppError('error', ev && ev.message, ev && ev.filename ? (ev.filename + ':' + ev.lineno) : '');
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var reason = ev && ev.reason;
    logAppError('promise', reason && reason.message ? reason.message : reason, '');
  });

  var rays = document.getElementById('rays');
  var loadingScreen = document.getElementById('loading-screen');
  var appShell = document.getElementById('app-shell');
  var enterBtn = document.getElementById('enter-app');
  var cta = enterBtn.closest('.brand-cta');

  /* ---------- language ---------- */

  var LANG_KEY = 'tgp.language';
  var DEFAULT_LANG = 'en';
  // resolved up front: the loading screen is translated before the app shell exists
  var currentLang = initialLanguage();

  function isSupported(code) {
    return LANGUAGES.some(function (lang) {
      return lang.code === code;
    });
  }

  function languageMeta(code) {
    for (var i = 0; i < LANGUAGES.length; i++) {
      if (LANGUAGES[i].code === code) return LANGUAGES[i];
    }
    return LANGUAGES[0];
  }

  /* A saved choice wins; otherwise fall back to the browser's own preference.
     Regional tags are tried whole before being cut back to the base language,
     so zh-TW lands on Traditional rather than collapsing to Simplified. */
  function initialLanguage() {
    try {
      var saved = window.localStorage.getItem(LANG_KEY);
      if (saved && isSupported(saved)) return saved;
    } catch (err) {
      /* storage blocked — carry on with the browser hint */
    }
    var hints = (navigator.languages || [navigator.language || '']);
    for (var i = 0; i < hints.length; i++) {
      var hint = String(hints[i]);
      var regional = hint.split('-');
      var full = regional[0].toLowerCase() + (regional[1] ? '-' + regional[1].toUpperCase() : '');
      if (isSupported(full)) return full;
      if (isSupported(regional[0].toLowerCase())) return regional[0].toLowerCase();
    }
    return DEFAULT_LANG;
  }

  // English backs every key, so a gap in a translation shows English rather than nothing
  function t(key, vars) {
    var table = TRANSLATIONS[currentLang] || {};
    var text = table[key];
    if (text === undefined) text = TRANSLATIONS[DEFAULT_LANG][key];
    if (text === undefined) return key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.split('{' + name + '}').join(vars[name]);
      });
    }
    return text;
  }

  function applyTranslations() {
    var meta = languageMeta(currentLang);
    document.documentElement.lang = currentLang;
    document.documentElement.dir = meta.dir || 'ltr';
    document.title = t('app.title');

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });

    document.getElementById('nav-language-code').textContent = currentLang.toUpperCase();
    renderLanguageOptions();
    renderBibleBrowser();
    renderPlans();
    // keep an open plan's day list and labels in step with the language
    if (currentPlan && !document.getElementById('plan-detail').hidden) openPlan(currentPlan);
    renderApologetics();
    renderTips();
    renderProgressUI();
    renderNotifUI();
    renderTodayHeader();
    updateSaveButton();
    if (!document.getElementById('notif-panel').hidden) renderNotifList();
    retranslateForms();
  }

  function renderLanguageOptions() {
    var grid = document.getElementById('language-grid');
    grid.textContent = '';

    LANGUAGES.forEach(function (lang) {
      var option = document.createElement('button');
      option.type = 'button';
      option.className = 'language-option';
      option.setAttribute('role', 'radio');
      option.setAttribute('aria-checked', String(lang.code === currentLang));
      option.dataset.lang = lang.code;

      var native = document.createElement('span');
      native.className = 'language-native';
      native.textContent = lang.native;
      // a native name in an RTL script needs its own direction inside an LTR page
      if (lang.dir) native.setAttribute('dir', lang.dir);
      option.appendChild(native);

      var english = document.createElement('span');
      english.className = 'language-english';
      english.textContent = lang.english;
      option.appendChild(english);

      if (lang.code === currentLang) {
        var check = document.createElement('span');
        check.className = 'language-check';
        check.textContent = '✓ ' + t('language.current');
        option.appendChild(check);
      }

      option.addEventListener('click', function () {
        setLanguage(lang.code, true);
      });
      grid.appendChild(option);
    });
  }

  function setLanguage(code, announce) {
    if (!isSupported(code)) return Promise.resolve();
    var changed = code !== currentLang;
    var status = document.getElementById('language-status');

    if (changed && announce) setStatus(status, t('language.loading'), false);

    // the table is fetched before anything re-renders, so the UI never flashes English
    return TGPi18n.load(code).then(function () {
      currentLang = code;

      try {
        window.localStorage.setItem(LANG_KEY, code);
      } catch (err) {
        /* the choice still holds for this page view */
      }

      applyTranslations();

      if (announce) {
        setStatus(status, t('language.saved', { name: languageMeta(code).native }), false);
      }
      // results already on screen are in the old language; ask for them again
      if (changed && !appShell.hidden) {
        clearResults();
        loadDailyVerse();
        if (bibleState.screen === 'reader') loadChapter();
      }
    });
  }

  function clearResults() {
    ['search-result', 'devotional-result', 'apologetics-result'].forEach(function (id) {
      document.getElementById(id).hidden = true;
    });
    document.getElementById('bible-verses').textContent = '';
    ['bible-status', 'search-status', 'devotional-status', 'apologetics-status'].forEach(function (id) {
      setStatus(document.getElementById(id), '', false);
    });
  }

  /* ---------- settings ---------- */

  /* Per-feature preferences. These ride along on every backend call so the
     server can honour them; they live on the device, not the account, so
     nothing here needs a database. */
  var SETTINGS_KEY = 'tgp.settings';
  // dropdown preferences (string-valued)
  var SETTING_FIELDS = {
    'setting-version': { name: 'version', fallback: '' },
    'setting-font-size': { name: 'fontSize', fallback: 'medium' },
    'setting-search-context': { name: 'searchContext', fallback: 'verse' },
    'setting-devotional-length': { name: 'devotionalLength', fallback: 'medium' },
    'setting-plan-pace': { name: 'planPace', fallback: 'steady' },
    'setting-apologetics-tone': { name: 'apologeticsTone', fallback: 'gentle' },
    'setting-bible-difficulty': { name: 'bibleDifficulty', fallback: 'intermediate' }
  };

  // on/off preferences (boolean-valued)
  var TOGGLE_FIELDS = {
    'setting-red-letters': { name: 'redLetters', fallback: false },
    'setting-verse-picker': { name: 'showVersePicker', fallback: true },
    'setting-progress-bar': { name: 'showProgressBar', fallback: true },
    'setting-bible-accuracy': { name: 'bibleAccuracy', fallback: true },
    'setting-bible-sources': { name: 'bibleSources', fallback: false },
    'setting-notes-autosave': { name: 'annotationsAutosave', fallback: true }
  };

  var settings = loadSettings();

  function loadSettings() {
    var stored = {};
    try {
      stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY)) || {};
    } catch (err) {
      /* unreadable or blocked — every field falls back below */
    }
    Object.keys(SETTING_FIELDS).forEach(function (id) {
      var field = SETTING_FIELDS[id];
      if (typeof stored[field.name] !== 'string') stored[field.name] = field.fallback;
    });
    Object.keys(TOGGLE_FIELDS).forEach(function (id) {
      var field = TOGGLE_FIELDS[id];
      if (typeof stored[field.name] !== 'boolean') stored[field.name] = field.fallback;
    });
    return stored;
  }

  function persistSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      /* the choice still holds for this page view */
    }
  }

  function wireSettings() {
    var status = document.getElementById('settings-status');

    Object.keys(SETTING_FIELDS).forEach(function (id) {
      var select = document.getElementById(id);
      var field = SETTING_FIELDS[id];

      if (settings[field.name]) select.value = settings[field.name];

      select.addEventListener('change', function () {
        settings[field.name] = select.value;
        persistSettings();
        onSettingChanged(field.name);
        setStatus(status, t('settings.saved'), false);
      });
    });

    Object.keys(TOGGLE_FIELDS).forEach(function (id) {
      var box = document.getElementById(id);
      var field = TOGGLE_FIELDS[id];

      box.checked = Boolean(settings[field.name]);

      box.addEventListener('change', function () {
        settings[field.name] = box.checked;
        persistSettings();
        onSettingChanged(field.name);
        setStatus(status, t('settings.saved'), false);
      });
    });
  }

  // a preference changed: repaint the reader, and refetch if the version moved
  function onSettingChanged(name) {
    applyReadingPrefs();
    if (name === 'devotionalLength' && devoLengthPaint) devoLengthPaint();
    if (name === 'version') {
      renderVersionOptions();
      if (bibleState.screen === 'reader') {
        loadChapter();
      } else if (bibleState.screen === 'verse') {
        // reload the chapter in the new version but stay on this verse
        bibleState.focusAfterLoad = 'keep';
        loadChapter();
      }
    }
  }

  /* Font size, red-letter, verse-picker and progress-bar preferences all show up
     in the reader; this keeps its DOM in step with the saved choices. */
  function applyReadingPrefs() {
    var verses = document.getElementById('bible-verses');
    if (verses) {
      ['small', 'medium', 'large', 'xlarge'].forEach(function (size) {
        verses.classList.toggle('reader-font-' + size, (settings.fontSize || 'medium') === size);
      });
      verses.classList.toggle('red-letters', Boolean(settings.redLetters));
    }
    var jump = document.getElementById('bible-verse-jump');
    if (jump) jump.hidden = !settings.showVersePicker;

    var progress = document.getElementById('bible-progress');
    if (progress) {
      var showBar = settings.showProgressBar &&
        bibleState.screen === 'reader' &&
        document.getElementById('view-bible').classList.contains('is-active');
      progress.hidden = !showBar;
    }
    updateReadingProgress();
  }

  /* ---------- loading screen ---------- */

  // the button is only offered once its fade-up has finished playing
  cta.addEventListener('animationend', function () {
    enterBtn.disabled = false;
  });

  enterBtn.addEventListener('click', openApp);

  /* ---------- entering the app ---------- */

  var appOpen = false;

  function openApp() {
    if (appOpen) return;
    appOpen = true;

    loadingScreen.hidden = true;
    rays.hidden = true;
    appShell.hidden = false;
    renderTodayHeader();
    decorateExploreCards();
    updateBetaBadge();
    loadDailyVerse();
    checkBadges();        // register any badges already earned before this update
    renderProgressUI();
    renderNotifUI();
  }

  /* Public-domain artwork (Wikimedia) for the Today tab's Explore cards, keyed
     by the view each card opens. Added as a hero image atop the card; if one
     fails to load, the card falls back to its plain icon layout. */
  var EXPLORE_PHOTOS = {
    bible: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Gutenberg_Bible%2C_Lenox_Copy%2C_New_York_Public_Library%2C_2009._Pic_01.jpg/330px-Gutenberg_Bible%2C_Lenox_Copy%2C_New_York_Public_Library%2C_2009._Pic_01.jpg',
    devotional: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/JEAN-FRAN%C3%87OIS_MILLET_-_El_%C3%81ngelus_%28Museo_de_Orsay%2C_1857-1859._%C3%93leo_sobre_lienzo%2C_55.5_x_66_cm%29.jpg/330px-JEAN-FRAN%C3%87OIS_MILLET_-_El_%C3%81ngelus_%28Museo_de_Orsay%2C_1857-1859._%C3%93leo_sobre_lienzo%2C_55.5_x_66_cm%29.jpg',
    apologetics: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/V%26A_-_Raphael%2C_St_Paul_Preaching_in_Athens_%281515%29.jpg/330px-V%26A_-_Raphael%2C_St_Paul_Preaching_in_Athens_%281515%29.jpg',
    search: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Aleppo_Codex_Joshua_1_1.jpg/330px-Aleppo_Codex_Joshua_1_1.jpg',
    plans: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Meester_van_Catharina_van_Kleef_-_Getijdenboek_van_de_Meester_van_Catharina_van_Kleef4.jpg/330px-Meester_van_Catharina_van_Kleef_-_Getijdenboek_van_de_Meester_van_Catharina_van_Kleef4.jpg',
    tips: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/The_Baptism_of_Christ_%28Verrocchio_and_Leonardo%29.jpg/330px-The_Baptism_of_Christ_%28Verrocchio_and_Leonardo%29.jpg'
  };
  function decorateExploreCards() {
    document.querySelectorAll('.explore-card').forEach(function (card) {
      if (card.dataset.photoDone) return;
      var src = EXPLORE_PHOTOS[card.dataset.view];
      if (!src) return;
      card.dataset.photoDone = '1';
      var fig = el('span', 'explore-photo');
      var im = document.createElement('img');
      im.src = src; im.alt = ''; im.loading = 'lazy'; im.setAttribute('aria-hidden', 'true');
      im.onerror = function () { card.classList.remove('has-photo'); if (fig.parentNode) fig.parentNode.removeChild(fig); };
      fig.appendChild(im);
      card.insertBefore(fig, card.firstChild);
      card.classList.add('has-photo');
    });
  }

  /* ---------- view routing ---------- */

  // Tabs deferred past the first beta: their full views still exist in the DOM
  // (nothing was deleted), but selecting them shows a "coming soon" sign instead
  // of running their heavy renders. Remove a name here to switch a tab back on.
  var SOON_VIEWS = { apologetics: 'The Road to Apologetics', crossref: 'Cross-references', messianic: 'Messianic prophecy' };

  function showView(name) {
    if (SOON_VIEWS.hasOwnProperty(name)) {
      document.querySelectorAll('.view').forEach(function (section) {
        section.classList.toggle('is-active', section.id === 'view-soon');
      });
      document.querySelectorAll('.nav-link').forEach(function (link) {
        link.classList.toggle('is-active', link.dataset.view === name);
      });
      var sub = document.getElementById('soon-sub');
      if (sub) sub.textContent = t('soon.subNamed', { name: SOON_VIEWS[name] });
      closeSidebar();
      window.scrollTo(0, 0);
      return;
    }
    document.querySelectorAll('.view').forEach(function (section) {
      section.classList.toggle('is-active', section.id === 'view-' + name);
    });
    document.querySelectorAll('.nav-link').forEach(function (link) {
      link.classList.toggle('is-active', link.dataset.view === name);
    });
    // entering the Bible always starts back at the two testaments
    if (name === 'bible') resetBibleBrowser();
    // any narration stops when you leave the Bible
    if (name !== 'bible' && typeof bibleAudio !== 'undefined') bibleAudio.reset();
    // entering Bible plans always starts at the plan chooser
    if (name === 'plans') showPlansScreen('grid');
    // entering the Road always opens on the world map
    if (name === 'apologetics') { apoloStage = null; renderApologetics(); }
    // the timeline and definitions build their static content on first view
    if (name === 'timeline') { renderDetailedTimeline(); renderBibleTimeline(); }
    if (name === 'definitions') { renderCommonTerms(); renderDefAdmin(); loadGlobalDefs().then(function () { renderCommonTerms(); }); }
    if (name === 'admin') renderAdminView();
    if (name === 'devotional') renderMyDevotionals();
    if (name === 'progress') renderReadingProgress();
    if (name === 'messianic') renderMessianic();
    if (name === 'beta') renderBeta();
    // the cross-reference arc diagram loads its data on first view
    if (name === 'crossref') xrefViz.open();
    // the badge collection is huge — build it only when its tab is opened
    if (name === 'badges') renderBadgeGrid();
    // keep the fixed progress bar from lingering over other views
    applyReadingPrefs();
    closeSidebar();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('.nav-link, .feature-card, .explore-card, .dash-badges-link, .footer-link, .soon-back, .settings-link-btn, .badges-back').forEach(function (el) {
    el.addEventListener('click', function () {
      if (el.dataset.view) showView(el.dataset.view);
    });
  });

  /* ---------- sidebar drawer (narrow screens only) ---------- */

  var sidebar = document.getElementById('sidebar');
  var sidebarToggle = document.getElementById('sidebar-toggle');
  var sidebarScrim = document.getElementById('sidebar-scrim');

  function setSidebar(open) {
    sidebar.classList.toggle('is-open', open);
    sidebarScrim.hidden = !open;
    sidebarToggle.setAttribute('aria-expanded', String(open));
  }
  function closeSidebar() {
    setSidebar(false);
  }

  sidebarToggle.addEventListener('click', function () {
    setSidebar(!sidebar.classList.contains('is-open'));
  });
  sidebarScrim.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeSidebar();
  });

  /* ---------- backend ---------- */

  function endpoint(path) {
    return N8N_BASE_URL.replace(/\/+$/, '') + '/' + path;
  }

  // every call carries the chosen language and preferences so the backend answers in kind
  function request(path, body) {
    var url = endpoint(path);
    var options;

    if (body) {
      var payload = {};
      Object.keys(body).forEach(function (key) {
        payload[key] = body[key];
      });
      payload.language = currentLang;
      payload.languageName = languageMeta(currentLang).english;
      payload.settings = settings;
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      };
    } else {
      url += '?language=' + encodeURIComponent(currentLang);
      options = { method: 'GET' };
    }

    return fetch(url, options).then(
      function (res) {
        if (!res.ok) throw new Error(t('error.serverStatus', { status: res.status }));
        return res.json();
      },
      function () {
        throw new Error(t('error.server'));
      }
    );
  }

  function setStatus(el, message, isError) {
    el.textContent = message;
    el.classList.toggle('is-error', Boolean(isError));
  }

  /* Tidy AI-written text before it's shown. The model sometimes formats with
     Markdown headings (#, ##) or hashtags (#faith); since we render as plain
     text those markers would show literally, so strip them everywhere. */
  function cleanAIText(str) {
    if (!str) return '';
    return String(str)
      // drop markdown heading markers at the start of a line: "## Title" -> "Title"
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      // drop hashtags like "#Faith" or " #hope" but keep the word
      .replace(/(^|[\s(])#(?=[^\s#])/g, '$1')
      // clean up any lone "#" tokens left behind
      .replace(/(^|\s)#+(?=\s|$)/g, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  // set once the devotional-length chips are wired, so Settings can re-sync them
  var devoLengthPaint = null;

  /* ---------- generation cache ----------
     The expandable panels ("drop-downs") each ask the backend to generate
     reference content — a chapter guide, a verse's context, a quiz, and so on.
     That content is the same every time, so we memoise it: identical calls share
     a single in-flight promise (no duplicate work when you hover then click) and,
     once resolved, the panel reopens instantly. The key includes the language and
     settings, so changing either regenerates. Failures are not cached, so the
     next open retries cleanly. */
  var genCache = {};
  function genKey(path, body) {
    return path + '|' + currentLang + '|' + JSON.stringify(settings) + '|' + JSON.stringify(body || {});
  }

  /* Persist resolved answers so a panel you've opened before reappears instantly
     — even after a reload or with no connection. Only deterministic reference
     content flows through requestCached (chapter guides, verse context, book &
     chapter insights, quizzes, apologetics prep), so it's safe to store. The
     store is capped and keyed by language + settings + request, so changing any
     of those regenerates and stale content never leaks across them. */
  var GEN_STORE_KEY = 'tgp.genCache.v1';
  var GEN_STORE_MAX = 240;          // most-recent N answers kept (localStorage is ~5MB)
  var genStore = null;              // lazy-loaded { key: { v: data, t: savedAt } }
  function genStoreLoad() {
    if (genStore) return genStore;
    try { genStore = JSON.parse(window.localStorage.getItem(GEN_STORE_KEY)) || {}; }
    catch (e) { genStore = {}; }
    if (!genStore || typeof genStore !== 'object') genStore = {};
    return genStore;
  }
  function genStoreSave() {
    var s = genStoreLoad(), keys = Object.keys(s);
    if (keys.length > GEN_STORE_MAX) {
      keys.sort(function (a, b) { return (s[a].t || 0) - (s[b].t || 0); });  // oldest first
      keys.slice(0, keys.length - GEN_STORE_MAX).forEach(function (k) { delete s[k]; });
    }
    try { window.localStorage.setItem(GEN_STORE_KEY, JSON.stringify(s)); } catch (e) { /* quota — skip */ }
  }
  function genStoreGet(key) { var e = genStoreLoad()[key]; return e ? e.v : undefined; }
  function genStorePut(key, value) { genStoreLoad()[key] = { v: value, t: Date.now() }; genStoreSave(); }
  // don't cache an empty 200 (means "endpoint not wired yet") — it would stick
  function isStorable(data) {
    if (data == null) return false;
    if (typeof data === 'string') return data.trim() !== '';
    if (Array.isArray(data)) return data.length > 0;
    if (typeof data === 'object') return Object.keys(data).length > 0;
    return true;
  }

  function requestCached(path, body) {
    var key = genKey(path, body);
    if (genCache[key]) return genCache[key];
    // a persisted answer resolves instantly and needs no network
    var stored = genStoreGet(key);
    if (stored !== undefined) {
      var hit = Promise.resolve(stored);
      genCache[key] = hit;
      return hit;
    }
    var p = request(path, body).then(function (data) {
      if (isStorable(data)) genStorePut(key, data);   // remember for next time
      return data;
    }, function (err) {
      delete genCache[key];   // let the next open try again
      throw err;
    });
    genCache[key] = p;
    return p;
  }

  /* ---------- admin content (global, key-gated) ----------
     A single always-active n8n workflow ("admin-content") is a shared store:
     the owner types maps, archaeology, chapter FAQs and definitions in the
     Admin view and they reach every visitor. Reads are public; writes carry a
     secret admin key the owner enters once (kept only on their device). The same
     endpoint also receives "report a problem" submissions. */
  var ADMIN_KEY_LS = 'tgp.adminKey';
  function adminKey() { try { return window.localStorage.getItem(ADMIN_KEY_LS) || ''; } catch (e) { return ''; } }
  function setAdminKeyStored(k) { try { window.localStorage.setItem(ADMIN_KEY_LS, k || ''); } catch (e) { /* ignore */ } }
  function isAdminUnlocked() { return !!adminKey(); }

  var adminCache = {};
  function adminList(type, scope) {
    var key = (type || '') + '|' + (scope || '');
    if (adminCache[key]) return adminCache[key];
    var p = request('admin-content', { action: 'list', type: type, scope: scope })
      .then(function (d) { return (d && Array.isArray(d.items)) ? d.items : []; },
            function () { return []; });
    adminCache[key] = p;
    return p;
  }
  function adminInvalidate() { adminCache = {}; }
  function adminWrite(action, item) {
    return request('admin-content', { action: action, key: adminKey(), item: item });
  }
  function adminReport(payload) {
    var body = { action: 'report' };
    Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
    return request('admin-content', body);
  }

  /* A stable, non-identifying id for this device. It lets the server route a
     notification (an admin broadcast, a reply to a report) back to the right
     person's in-app feed without needing an account. Random, kept on-device. */
  var DEVICE_ID_LS = 'tgp.deviceId';
  function deviceId() {
    try {
      var id = window.localStorage.getItem(DEVICE_ID_LS);
      if (!id) {
        id = 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        window.localStorage.setItem(DEVICE_ID_LS, id);
      }
      return id;
    } catch (e) { return ''; }
  }
  // the signed-in Clerk account, when present, gives us a real name + email
  function clerkUser() {
    try { return (window.Clerk && window.Clerk.user) || null; } catch (e) { return null; }
  }
  function signedInEmail() {
    var u = clerkUser();
    try { return (u && u.primaryEmailAddress && u.primaryEmailAddress.emailAddress) || ''; }
    catch (e) { return ''; }
  }
  function signedInName() {
    var u = clerkUser();
    return { first: (u && u.firstName) || '', last: (u && u.lastName) || '' };
  }

  /* Server-sent notifications (admin broadcasts / replies) are pulled for this
     device + signed-in email and merged into the same on-device feed the app
     already shows. Each carries a server id ("sid") so re-fetching never
     duplicates. Called on load and whenever the notification panel opens. */
  var serverNotifsBusy = false;
  function syncServerNotifs() {
    if (serverNotifsBusy) return Promise.resolve();
    serverNotifsBusy = true;
    return request('admin-content', { action: 'notifs', deviceId: deviceId(), email: signedInEmail() })
      .then(function (d) {
        var items = (d && Array.isArray(d.items)) ? d.items : [];
        if (!items.length) return;
        var p = loadProgress();
        if (!Array.isArray(p.notifs)) p.notifs = [];
        var have = {};
        p.notifs.forEach(function (n) { if (n.sid) have[n.sid] = true; });
        var added = 0;
        items.forEach(function (it) {
          if (!it || !it.sid || have[it.sid]) return;
          p.notifs.unshift({
            id: 'srv-' + it.sid, sid: it.sid,
            type: it.type || 'message',
            title: it.title || '', body: it.body || '',
            ts: it.ts || Date.now(), read: false
          });
          added++;
        });
        if (added) {
          p.notifs.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
          if (p.notifs.length > 40) p.notifs = p.notifs.slice(0, 40);
          saveProgress(p);
          renderNotifUI();
          if (!document.getElementById('notif-panel').hidden) renderNotifList();
        }
      })
      .catch(function () { /* offline / not wired yet — ignore */ })
      .then(function () { serverNotifsBusy = false; });
  }
  // global (owner-published) definitions, merged into the on-device list below
  var globalDefs = [];
  var globalDefsLoaded = false;
  function loadGlobalDefs(force) {
    if (globalDefsLoaded && !force) return Promise.resolve(globalDefs);
    if (force) adminInvalidate();
    return adminList('definition').then(function (items) {
      globalDefs = items.map(function (it) {
        return {
          term: it.term || it.scope || '', def: it.definition || it.def || '', cat: it.group || 'vocab',
          pron: it.pron || '', meaning: it.meaning || '', photos: normPhotos(it.photos),
          firstApp: it.firstApp || '', father: it.father || '', mother: it.mother || '',
          siblings: it.siblings || '', children: it.children || '',
          author: it.author || ''
        };
      }).filter(function (d) { return d.term && (d.def || d.meaning); });
      globalDefsLoaded = true;
      return globalDefs;
    });
  }
  // the on-device custom definitions plus the owner's globally published ones
  function allCustomDefs() { return loadCustomDefs().concat(globalDefs); }

  /* Warm a drop-down before it opens: the moment the pointer or keyboard focus
     lands on it, kick off its generation so the content is ready (or already on
     its way) by the time it expands. Safe to call repeatedly — the cache de-dupes
     and each loader guards its own state. `trigger` does the actual warming. */
  function warmOnIntent(el, trigger) {
    if (!el || el.dataset.warmed) return;
    el.dataset.warmed = '1';
    var target = el.querySelector('summary') || el;
    var warm = function () { try { trigger(); } catch (e) { /* best effort */ } };
    target.addEventListener('pointerenter', warm);
    target.addEventListener('focusin', warm);
    target.addEventListener('touchstart', warm, { passive: true });
    // pointerdown fires a beat before click — so even a straight tap (no hover,
    // as on touch) kicks off generation before the panel opens
    target.addEventListener('pointerdown', warm);
    target.addEventListener('mousedown', warm);
  }

  /* ---------- verse of the day ---------- */

  // the verse currently on screen, so Save/Share have something to act on
  var currentVerse = { text: '', reference: '' };

  function renderVerse(text, reference) {
    var quote = document.getElementById('verse-quote');
    var trimmed = (text || '').trim();
    currentVerse = { text: trimmed, reference: (reference || '').trim() };
    quote.textContent = '';

    if (trimmed) {
      var cap = document.createElement('span');
      cap.className = 'dropcap';
      cap.textContent = trimmed.charAt(0);
      quote.appendChild(cap);
      quote.appendChild(document.createTextNode(trimmed.slice(1)));
    } else {
      quote.textContent = t('home.verseUnavailable');
    }

    document.getElementById('verse-ref').textContent = reference || '';
    updateSaveButton();
  }

  function loadDailyVerse() {
    document.getElementById('verse-quote').textContent = t('home.verseLoading');
    document.getElementById('verse-ref').textContent = '';
    request('daily-verse')
      .then(function (data) {
        renderVerse(data.text, data.reference);
      })
      .catch(function () {
        renderVerse('', '');
      });
  }

  /* ---------- saved verses (local) + share ---------- */

  var SAVED_KEY = 'tgp.savedVerses';
  function loadSaved() {
    try { return JSON.parse(window.localStorage.getItem(SAVED_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveSaved(list) {
    try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch (e) { /* view-only */ }
  }
  // a verse is identified by its reference; the daily verse rarely lacks one
  function savedVerseKey(v) { return (v.reference || v.text || '').trim(); }
  function isVerseSaved(v) {
    var key = savedVerseKey(v);
    return !!key && loadSaved().some(function (s) { return savedVerseKey(s) === key; });
  }
  function updateSaveButton() {
    var btn = document.getElementById('verse-save');
    if (!btn) return;
    var has = currentVerse.text && currentVerse.reference;
    btn.disabled = !has;
    var saved = has && isVerseSaved(currentVerse);
    btn.classList.toggle('is-done', !!saved);
    btn.textContent = t(saved ? 'home.saved' : 'home.save');
  }
  function toggleSaveVerse() {
    if (!currentVerse.text) return;
    var list = loadSaved();
    var key = savedVerseKey(currentVerse);
    var at = -1;
    for (var i = 0; i < list.length; i++) { if (savedVerseKey(list[i]) === key) { at = i; break; } }
    if (at === -1) list.unshift({ text: currentVerse.text, reference: currentVerse.reference, savedAt: Date.now() });
    else list.splice(at, 1);
    saveSaved(list);
    updateSaveButton();
  }
  function shareVerse() {
    if (!currentVerse.text) return;
    var quote = '“' + currentVerse.text + '”';
    var body = currentVerse.reference ? quote + ' — ' + currentVerse.reference : quote;
    if (navigator.share) {
      navigator.share({ text: body, title: 'The Gospel Pursuit' }).catch(function () { /* dismissed */ });
      return;
    }
    var btn = document.getElementById('verse-share');
    var restore = function () { if (btn) btn.textContent = t('home.share'); };
    var flash = function () { if (btn) { btn.textContent = t('home.copied'); setTimeout(restore, 1600); } };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(body).then(flash, restore);
    }
  }

  /* ---------- theme (dark / light) ---------- */

  var THEME_KEY = 'tgp.theme';
  function currentTheme() {
    try {
      var s = window.localStorage.getItem(THEME_KEY);
      return (s === 'light' || s === 'dark') ? s : 'dark';
    } catch (e) { return 'dark'; }
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { window.localStorage.setItem(THEME_KEY, theme); } catch (e) { /* view-only */ }
    document.querySelectorAll('[data-theme-choice]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.themeChoice === theme));
    });
  }

  /* ---------- Today header: date + greeting ---------- */

  function renderTodayHeader() {
    var now = new Date();
    var dateEl = document.getElementById('today-date');
    if (dateEl) {
      try {
        dateEl.textContent = now.toLocaleDateString(currentLang, { weekday: 'long', month: 'long', day: 'numeric' });
      } catch (e) {
        dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      }
    }
    var greetEl = document.getElementById('today-greeting');
    if (greetEl) {
      var h = now.getHours();
      var key = h < 12 ? 'home.greetingMorning' : (h < 18 ? 'home.greetingAfternoon' : 'home.greetingEvening');
      greetEl.setAttribute('data-i18n', key); // keeps it right across a language switch
      greetEl.textContent = t(key);
    }
  }

  /* ---------- Your Walk: 7-day strip + encouragement ---------- */

  function renderWalkWeek() {
    var wrap = document.getElementById('walk-week');
    if (!wrap) return;
    var p = loadProgress();
    wrap.textContent = '';

    var today = new Date(); today.setHours(0, 0, 0, 0);
    var todayMs = today.getTime();
    // start the strip on Monday, matching the design (M T W T F S S)
    var dow = today.getDay();               // 0 Sun … 6 Sat
    var toMonday = (dow === 0 ? -6 : 1 - dow);
    var monday = new Date(today); monday.setDate(today.getDate() + toMonday);

    // the streak covers the p.streak consecutive days ending on p.lastDay
    var firstMs = null, lastMs = null;
    if (p.lastDay && p.streak > 0) {
      var ld = new Date(p.lastDay + 'T00:00:00'); ld.setHours(0, 0, 0, 0);
      lastMs = ld.getTime();
      var fd = new Date(ld); fd.setDate(ld.getDate() - (p.streak - 1));
      firstMs = fd.getTime();
    }

    for (var i = 0; i < 7; i++) {
      var d = new Date(monday); d.setDate(monday.getDate() + i);
      var ms = d.getTime();
      var cell = el('div', 'walk-day');
      var label;
      try { label = d.toLocaleDateString(currentLang, { weekday: 'narrow' }); }
      catch (e) { label = d.toLocaleDateString(undefined, { weekday: 'narrow' }); }
      cell.appendChild(txt('span', 'walk-day-label', label));
      cell.appendChild(el('span', 'walk-day-dot'));

      var isFuture = ms > todayMs;
      var isDone = firstMs !== null && !isFuture && ms >= firstMs && ms <= lastMs;
      if (isDone) cell.classList.add('is-done');
      if (ms === todayMs) cell.classList.add('is-today');
      wrap.appendChild(cell);
    }
  }

  function renderWalkEncourage() {
    var msgEl = document.getElementById('walk-encourage');
    if (!msgEl) return;
    var p = loadProgress();
    if (!p.streak) msgEl.textContent = t('home.walkNew');
    else if (p.streak === 1) msgEl.textContent = t('home.walkDay1');
    else msgEl.textContent = t('home.walkStreak', { n: p.streak });
  }

  function renderExploreApoloTag() {
    var tag = document.getElementById('explore-apolo-level');
    if (!tag) return;
    var c = apoloCounts();
    if (c.done > 0) {
      tag.hidden = false;
      tag.textContent = t('apologetics.levelLabel', { n: c.done });
    } else {
      tag.hidden = true;
    }
  }

  /* ---------- the bible ---------- */

  /* Placeholder until GET /bible-books lands: the canon with a chapter count
     per book, so the browser (testament -> book -> chapter) works offline.
     The endpoint will return this same shape already localised; only the
     testament labels are keys, because the book names arrive translated too.
     The chapter *text* still comes from the backend, per chapter opened. */
  var BIBLE_BOOKS = [
    {
      testamentKey: 'bible.oldTestament',
      books: [
        { name: 'Genesis', chapters: 50 }, { name: 'Exodus', chapters: 40 },
        { name: 'Leviticus', chapters: 27 }, { name: 'Numbers', chapters: 36 },
        { name: 'Deuteronomy', chapters: 34 }, { name: 'Joshua', chapters: 24 },
        { name: 'Judges', chapters: 21 }, { name: 'Ruth', chapters: 4 },
        { name: '1 Samuel', chapters: 31 }, { name: '2 Samuel', chapters: 24 },
        { name: '1 Kings', chapters: 22 }, { name: '2 Kings', chapters: 25 },
        { name: '1 Chronicles', chapters: 29 }, { name: '2 Chronicles', chapters: 36 },
        { name: 'Ezra', chapters: 10 }, { name: 'Nehemiah', chapters: 13 },
        { name: 'Esther', chapters: 10 }, { name: 'Job', chapters: 42 },
        { name: 'Psalms', chapters: 150 }, { name: 'Proverbs', chapters: 31 },
        { name: 'Ecclesiastes', chapters: 12 }, { name: 'Song of Solomon', chapters: 8 },
        { name: 'Isaiah', chapters: 66 }, { name: 'Jeremiah', chapters: 52 },
        { name: 'Lamentations', chapters: 5 }, { name: 'Ezekiel', chapters: 48 },
        { name: 'Daniel', chapters: 12 }, { name: 'Hosea', chapters: 14 },
        { name: 'Joel', chapters: 3 }, { name: 'Amos', chapters: 9 },
        { name: 'Obadiah', chapters: 1 }, { name: 'Jonah', chapters: 4 },
        { name: 'Micah', chapters: 7 }, { name: 'Nahum', chapters: 3 },
        { name: 'Habakkuk', chapters: 3 }, { name: 'Zephaniah', chapters: 3 },
        { name: 'Haggai', chapters: 2 }, { name: 'Zechariah', chapters: 14 },
        { name: 'Malachi', chapters: 4 }
      ]
    },
    {
      testamentKey: 'bible.newTestament',
      books: [
        { name: 'Matthew', chapters: 28 }, { name: 'Mark', chapters: 16 },
        { name: 'Luke', chapters: 24 }, { name: 'John', chapters: 21 },
        { name: 'Acts', chapters: 28 }, { name: 'Romans', chapters: 16 },
        { name: '1 Corinthians', chapters: 16 }, { name: '2 Corinthians', chapters: 13 },
        { name: 'Galatians', chapters: 6 }, { name: 'Ephesians', chapters: 6 },
        { name: 'Philippians', chapters: 4 }, { name: 'Colossians', chapters: 4 },
        { name: '1 Thessalonians', chapters: 5 }, { name: '2 Thessalonians', chapters: 3 },
        { name: '1 Timothy', chapters: 6 }, { name: '2 Timothy', chapters: 4 },
        { name: 'Titus', chapters: 3 }, { name: 'Philemon', chapters: 1 },
        { name: 'Hebrews', chapters: 13 }, { name: 'James', chapters: 5 },
        { name: '1 Peter', chapters: 5 }, { name: '2 Peter', chapters: 3 },
        { name: '1 John', chapters: 5 }, { name: '2 John', chapters: 1 },
        { name: '3 John', chapters: 1 }, { name: 'Jude', chapters: 1 },
        { name: 'Revelation', chapters: 22 }
      ]
    }
  ];

  /* Which screen of the browser is showing, and the path taken to it.
     `verse` and `chapterVerses` back the single-verse study view: the number
     in focus, and the whole chapter's verses so prev/next can move through it. */
  var bibleState = {
    screen: 'testaments', testament: 0, book: null, chapter: 1,
    verse: 1, chapterVerses: [], focusAfterLoad: null, showOriginal: false
  };

  var bibleScreens = {
    testaments: document.getElementById('bible-screen-testaments'),
    books: document.getElementById('bible-screen-books'),
    chapters: document.getElementById('bible-screen-chapters'),
    reader: document.getElementById('bible-screen-reader'),
    verse: document.getElementById('bible-screen-verse')
  };

  function showBibleScreen(name) {
    bibleState.screen = name;
    Object.keys(bibleScreens).forEach(function (key) {
      bibleScreens[key].hidden = key !== name;
    });
    // the testaments screen is the root, so it carries no back button
    document.getElementById('bible-crumbs').hidden = name === 'testaments';
    // the book search only makes sense while choosing a book
    var search = document.getElementById('bible-book-search');
    var onPickScreen = name === 'testaments' || name === 'books';
    if (search) search.hidden = !onPickScreen;
    if (!onPickScreen) {
      var results = document.getElementById('bible-book-results');
      if (results) { results.hidden = true; results.textContent = ''; }
      var q = document.getElementById('bible-book-query');
      if (q) q.value = '';
    }
    // leaving the chapter reader stops any narration in progress
    if (name !== 'reader' && typeof bibleAudio !== 'undefined') bibleAudio.reset();
    updateBibleCrumbs();
    applyReadingPrefs();
  }

  function resetBibleBrowser() {
    bibleState.book = null;
    bibleState.chapter = 1;
    showBibleScreen('testaments');
  }

  // the chevron points back the way the script reads
  function bibleSeparator() {
    return document.documentElement.dir === 'rtl' ? ' ‹ ' : ' › ';
  }

  function updateBibleCrumbs() {
    var parts = [];
    if (bibleState.screen !== 'testaments') {
      parts.push(t(BIBLE_BOOKS[bibleState.testament].testamentKey));
    }
    if (bibleState.book && bibleState.screen !== 'books') {
      parts.push(bibleState.book.name);
    }
    if (bibleState.screen === 'reader' || bibleState.screen === 'verse') {
      parts.push(t('bible.chapter') + ' ' + bibleState.chapter);
    }
    if (bibleState.screen === 'verse') {
      parts.push(t('bible.verse') + ' ' + bibleState.verse);
    }
    document.getElementById('bible-path').textContent = parts.join(bibleSeparator());
  }

  function renderTestamentCards() {
    var grid = bibleScreens.testaments;
    grid.textContent = '';
    BIBLE_BOOKS.forEach(function (group, index) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'feature-card';

      var label = document.createElement('span');
      label.className = 'feature-label';
      label.textContent = t(group.testamentKey);
      card.appendChild(label);

      var hint = document.createElement('span');
      hint.className = 'feature-hint';
      hint.textContent = t('bible.bookCount', { count: group.books.length });
      card.appendChild(hint);

      card.addEventListener('click', function () {
        bibleState.testament = index;
        renderBookGrid();
        showBibleScreen('books');
        window.scrollTo(0, 0);
      });
      grid.appendChild(card);
    });
  }

  function renderBookGrid() {
    var grid = bibleScreens.books;
    grid.textContent = '';
    BIBLE_BOOKS[bibleState.testament].books.forEach(function (book) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bible-item';
      btn.textContent = book.name;
      btn.addEventListener('click', function () {
        bibleState.book = book;
        bibleState.chapter = 1;
        renderChapterGrid();
        showBibleScreen('chapters');
        window.scrollTo(0, 0);
      });
      grid.appendChild(btn);
    });
  }

  function renderChapterGrid() {
    var grid = document.getElementById('bible-chapters-grid');
    grid.textContent = '';
    resetBookGuide();
    if (!bibleState.book) return;
    for (var n = 1; n <= bibleState.book.chapters; n++) {
      (function (chapter) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bible-item';
        btn.textContent = chapter;
        btn.addEventListener('click', function () {
          bibleState.chapter = chapter;
          showBibleScreen('reader');
          window.scrollTo(0, 0);
          loadChapter();
        });
        grid.appendChild(btn);
      })(n);
    }
  }

  function updatePrevNext() {
    document.getElementById('bible-prev').disabled = bibleState.chapter <= 1;
    document.getElementById('bible-next').disabled =
      !bibleState.book || bibleState.chapter >= bibleState.book.chapters;
  }

  /* ---------- the reader: versions, video, and per-verse tools ---------- */

  // small DOM helpers keep the card building below readable
  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }
  function txt(tag, cls, text) {
    var node = el(tag, cls);
    node.textContent = text;
    return node;
  }

  /* Provenance labels. A new believer can't tell grounded content from machine-
     drafted content on their own, so we say which is which: study notes that come
     from the AI backend get an honest "AI-assisted" footnote; a human-reviewed
     curated overview gets a "reviewed" mark instead. Appended as the last child
     of a study panel, only on the success path (never on busy/error states). */
  function studyProvenance(reviewed) {
    var note = el('p', 'study-provenance' + (reviewed ? ' is-reviewed' : ' is-ai'));
    note.setAttribute('role', 'note');
    note.appendChild(txt('span', 'study-provenance-mark', reviewed ? '✓' : '✦'));
    note.appendChild(txt('span', 'study-provenance-text',
      t(reviewed ? 'bible.reviewedNote' : 'bible.aiNote')));
    return note;
  }
  function appendProvenance(body, reviewed) {
    if (body) body.appendChild(studyProvenance(reviewed));
  }

  /* Public-domain versions (kjv/web/bbe) come from bible-api.com; the "api:"
     ids are licensed versions served through API.Bible, which returns the
     copyright line the reader then shows. The empty id lets the server pick
     what's best for the language. */
  var BIBLE_VERSIONS = [
    { id: '', labelKey: 'settings.translationDefault' },
    { id: 'kjv', label: 'King James Version (KJV)' },
    { id: 'web', label: 'World English Bible (WEB)' },
    { id: 'bbe', label: 'Bible in Basic English (BBE)' },
    { id: 'api:78a9f6124f344018-01', label: 'New International Version (NIV)' },
    { id: 'api:61fd76eafa1577c2-02', label: 'Good News Translation (GNT)' }
  ];

  /* Original-language texts on API.Bible (served through the existing
     bible-chapter proxy via the "api:" version prefix): the Westminster
     Leningrad Codex for the Hebrew Old Testament and the Text-Critical Greek
     New Testament. Chosen by the current testament. */
  var ORIGINAL_OT = 'api:0b262f1ed7f084a6-01'; // Hebrew — WLC
  var ORIGINAL_NT = 'api:7644de2e4c5188e5-01'; // Greek — Text-Critical GNT
  // The scholarly English translation paired with the original text in the
  // verse-study panel: a Jewish translation for the Hebrew OT and a
  // critical-text rendering for the Greek/Aramaic NT. Both are properly
  // licensed through the API.Bible proxy (the copyrighted NJPS/NRSV/NRSVue/NASB
  // aren't in the catalogue, so these are the closest licensed equivalents).
  var STUDY_TRANS_OT = 'api:bf8f1c7f3f9045a5-01'; // JPS Tanakh (1917)
  var STUDY_TRANS_NT = 'api:32339cf2f720ff8e-01'; // Text-Critical English NT
  // a second, formal-equivalent translation shown alongside the first in both
  // testaments — the ASV 1901, the public-domain parent of the NRSV and NASB lines
  var STUDY_TRANS_ASV = 'api:06125adad2d5898a-01'; // American Standard Version (1901)
  // the ancient Aramaic Targum of the Torah (Onkelos), in Etheridge's 1862
  // English — shown only on Genesis–Deuteronomy, the books it covers
  var TARGUM_ONKELOS = 'api:ec290b5045ff54a5-01';
  var TORAH_BOOKS = { Genesis: 1, Exodus: 1, Leviticus: 1, Numbers: 1, Deuteronomy: 1 };
  function isOriginalHebrew() { return bibleState.showOriginal && bibleState.testament === 0; }

  function currentVersion() {
    if (bibleState.showOriginal) return bibleState.testament === 0 ? ORIGINAL_OT : ORIGINAL_NT;
    return (settings && settings.version) || '';
  }

  function fillVersionSelect(select) {
    if (!select) return;
    select.textContent = '';
    BIBLE_VERSIONS.forEach(function (v) {
      var option = document.createElement('option');
      option.value = v.id;
      option.textContent = v.labelKey ? t(v.labelKey) : v.label;
      select.appendChild(option);
    });
    select.value = currentVersion();
  }

  // the reader's picker and the Settings "main version" select show the same list
  function renderVersionOptions() {
    fillVersionSelect(document.getElementById('bible-version'));
    fillVersionSelect(document.getElementById('setting-version'));
  }

  document.getElementById('bible-version').addEventListener('change', function () {
    settings.version = this.value;
    persistSettings();
    var setting = document.getElementById('setting-version');
    if (setting) setting.value = this.value;
    loadChapter();
  });

  // The reader's whole-chapter original-language toggle was retired: the Hebrew/
  // Greek behind a verse now lives only in the single-verse study screen's
  // "Original language" panel (alongside Video and Context & meaning), so the
  // reader stays in the reader's chosen translation. bibleState.showOriginal is
  // left in place (permanently false) so currentVersion()/reportContext stay safe.

  // jumping to a verse from the picker scrolls its card into view
  document.getElementById('bible-verse-select').addEventListener('change', function () {
    var card = document.querySelector('.verse-card[data-verse="' + this.value + '"]');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // the progress bar fills as the reader scrolls through the chapter
  var progressPending = false;
  function updateReadingProgress() {
    var fill = document.getElementById('bible-progress-fill');
    var verses = document.getElementById('bible-verses');
    if (!fill || !verses) return;
    if (!settings.showProgressBar || bibleState.screen !== 'reader') return;
    var denom = verses.scrollHeight - window.innerHeight;
    var p = denom > 0 ? (-verses.getBoundingClientRect().top) / denom : 1;
    p = Math.max(0, Math.min(1, p));
    fill.style.width = (p * 100).toFixed(1) + '%';
  }
  window.addEventListener('scroll', function () {
    if (progressPending) return;
    progressPending = true;
    (window.requestAnimationFrame || function (f) { f(); })(function () {
      progressPending = false;
      updateReadingProgress();
    });
  }, { passive: true });
  window.addEventListener('resize', updateReadingProgress);

  /* Posted videos live on the device, keyed by book|chapter|verse, so they
     stay put across reloads without an account behind them. */
  var VIDEO_KEY = 'tgp.verseVideos';
  function loadVideos() {
    try { return JSON.parse(window.localStorage.getItem(VIDEO_KEY)) || {}; }
    catch (err) { return {}; }
  }
  function saveVideos(map) {
    try { window.localStorage.setItem(VIDEO_KEY, JSON.stringify(map)); }
    catch (err) { /* posting won't persist, but works for this view */ }
  }
  function verseKey(number) {
    return bibleState.book.name + '|' + bibleState.chapter + '|' + number;
  }

  // turn a pasted link into an embed; null means "not something we can play"
  function videoEmbed(url) {
    var yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (yt) return videoFrame('https://www.youtube.com/embed/' + yt[1]);
    var vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vimeo) return videoFrame('https://player.vimeo.com/video/' + vimeo[1]);
    if (/^https?:\/\/\S+\.(mp4|webm|ogg)(\?\S*)?$/i.test(url)) {
      var video = el('video', 'verse-embed-media');
      video.src = url;
      video.controls = true;
      return wrapEmbed(video);
    }
    return null;
  }
  function videoFrame(src) {
    var frame = el('iframe', 'verse-embed-media');
    frame.src = src;
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('loading', 'lazy');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    return wrapEmbed(frame);
  }
  function wrapEmbed(node) {
    var wrap = el('div', 'verse-embed');
    wrap.appendChild(node);
    return wrap;
  }

  /* Accepts either a verses array or the older single text blob, splitting the
     blob on leading verse numbers so the reader works with whatever shape the
     backend sends. */
  function extractVerses(data) {
    if (data && Array.isArray(data.verses) && data.verses.length) {
      return data.verses
        .map(function (v, i) {
          return { number: v.number || v.verse || i + 1, text: (v.text || '').trim() };
        })
        .filter(function (v) { return v.text; });
    }
    var blob = ((data && data.text) || '').trim();
    if (!blob) return [];
    var re = /(\d+)\s+([\s\S]*?)(?=\s+\d+\s+|$)/g;
    var out = [];
    var m;
    while ((m = re.exec(blob))) out.push({ number: parseInt(m[1], 10), text: m[2].trim() });
    return out.length > 1 ? out : [{ number: 1, text: blob }];
  }

  function setCopyright(text) {
    var el = document.getElementById('bible-copyright');
    el.textContent = (text || '').trim();
    el.hidden = !el.textContent;
  }

  function loadChapter() {
    if (!bibleState.book) return;
    var status = document.getElementById('bible-status');
    var list = document.getElementById('bible-verses');

    list.textContent = '';
    setCopyright('');
    resetChapterGuide();
    // the FAQ tab shows only where a curated FAQ exists, so decide its
    // visibility up front with the cheap admin-store read
    resetChapterFaq();
    loadChapterFaq();
    setStatus(status, t('bible.busyStatus'), false);
    updateBibleCrumbs();
    updatePrevNext();
    renderVersionOptions();

    request('bible-chapter', {
      book: bibleState.book.name,
      chapter: bibleState.chapter,
      version: currentVersion()
    })
      .then(function (data) {
        var verses = extractVerses(data);
        if (verses.length) {
          renderVerses(verses);
          // licensed versions (NIV, GNT) require the copyright line be shown
          setCopyright(data && data.copyright);
          setStatus(status, '', false);
          // reaching a chapter counts toward the streak, chapter total, and badges
          markChapterRead(bibleState.book.name, bibleState.chapter);
          // a verse step that crossed a chapter edge (or a version change made
          // while studying a verse) lands back in the study view
          if (bibleState.focusAfterLoad) {
            var edge = bibleState.focusAfterLoad;
            bibleState.focusAfterLoad = null;
            var pick;
            if (edge === 'keep') {
              pick = verses.filter(function (x) { return x.number === bibleState.verse; })[0] || verses[0];
            } else {
              pick = edge === 'last' ? verses[verses.length - 1] : verses[0];
            }
            bibleState.verse = pick.number;
            showBibleScreen('verse');
            renderVerseFocus();
            window.scrollTo(0, 0);
          }
        } else {
          // an empty 200 means the reader endpoint isn't wired yet
          bibleState.focusAfterLoad = null;
          setStatus(status, t('bible.unavailable'), false);
        }
      })
      .catch(function (err) {
        bibleState.focusAfterLoad = null;
        list.textContent = '';
        setStatus(status, err.message, true);
      });
  }

  function renderVerses(verses) {
    // keep the chapter's verses so the study view can read text and step around
    bibleState.chapterVerses = verses;
    var list = document.getElementById('bible-verses');
    list.classList.toggle('is-original', !!bibleState.showOriginal);
    list.classList.toggle('is-rtl', isOriginalHebrew());
    list.textContent = '';
    verses.forEach(function (verse) {
      list.appendChild(buildVerseCard(verse));
    });
    populateVersePicker(verses);
    applyReadingPrefs();
    bibleAudio.reset();               // a fresh chapter starts fresh audio
    bibleAudio.show(verses.length > 0);
    updateNotesSaveBtn();             // reflect any unsaved notes on the Save button
    // let the new cards lay out before the progress bar measures them
    if (window.requestAnimationFrame) window.requestAnimationFrame(updateReadingProgress);
  }

  /* ---------- listen: read the chapter aloud (Web Speech API) ----------
     Reads each verse in turn using the browser's own voices — no network, no
     backend. Highlights the verse being spoken, follows the language setting,
     and degrades to a quiet note where speech synthesis isn't available. */
  /* The chapter narrator. Built on the browser's speech engine, but tuned to
     sound like a reader rather than a robot: it picks the most natural voice
     the device offers, reads one sentence at a time (so intonation lands and
     phrases breathe), pauses between sentences and verses, and nudges pitch and
     pace slightly from line to line to break the flat, uncanny monotone. The
     listener chooses from 15 narration styles — each a blend of voice, pitch,
     tempo, expressiveness, and pause length. */
  var bibleAudio = (function () {
    var synth = window.speechSynthesis;
    var supported = !!synth && typeof window.SpeechSynthesisUtterance === 'function';
    var bar, playBtn, playIcon, playLabel, stopBtn, rateSel, styleSel, note;
    var order = [], idx = 0, playing = false, paused = false;
    var gapTimer = null, pausedInGap = false, lastCard = -1;

    /* 15 narration styles. rate/pitch are the base voice tuning, gender biases
       voice selection, gap is the pause (ms) at a verse end (mid-verse pauses
       are shorter), vary adds gentle line-to-line movement so it isn't flat. */
    var NARRATION_STYLES = [
      { id: 'storyteller',   label: 'Warm storyteller',        rate: 0.92, pitch: 1.03, gender: 'f',  gap: 360, vary: true },
      { id: 'narrator',      label: 'Classic narrator',        rate: 0.96, pitch: 0.96, gender: 'm',  gap: 320, vary: true },
      { id: 'reverent',      label: 'Reverent & worshipful',   rate: 0.83, pitch: 0.93, gender: 'm',  gap: 560, vary: false },
      { id: 'gentle',        label: 'Gentle & soothing',       rate: 0.82, pitch: 1.07, gender: 'f',  gap: 480, vary: false },
      { id: 'dramatic',      label: 'Dramatic reading',        rate: 0.95, pitch: 0.92, gender: 'm',  gap: 440, vary: true },
      { id: 'grandfather',   label: 'Grandfather by the fire', rate: 0.80, pitch: 0.86, gender: 'm',  gap: 540, vary: true },
      { id: 'proclaimer',    label: 'Bold proclaimer',         rate: 1.00, pitch: 0.98, gender: 'm',  gap: 300, vary: true },
      { id: 'poetic',        label: 'Poetic & lyrical',        rate: 0.87, pitch: 1.01, gender: 'f',  gap: 500, vary: true },
      { id: 'storytime',     label: 'Story time (for kids)',   rate: 0.92, pitch: 1.16, gender: 'f',  gap: 400, vary: true },
      { id: 'contemplative', label: 'Contemplative',           rate: 0.78, pitch: 0.98, gender: null, gap: 640, vary: false },
      { id: 'anchor',        label: 'News anchor',             rate: 1.06, pitch: 1.00, gender: null, gap: 240, vary: false },
      { id: 'intimate',      label: 'Intimate & close',        rate: 0.85, pitch: 0.99, gender: 'f',  gap: 440, vary: false },
      { id: 'epic',          label: 'Epic & cinematic',        rate: 0.88, pitch: 0.85, gender: 'm',  gap: 560, vary: true },
      { id: 'bright',        label: 'Bright & uplifting',      rate: 1.00, pitch: 1.11, gender: 'f',  gap: 300, vary: true },
      { id: 'brisk',         label: 'Brisk & efficient',       rate: 1.15, pitch: 1.00, gender: null, gap: 150, vary: false }
    ];
    var STYLE_KEY = 'tgp.narrationStyle';
    function currentStyle() {
      var id = null;
      try { id = window.localStorage.getItem(STYLE_KEY); } catch (e) { /* ignore */ }
      return NARRATION_STYLES.filter(function (s) { return s.id === id; })[0] || NARRATION_STYLES[0];
    }
    function saveStyle(id) { try { window.localStorage.setItem(STYLE_KEY, id); } catch (e) { /* ignore */ } }

    function els() {
      if (bar) return;
      bar = document.getElementById('bible-audio');
      playBtn = document.getElementById('bible-listen');
      playIcon = playBtn && playBtn.querySelector('.bible-audio-icon');
      playLabel = document.getElementById('bible-listen-label');
      stopBtn = document.getElementById('bible-listen-stop');
      rateSel = document.getElementById('bible-audio-rate');
      styleSel = document.getElementById('bible-audio-style');
      note = document.getElementById('bible-audio-note');
    }

    function langTag() {
      var c = currentLang;
      return c === 'en' ? 'en-US' : (c === 'zh' ? 'zh-CN' : (c === 'zh-TW' ? 'zh-TW' : c));
    }

    /* Rank the device's voices so the most natural one wins: neural/natural
       engines first, then cloud voices, then known good named voices; the buzzy
       compact/eSpeak voices are pushed to the bottom. Gender biases per style. */
    var GOOD = /samantha|alex|daniel|karen|moira|tessa|serena|allison|ava|tom|fiona|kate|oliver|stephanie|aria|jenny|guy|sonia|ryan|michelle|nova|amelie|anna|paulina|jorge|diego|victoria|catherine/;
    var FEM = /female|samantha|karen|moira|tessa|serena|allison|ava|fiona|kate|stephanie|aria|jenny|sonia|michelle|zira|susan|linda|amelie|anna|paulina|nova|victoria|catherine|hazel|clara/;
    var MAL = /alex|daniel|thomas|tom|oliver|guy|ryan|david|mark|george|james|fred|jorge|diego|male/;
    function scoreVoice(v, st) {
      var n = (v.name || '').toLowerCase(), s = 0;
      if (/natural|neural/.test(n)) s += 120;
      else if (/premium|enhanced/.test(n)) s += 80;
      else if (/google/.test(n)) s += 60;
      else if (/siri/.test(n)) s += 55;
      if (/espeak|compact|pico|robo/.test(n)) s -= 140;
      if (GOOD.test(n)) s += 40;
      if (!v.localService) s += 12; // cloud voices are usually the natural ones
      if (st && st.gender) {
        var fem = FEM.test(n), mal = !fem && MAL.test(n);
        if (st.gender === 'f') s += fem ? 35 : (mal ? -18 : 0);
        if (st.gender === 'm') s += mal ? 35 : (fem ? -18 : 0);
      }
      return s;
    }
    function pickVoice(tag, st) {
      var voices = synth.getVoices() || [];
      if (!voices.length) return null;
      var base = tag.split('-')[0].toLowerCase();
      var pool = voices.filter(function (v) { return v.lang && v.lang.toLowerCase().indexOf(base) === 0; });
      if (!pool.length) pool = voices.slice();
      pool.sort(function (a, b) { return scoreVoice(b, st) - scoreVoice(a, st); });
      return pool[0] || null;
    }

    function markVerse(on, n) {
      var cards = document.querySelectorAll('#bible-verses .verse-card');
      for (var i = 0; i < cards.length; i++) cards[i].classList.remove('is-speaking');
      if (on && typeof n === 'number' && cards[n]) {
        cards[n].classList.add('is-speaking');
        if (n !== lastCard) { cards[n].scrollIntoView({ block: 'center', behavior: 'smooth' }); lastCard = n; }
      }
      if (!on) lastCard = -1;
    }

    function setPlayingUI(state) {
      els();
      if (playIcon) playIcon.textContent = state ? '⏸' : '▶';
      if (playLabel) playLabel.textContent = state ? t('bible.pause') : (paused ? t('bible.resume') : t('bible.listen'));
      if (stopBtn) stopBtn.hidden = !(state || paused);
    }

    function clearGap() { if (gapTimer) { clearTimeout(gapTimer); gapTimer = null; } }

    // break a verse into sentence-sized phrases so intonation and breath land
    function splitSentences(text) {
      var m = text.match(/[^.!?…;]+[.!?…;]*/g);
      if (!m) return [text];
      var out = [];
      m.forEach(function (s) { s = s.trim(); if (s) out.push(s); });
      return out.length ? out : [text];
    }

    function speakFrom(i) {
      if (i >= order.length) { finish(); return; }
      idx = i;
      var item = order[i];
      var st = currentStyle();
      var u = new window.SpeechSynthesisUtterance(item.text);
      u.lang = langTag();
      var v = pickVoice(u.lang, st);
      if (v) u.voice = v;
      var mult = parseFloat(rateSel && rateSel.value) || 1;
      var rate = st.rate * mult, pitch = st.pitch;
      if (st.vary) { rate += (i % 2 ? 0.03 : -0.02); pitch += (((i % 3) - 1) * 0.045); }
      u.rate = Math.max(0.5, Math.min(2, rate));
      u.pitch = Math.max(0.4, Math.min(1.7, pitch));
      u.onstart = function () { markVerse(true, item.cardIndex); };
      u.onend = function () {
        if (!playing) return; // cancelled or paused
        var gap = item.verseEnd ? st.gap : Math.round(st.gap * 0.4);
        clearGap();
        gapTimer = setTimeout(function () { gapTimer = null; if (playing) speakFrom(i + 1); }, gap);
      };
      synth.speak(u);
    }

    function finish() {
      playing = false; paused = false;
      clearGap();
      markVerse(false);
      setPlayingUI(false);
      if (playLabel) playLabel.textContent = t('bible.listen');
      if (stopBtn) stopBtn.hidden = true;
    }

    function build() {
      order = [];
      var cards = document.querySelectorAll('#bible-verses .verse-card');
      for (var i = 0; i < cards.length; i++) {
        var body = cards[i].querySelector('.verse-body');
        var text = body ? body.textContent.trim() : '';
        if (!text) continue;
        var sents = splitSentences(text);
        for (var j = 0; j < sents.length; j++) {
          order.push({ text: sents[j], cardIndex: i, verseEnd: j === sents.length - 1 });
        }
      }
    }

    function start() {
      build();
      if (!order.length) return;
      synth.cancel();
      clearGap();
      playing = true; paused = false; pausedInGap = false;
      setPlayingUI(true);
      speakFrom(0);
    }

    return {
      wire: function () {
        els();
        if (!bar) return;
        if (!supported) {
          if (playBtn) playBtn.hidden = true;
          if (rateSel) rateSel.parentNode.hidden = true;
          if (styleSel) styleSel.parentNode.hidden = true;
          if (note) note.hidden = false;
          return;
        }
        // fill the narration-style picker
        if (styleSel && !styleSel.dataset.built) {
          styleSel.dataset.built = '1';
          NARRATION_STYLES.forEach(function (s) {
            var o = document.createElement('option');
            o.value = s.id; o.textContent = s.label;
            styleSel.appendChild(o);
          });
          styleSel.value = currentStyle().id;
          styleSel.addEventListener('change', function () {
            saveStyle(styleSel.value);
            // apply the new voice immediately by restarting the current verse
            if (playing || paused) { synth.cancel(); clearGap(); playing = true; paused = false; pausedInGap = false; setPlayingUI(true); speakFrom(idx); }
          });
        }
        playBtn.addEventListener('click', function () {
          if (!playing && !paused) { start(); return; }
          if (playing && !paused) {
            paused = true; playing = false;
            pausedInGap = !!gapTimer; clearGap();
            if (synth.speaking) synth.pause();
            setPlayingUI(false);
            return;
          }
          if (paused) {
            paused = false; playing = true; setPlayingUI(true);
            if (pausedInGap) { pausedInGap = false; speakFrom(idx + 1); }
            else if (synth.paused) synth.resume();
            else speakFrom(idx);
          }
        });
        stopBtn.addEventListener('click', function () { synth.cancel(); finish(); });
        rateSel.addEventListener('change', function () {
          // apply the new speed by restarting from the current sentence
          if (playing || paused) { synth.cancel(); clearGap(); playing = true; paused = false; pausedInGap = false; setPlayingUI(true); speakFrom(idx); }
        });
        // some browsers load voices asynchronously; nothing to do but re-rank next call
        if (typeof synth.onvoiceschanged !== 'undefined') synth.onvoiceschanged = function () {};
      },
      show: function (on) { els(); if (bar) bar.hidden = !on; },
      reset: function () { if (supported) window.speechSynthesis.cancel(); clearGap(); playing = false; paused = false; pausedInGap = false; idx = 0; setPlayingUI(false); markVerse(false); }
    };
  })();

  function populateVersePicker(verses) {
    var select = document.getElementById('bible-verse-select');
    if (!select) return;
    select.textContent = '';
    verses.forEach(function (verse) {
      var option = document.createElement('option');
      option.value = verse.number;
      option.textContent = verse.number;
      select.appendChild(option);
    });
  }

  /* ---------- highlights & post-it notes (device-local) ----------
     Per-verse colour highlights and sticky notes, keyed by book|chapter|verse.
     Highlights save on click. Notes save immediately when autosave is on
     (Settings), otherwise they wait in `pendingNotes` for the reader's Save
     button. */
  var ANNOT_KEY = 'tgp.annotations';
  var HL_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple'];
  var pendingNotes = {};   // key -> {text,color} not yet written to storage
  function loadAnnots() { try { return JSON.parse(window.localStorage.getItem(ANNOT_KEY)) || {}; } catch (e) { return {}; } }
  function saveAnnots(a) { try { window.localStorage.setItem(ANNOT_KEY, JSON.stringify(a)); } catch (e) { /* view-only */ } }
  function annotKeyFor(n) { return bibleState.book.name + '|' + bibleState.chapter + '|' + n; }
  function annotAutosave() { return settings.annotationsAutosave !== false; }  // default on
  function hasPendingNotes() { for (var k in pendingNotes) { if (pendingNotes[k]) return true; } return false; }
  function updateNotesSaveBtn() {
    var btn = document.getElementById('bible-save-notes');
    if (!btn) return;
    var dirty = hasPendingNotes();
    btn.classList.toggle('is-dirty', dirty);
    btn.textContent = dirty ? t('bible.saveNotes') : t('bible.notesSaved');
  }
  function commitNote(key, cur) {
    var a = loadAnnots(); a[key] = a[key] || {};
    if (cur.text && cur.text.trim()) a[key].note = { text: cur.text.trim(), color: cur.color || 'yellow' };
    else delete a[key].note;
    saveAnnots(a); delete pendingNotes[key]; updateNotesSaveBtn();
  }
  function flushPendingNotes() {
    var a = loadAnnots();
    Object.keys(pendingNotes).forEach(function (k) {
      var c = pendingNotes[k]; a[k] = a[k] || {};
      if (c.text && c.text.trim()) a[k].note = { text: c.text.trim(), color: c.color || 'yellow' };
      else delete a[k].note;
    });
    saveAnnots(a); pendingNotes = {}; updateNotesSaveBtn();
    if (bibleState.chapterVerses) renderVerses(bibleState.chapterVerses);
  }

  function buildVerseCard(verse) {
    var card = el('article', 'verse-card');
    card.setAttribute('data-verse', verse.number);

    var head = el('div', 'verse-head');
    // the number opens the single-verse study view for this verse
    var num = txt('button', 'verse-num', verse.number);
    num.type = 'button';
    num.title = t('bible.studyVerse');
    num.setAttribute('aria-label', t('bible.studyVerse') + ': ' + verse.number);
    num.addEventListener('click', function () { openVerseFocus(verse.number); });
    head.appendChild(num);
    head.appendChild(txt('p', 'verse-body', verse.text));
    card.appendChild(head);

    var actions = el('div', 'verse-actions');
    var study = txt('button', 'verse-action verse-action-study', t('bible.studyVerse'));
    study.type = 'button';
    study.addEventListener('click', function () { openVerseFocus(verse.number); });
    actions.appendChild(study);
    var panel = el('div', 'verse-panel');
    panel.hidden = true;

    var open = null; // which tool is showing, so a second click closes it
    var buttons = {};

    function choose(name, fill) {
      if (open === name) {
        panel.hidden = true;
        open = null;
      } else {
        open = name;
        panel.hidden = false;
        panel.textContent = '';
        fill(panel, verse);
      }
      Object.keys(buttons).forEach(function (key) {
        buttons[key].classList.toggle('is-open', key === open);
      });
    }

    [
      { name: 'video', key: 'bible.video', fill: fillVideoPanel },
      { name: 'context', key: 'bible.context', fill: fillContextPanel },
      { name: 'resources', key: 'bible.resources', fill: fillResourcesPanel },
      { name: 'check', key: 'bible.knowledgeCheck', fill: fillCheckPanel }
    ].forEach(function (action) {
      var btn = txt('button', 'verse-action', t(action.key));
      btn.type = 'button';
      btn.addEventListener('click', function () { choose(action.name, action.fill); });
      // warm the generated panels on hover so their content is ready on click
      var warmPath = action.name === 'context' ? 'verse-context'
        : (action.name === 'resources' ? 'verse-resources' : null);
      if (warmPath) {
        warmOnIntent(btn, function () {
          if (!bibleState.book) return;
          requestCached(warmPath, {
            book: bibleState.book.name, chapter: bibleState.chapter,
            verse: verse.number, version: currentVersion()
          });
        });
      }
      buttons[action.name] = btn;
      actions.appendChild(btn);
    });

    // ---- highlight + note tools (local, instant) ----
    function applyHighlight(color) {
      HL_COLORS.forEach(function (c) { card.classList.remove('hl-' + c); });
      card.classList.toggle('is-highlighted', !!color);
      if (color) card.classList.add('hl-' + color);
    }
    function renderPostit() {
      var existing = card.querySelector('.verse-postit');
      if (existing) existing.parentNode.removeChild(existing);
      var a = loadAnnots()[annotKeyFor(verse.number)];
      var note = a && a.note;
      if (!note) return;
      var pit = el('div', 'verse-postit hl-' + (note.color || 'yellow'));
      pit.appendChild(txt('p', 'verse-postit-text', note.text));
      pit.title = t('bible.note');
      pit.addEventListener('click', function () { choose('note', fillNote); });
      card.appendChild(pit);
    }
    function fillHighlight(p) {
      var key = annotKeyFor(verse.number);
      var cur = (loadAnnots()[key] || {}).hl || null;
      p.appendChild(txt('p', 'verse-panel-label', t('bible.highlightPick')));
      var row = el('div', 'hl-swatches');
      HL_COLORS.forEach(function (c) {
        var s = el('button', 'hl-swatch hl-' + c + (cur === c ? ' is-active' : ''));
        s.type = 'button'; s.setAttribute('aria-label', c);
        s.addEventListener('click', function () {
          var a = loadAnnots(); a[key] = a[key] || {};
          a[key].hl = (a[key].hl === c ? null : c);
          saveAnnots(a);
          applyHighlight(a[key].hl);
          p.textContent = ''; fillHighlight(p);
        });
        row.appendChild(s);
      });
      p.appendChild(row);
    }
    function fillNote(p) {
      var key = annotKeyFor(verse.number);
      var saved = (loadAnnots()[key] || {}).note || null;
      var cur = pendingNotes[key] || (saved ? { text: saved.text, color: saved.color } : { text: '', color: 'yellow' });
      function markDirty() {
        pendingNotes[key] = { text: cur.text, color: cur.color };
        if (annotAutosave()) { commitNote(key, cur); renderPostit(); }
        else updateNotesSaveBtn();
      }
      p.appendChild(txt('p', 'verse-panel-label', t('bible.notePick')));
      var colors = el('div', 'note-colors');
      HL_COLORS.forEach(function (c) {
        var s = el('button', 'note-color hl-' + c + (cur.color === c ? ' is-active' : ''));
        s.type = 'button'; s.setAttribute('aria-label', c);
        s.addEventListener('click', function () { cur.color = c; markDirty(); p.textContent = ''; fillNote(p); });
        colors.appendChild(s);
      });
      p.appendChild(colors);
      var ta = el('textarea', 'note-textarea'); ta.rows = 4; ta.value = cur.text;
      ta.placeholder = t('bible.notePlaceholder');
      ta.addEventListener('input', function () { cur.text = ta.value; markDirty(); });
      p.appendChild(ta);
      var noteActions = el('div', 'note-actions');
      var save = txt('button', 'verse-panel-btn', t('bible.noteSaveOne')); save.type = 'button';
      save.addEventListener('click', function () { commitNote(key, cur); renderPostit(); });
      noteActions.appendChild(save);
      if (saved) {
        var del = txt('button', 'verse-panel-btn is-danger', t('bible.noteDelete')); del.type = 'button';
        del.addEventListener('click', function () {
          var a = loadAnnots(); if (a[key]) delete a[key].note; saveAnnots(a);
          delete pendingNotes[key]; renderPostit(); updateNotesSaveBtn(); p.textContent = ''; fillNote(p);
        });
        noteActions.appendChild(del);
      }
      p.appendChild(noteActions);
    }

    [
      { name: 'highlight', key: 'bible.highlight', fill: fillHighlight },
      { name: 'note', key: 'bible.note', fill: fillNote }
    ].forEach(function (action) {
      var btn = txt('button', 'verse-action verse-action-mark', t(action.key));
      btn.type = 'button';
      btn.addEventListener('click', function () { choose(action.name, action.fill); });
      buttons[action.name] = btn;
      actions.appendChild(btn);
    });

    card.appendChild(actions);
    card.appendChild(panel);
    // restore any saved highlight + note for this verse
    applyHighlight((loadAnnots()[annotKeyFor(verse.number)] || {}).hl);
    renderPostit();
    return card;
  }

  // --- video: paste a link, embed it, keep it on the device ---
  function fillVideoPanel(panel, verse) {
    var map = loadVideos();
    var saved = map[verseKey(verse.number)];

    if (saved) {
      var embed = videoEmbed(saved);
      if (embed) {
        panel.appendChild(embed);
      } else {
        var link = txt('a', 'verse-video-link', saved);
        link.href = saved;
        link.target = '_blank';
        link.rel = 'noopener';
        panel.appendChild(link);
      }
      var remove = txt('button', 'verse-panel-btn', t('bible.videoRemove'));
      remove.type = 'button';
      remove.addEventListener('click', function () {
        var m = loadVideos();
        delete m[verseKey(verse.number)];
        saveVideos(m);
        panel.textContent = '';
        fillVideoPanel(panel, verse);
      });
      panel.appendChild(remove);
      return;
    }

    var form = el('div', 'verse-video-form');
    var input = el('input', 'verse-video-input');
    input.type = 'url';
    input.placeholder = t('bible.videoHint');
    var post = txt('button', 'verse-panel-btn', t('bible.videoPost'));
    post.type = 'button';
    var note = el('p', 'verse-panel-note');

    post.addEventListener('click', function () {
      var url = input.value.trim();
      if (!url) return;
      // accept any http(s) link; only warn on something that clearly isn't one
      if (!/^https?:\/\//i.test(url)) {
        note.textContent = t('bible.videoInvalid');
        return;
      }
      var m = loadVideos();
      m[verseKey(verse.number)] = url;
      saveVideos(m);
      panel.textContent = '';
      fillVideoPanel(panel, verse);
    });

    form.appendChild(input);
    form.appendChild(post);
    panel.appendChild(form);
    panel.appendChild(note);
  }

  /* --- verse context: a ten-part study built from the backend ---
     The ten sections cover immediate / historical / literary context, the
     original language, cross references, the connection to Christ, theology,
     interpretive views, common misinterpretations, and application. Older
     replies that were a single `context` blob still render as plain prose. */
  var CONTEXT_SECTIONS = [
    { key: 'immediate', label: 'ctx.immediate' },
    { key: 'historical', label: 'ctx.historical' },
    { key: 'literary', label: 'ctx.literary' },
    { key: 'language', label: 'ctx.language' },
    { key: 'crossRefs', label: 'ctx.crossRefs' },
    { key: 'christ', label: 'ctx.christ' },
    { key: 'theology', label: 'ctx.theology' },
    { key: 'views', label: 'ctx.views' },
    { key: 'misreadings', label: 'ctx.misreadings' },
    { key: 'application', label: 'ctx.application' }
  ];

  function renderVerseContext(data) {
    if (!data) return null;
    var legacy = ((data.context || data.text) || '').trim();
    var hasRich = CONTEXT_SECTIONS.some(function (d) {
      var v = data[d.key];
      if (d.key === 'crossRefs') return Array.isArray(v) && v.length;
      if (d.key === 'christ') return v && (typeof v === 'string' ? v.trim() : typeof v === 'object');
      return typeof v === 'string' && v.trim();
    });
    if (!hasRich) return legacy ? txt('p', 'verse-prose', legacy) : null;

    var wrap = el('div', 'verse-context');
    var openFirst = true;
    CONTEXT_SECTIONS.forEach(function (d) {
      var content = d.key === 'crossRefs'
        ? buildCrossRefs(data.crossRefs)
        : d.key === 'christ'
          ? buildChristSection(data.christ)
          : buildProseSection(data[d.key]);
      if (!content) return;

      var det = el('details', 'ctx-section');
      if (openFirst) { det.open = true; openFirst = false; }
      var sum = el('summary', 'ctx-summary');
      sum.appendChild(txt('span', 'ctx-title', t(d.label)));
      det.appendChild(sum);
      var body = el('div', 'ctx-body');
      body.appendChild(content);
      det.appendChild(body);
      wrap.appendChild(det);
    });
    return wrap.children.length ? wrap : (legacy ? txt('p', 'verse-prose', legacy) : null);
  }

  function buildProseSection(val) {
    var text = cleanAIText((typeof val === 'string' ? val : '').trim());
    return text ? txt('p', 'ctx-text', text) : null;
  }

  function buildCrossRefs(refs) {
    if (!Array.isArray(refs) || !refs.length) return null;
    var ul = el('ul', 'ctx-refs');
    refs.forEach(function (r) {
      var reference = ((r && r.reference) || '').trim();
      if (!reference) return;
      var note = ((r && r.note) || '').trim();
      var li = el('li', 'ctx-ref');

      var loc = parseRef(reference);
      if (loc) {
        // a resolvable reference becomes a link into that chapter
        var link = txt('button', 'ctx-ref-link', reference);
        link.type = 'button';
        link.addEventListener('click', function () { openReaderAt(loc.book, loc.chapter); });
        li.appendChild(link);
      } else {
        li.appendChild(txt('span', 'ctx-ref-name', reference));
      }
      if (note) li.appendChild(txt('span', 'ctx-ref-note', ' — ' + note));
      ul.appendChild(li);
    });
    return ul.children.length ? ul : null;
  }

  /* A reference like "Romans 8:28-30" → the book/chapter and verse span it
     covers, so the cross-reference tab can show the actual words, not just the
     citation. Returns null for chapter-only references (no verse to quote). */
  function refVerseSpan(reference) {
    var m = String(reference).trim().match(/^(.+?)\s+(\d+):(\d+)(?:\s*[-–]\s*(\d+))?/);
    if (!m) return null;
    var found = findBook(m[1]);
    if (!found) return null;
    var v1 = parseInt(m[3], 10);
    return { book: found.book.name, chapter: parseInt(m[2], 10), v1: v1, v2: m[4] ? parseInt(m[4], 10) : v1 };
  }

  // fetch a referenced verse's text and drop it under its citation
  function appendRefVerseText(li, reference) {
    var span = refVerseSpan(reference);
    if (!span) return;
    var quote = txt('p', 'xref-verse-text is-loading', t('crossref.loadingVerse'));
    li.appendChild(quote);
    requestCached('bible-chapter', { book: span.book, chapter: span.chapter, version: currentVersion() })
      .then(function (data) {
        var verses = extractVerses(data);
        var picked = verses.filter(function (v) { return v.number >= span.v1 && v.number <= span.v2; });
        if (!picked.length) { if (quote.parentNode) quote.parentNode.removeChild(quote); return; }
        quote.classList.remove('is-loading');
        quote.textContent = picked.map(function (v) { return v.text; }).join(' ');
      })
      .catch(function () { if (quote.parentNode) quote.parentNode.removeChild(quote); });
  }

  // like buildCrossRefs, but quotes each referenced verse beneath its link
  function buildCrossRefsWithText(refs) {
    var ul = buildCrossRefs(refs);
    if (!ul) return null;
    var items = ul.querySelectorAll('.ctx-ref');
    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      var link = li.querySelector('.ctx-ref-link') || li.querySelector('.ctx-ref-name');
      if (link) appendRefVerseText(li, link.textContent);
    }
    return ul;
  }

  // the seven kinds of connection to Christ the backend may tag a verse with
  var CHRIST_KINDS = {
    direct: 'ctx.christKind.direct',
    prophetic: 'ctx.christKind.prophetic',
    typological: 'ctx.christKind.typological',
    thematic: 'ctx.christKind.thematic',
    canonical: 'ctx.christKind.canonical',
    indirect: 'ctx.christKind.indirect',
    none: 'ctx.christKind.none'
  };

  /* The Christ & the gospel section is richer than the others: a classified
     connection (direct / prophetic / typological / thematic / canonical /
     indirect / none) with an explanation, supporting scripture, NT usage, an
     alternative reading when disputed, and a confidence level. Legacy prose
     replies (a plain string) still render as a paragraph. */
  function buildChristSection(val) {
    if (typeof val === 'string') return buildProseSection(val);
    if (!val || typeof val !== 'object') return null;
    var wrap = el('div', 'ctx-christ');

    var kinds = val.classification;
    if (typeof kinds === 'string') kinds = [kinds];
    if (Array.isArray(kinds) && kinds.length) {
      var chips = el('div', 'christ-kinds');
      kinds.forEach(function (k) {
        var slug = String(k).trim().toLowerCase().replace(/[^a-z]/g, '');
        if (slug === 'noexplicitconnection' || slug === 'noconnection' || slug === 'nil') slug = 'none';
        var labelKey = CHRIST_KINDS[slug];
        chips.appendChild(txt('span', 'christ-kind christ-kind-' + (labelKey ? slug : 'other'),
          labelKey ? t(labelKey) : String(k)));
      });
      wrap.appendChild(chips);
    }

    var explanation = ((val.explanation || val.text) || '').trim();
    if (explanation) wrap.appendChild(txt('p', 'ctx-text', explanation));

    var refs = buildCrossRefs(normalizeRefs(val.supportingScripture || val.scripture));
    if (refs) {
      wrap.appendChild(txt('p', 'christ-sublabel', t('ctx.christSupport')));
      wrap.appendChild(refs);
    }

    appendChristNote(wrap, val.ntUsage, 'ctx.christNT');
    appendChristNote(wrap, val.alternative, 'ctx.christAlt');

    var conf = (val.confidence || '').trim();
    if (conf) {
      var badge = el('div', 'christ-confidence');
      badge.appendChild(txt('span', 'christ-conf-label', t('ctx.christConfidence')));
      badge.appendChild(txt('span', 'christ-conf-value christ-conf-' + confLevel(conf), conf));
      wrap.appendChild(badge);
    }
    return wrap.children.length ? wrap : null;
  }

  // a labelled inline note ("New Testament usage: …"), skipped when empty
  function appendChristNote(wrap, val, labelKey) {
    var s = (typeof val === 'string' ? val : '').trim();
    if (!s) return;
    var p = el('p', 'ctx-text christ-note');
    p.appendChild(txt('span', 'christ-sublabel-inline', t(labelKey) + ' '));
    p.appendChild(document.createTextNode(s));
    wrap.appendChild(p);
  }

  // accept a string, an array of strings, or an array of {reference,note}
  function normalizeRefs(support) {
    if (!support) return [];
    if (typeof support === 'string') {
      return support.split(/;|\n/).map(function (x) {
        return { reference: x.trim(), note: '' };
      }).filter(function (r) { return r.reference; });
    }
    if (Array.isArray(support)) {
      return support.map(function (r) {
        return (typeof r === 'string')
          ? { reference: r.trim(), note: '' }
          : { reference: ((r && r.reference) || '').trim(), note: ((r && r.note) || '').trim() };
      }).filter(function (r) { return r.reference; });
    }
    return [];
  }

  function confLevel(conf) {
    var c = String(conf).toLowerCase();
    if (c.indexOf('high') > -1) return 'high';
    if (c.indexOf('low') > -1) return 'low';
    return 'med';
  }

  // "1 John 4:9" -> { book:'1 John', chapter:4, verse:9 } when the book is in our canon
  function parseRef(ref) {
    var m = String(ref).trim().match(/^(.+?)\s+(\d+)(?::(\d+))?/);
    if (!m) return null;
    var found = findBook(m[1]);
    if (!found) return null;
    return { book: found.book.name, chapter: parseInt(m[2], 10), verse: m[3] ? parseInt(m[3], 10) : 1 };
  }

  /* ---------- chapter overview: a full study of the whole chapter ---------- */

  /* The rich chapter study, rendered as the same accordion as the verse
     context. Prose sections are paragraphs; list sections are bulleted;
     people/locations are name + note; key verses, difficult passages, and
     cross-references link into the reader; and the knowledge check is an
     interactive multiple-choice quiz. Older {overview, christ, history}
     replies aren't rich, so renderChapterOverview returns null and the
     caller falls back to the previous three-heading layout. */
  var CHAPTER_SECTIONS = [
    { key: 'summary', label: 'chap.summary', type: 'prose', group: 'essentials' },
    { key: 'christ', label: 'chap.christ', type: 'prose', group: 'essentials' },
    { key: 'keyVerses', label: 'chap.keyVerses', type: 'refs', group: 'essentials' },
    { key: 'quiz', label: 'chap.quiz', type: 'quiz', group: 'essentials' },
    { key: 'previously', label: 'chap.previously', type: 'prose', group: 'story' },
    { key: 'placement', label: 'chap.placement', type: 'prose', group: 'story' },
    { key: 'outline', label: 'chap.outline', type: 'list', group: 'story' },
    { key: 'events', label: 'chap.events', type: 'list', group: 'story' },
    { key: 'structure', label: 'chap.structure', type: 'prose', group: 'story' },
    { key: 'next', label: 'chap.next', type: 'prose', group: 'story' },
    { key: 'people', label: 'chap.people', type: 'named', group: 'world' },
    { key: 'locations', label: 'chap.locations', type: 'named', group: 'world' },
    { key: 'historical', label: 'chap.historical', type: 'prose', group: 'world' },
    { key: 'archaeology', label: 'chap.archaeology', type: 'archaeology', group: 'world' },
    { key: 'places', label: 'chap.places', type: 'geography', group: 'world' },
    { key: 'timeline', label: 'chap.timeline', type: 'timeline', group: 'world' },
    { key: 'themes', label: 'chap.themes', type: 'list', group: 'theology' },
    { key: 'theology', label: 'chap.theology', type: 'prose', group: 'theology' },
    { key: 'connections', label: 'chap.connections', type: 'refs', group: 'theology' },
    { key: 'apologetics', label: 'chap.apologetics', type: 'prose', group: 'theology' },
    { key: 'difficult', label: 'chap.difficult', type: 'refs', group: 'study' },
    // commonQuestions now has its own dedicated "Frequently asked questions"
    // panel in the reader (loadChapterFaq), so it's no longer folded in here
    { key: 'sources', label: 'chap.sources', type: 'list', group: 'study' }
  ];

  /* The whole-book study, shown when a book is selected and in the verse
     study view. Same accordion machinery as the chapter overview. */
  var BOOK_SECTIONS = [
    { key: 'summary', label: 'book.summary', type: 'prose', group: 'essentials' },
    { key: 'purpose', label: 'book.purpose', type: 'prose', group: 'essentials' },
    { key: 'christ', label: 'book.christ', type: 'prose', group: 'essentials' },
    { key: 'keyVerses', label: 'book.keyVerses', type: 'refs', group: 'essentials' },
    { key: 'outline', label: 'book.outline', type: 'list', group: 'story' },
    { key: 'storyline', label: 'book.storyline', type: 'prose', group: 'story' },
    { key: 'keyChapters', label: 'book.keyChapters', type: 'refs', group: 'story' },
    { key: 'events', label: 'book.events', type: 'list', group: 'story' },
    { key: 'genre', label: 'book.genre', type: 'prose', group: 'story' },
    { key: 'name', label: 'book.name', type: 'prose', group: 'world' },
    { key: 'nameMeaning', label: 'book.nameMeaning', type: 'prose', group: 'world' },
    { key: 'testament', label: 'book.testament', type: 'prose', group: 'world' },
    { key: 'category', label: 'book.category', type: 'prose', group: 'world' },
    { key: 'author', label: 'book.author', type: 'prose', group: 'world' },
    { key: 'authorship', label: 'book.authorship', type: 'prose', group: 'world' },
    { key: 'date', label: 'book.date', type: 'prose', group: 'world' },
    { key: 'dating', label: 'book.dating', type: 'prose', group: 'world' },
    { key: 'audience', label: 'book.audience', type: 'prose', group: 'world' },
    { key: 'historical', label: 'book.historical', type: 'prose', group: 'world' },
    { key: 'political', label: 'book.political', type: 'prose', group: 'world' },
    { key: 'cultural', label: 'book.cultural', type: 'prose', group: 'world' },
    { key: 'geography', label: 'book.geography', type: 'prose', group: 'world' },
    { key: 'people', label: 'book.people', type: 'named', group: 'world' },
    { key: 'locations', label: 'book.locations', type: 'named', group: 'world' },
    { key: 'neighbors', label: 'book.neighbors', type: 'prose', group: 'world' },
    { key: 'archaeology', label: 'book.archaeology', type: 'archaeology', group: 'world' },
    { key: 'places', label: 'book.places', type: 'geography', group: 'world' },
    { key: 'timeline', label: 'book.timeline', type: 'timeline', group: 'world' },
    { key: 'themes', label: 'book.themes', type: 'list', group: 'theology' },
    { key: 'doctrines', label: 'book.doctrines', type: 'named', group: 'theology' },
    { key: 'covenants', label: 'book.covenants', type: 'named', group: 'theology' },
    { key: 'connections', label: 'book.connections', type: 'refs', group: 'theology' },
    { key: 'controversies', label: 'book.controversies', type: 'named', group: 'study' },
    { key: 'manuscripts', label: 'book.manuscripts', type: 'prose', group: 'study' },
    { key: 'reception', label: 'book.reception', type: 'prose', group: 'study' },
    { key: 'sources', label: 'book.sources', type: 'list', group: 'study' }
  ];

  /* ---------- curated book overviews (verified) ----------
     Authoritative, editor-verified overview text for specific books, keyed by
     book name and using the same section keys as BOOK_SECTIONS. When present
     (and the interface is in English), these fields are merged *over* the
     backend-generated study so the trusted wording always wins; the backend
     still supplies the sections the curated entry doesn't cover. English-only,
     so translated interfaces keep the backend's localized text. */
  var CURATED_BOOK_INSIGHTS = {
    'Genesis': {
      name: 'Genesis is the first book of the Bible and the first of the five books of the Law (the Torah). Its English title comes from the Greek Old Testament — the Septuagint — which named the book Genesis.',
      nameMeaning: '“Beginning.” Genesis concerns the divine origin of all things, whether matter or energy, living or inanimate. It implies that, apart from God, everything can be traced back to a beginning point when God’s purposes and works came into being.',
      author: 'Genesis is, strictly speaking, an anonymous work, but historical tradition — together with biblical attestation — assigns its authorship to Moses.',
      authorship: 'Moses’ authorship would not have required him to write the entire book from firsthand knowledge. All of the events in Genesis took place long before Moses was born, which indicates that he must have used sources. He is best understood as an editor/historian who, in addition to receiving God’s direct and supernatural communication, drew together the family histories of Abraham and his descendants — as they existed in the Israelite community in Egypt — into a single text.',
      date: 'If Moses wrote and compiled Genesis, he must have done so during the Israelites’ wilderness wanderings after the exodus, probably between 1440 and 1400 B.C.',
      audience: 'Genesis records the creation, the fall into sin, the flood, the call of Abraham, and the early history of the ancestors of Israel. These stories were probably circulated among the Israelites living in Egypt, reminding them of their familial and spiritual heritage and explaining their present situation; they preserved individual accounts that could afford hope to God’s enslaved people, and the promises to Abraham about the future of his descendants would have encouraged them. Later, the Israelites directly involved in the exodus — and the generations after them — read Genesis to understand this part of the great saga of their national origin, for the fulfillment of God’s historical promises to the patriarchs testified to His continuing faithfulness.',
      cultural: 'Genesis records the birth and early history of humankind. God not only created the physical world but also formed man and woman in His own image and endowed them with the gift of free will. Over time changes took place, including humanity’s fall into sin and the great flood that followed. Tribes, cities, and civilizations rose and declined in a rhythm that has characterized human history ever since. Centuries passed, and at some point God chose to concentrate His particular attention on one individual — from an ordinary, idol-worshipping family — who in turn chose to listen and obey.',
      genre: 'Genesis presents history in the form of narrative, drawing on a range of literary types to communicate its theological message clearly and effectively. Its three major sections each have a characteristic form: the primeval events (Genesis 1–11) take a narrative form suited to oral transmission; the accounts of the first three patriarchs (Genesis 12–36; 38) trace ancestry; and the Joseph narrative (Genesis 37; 39–50) is built on tension and resolution. Other literary types run through the book as well — genealogies (5:3–32; 11:10–32), appearances of God (17–18; 32:22–30), direct words from God (25:23), blessings (1:28; 9:1; 27:27–29), and tribal sayings (49:3–27).',
      outline: [
        'Primeval history: creation, the fall, the flood, and the nations (Genesis 1–11)',
        'The patriarchs: Abraham, Isaac, and Jacob (Genesis 12–36; 38)',
        'The Joseph narrative (Genesis 37; 39–50)'
      ],
      summary: 'Genesis recounts the beginning of the heavens and the earth and of all created things within them, of God’s covenant relationship with humankind, of sin, of redemption, of the nations, and of God’s chosen people, Israel. In Genesis 1:26–28 God makes clear that He created man and woman to bless them and so that they could exercise dominion on His behalf over all creation. Humanity’s disobedience threatened God’s purpose for humanity in creation, and God responded by calling Abraham (previously known as Abram).',
      themes: [
        'Creation',
        'Sin',
        'The image of God',
        'God’s global plan of redemption'
      ],
      purpose: 'Genesis was written to give the nation of Israel an explanation of its existence as it stood on the threshold of the conquest of Canaan. Moses’ task, as an inspired prophetic author, was to make clear to his people how and why God had brought them into being — to know what their mission was and how their present situation fulfilled ancient promises. God had revealed to Abraham that he would be granted the land of Canaan (Genesis 12:1,5,7; 13:15), that his descendants would leave that land for a time (15:13), and that they would be delivered from the land of their oppression to return to the land of promise (15:16). This land would be theirs forever (17:8), and through them all the nations of the earth would be blessed (12:2–3; 27:29). Joseph understood this and saw in his own sojourn in Egypt the divine preservation of his people (45:7–8): God had sent him there to save them from physical and spiritual extinction (50:20), and He would remember His promise to Abraham, Isaac, and Jacob and return them to Canaan (50:24). The link with Exodus is clear in the call of Moses to lead his people from Egypt to the land of promise.',
      storyline: 'The theological message of Genesis reaches beyond the concerns of Israel alone. The book provides Israel’s reason for being and explains the human condition that called forth a covenant people. God’s original and eternal purposes are set out in Genesis 1:26–28: He created men and women in His image to bless them and so that they could exercise dominion over all creation on His behalf — the key themes of biblical theology, God’s blessing and human dominion under God’s reign. The fall of humankind into sin subverted God’s goal, and a process of redemption and of recovery of the original covenant had to be effected. So God chose Abraham, through whose offspring the divine purposes in creation might come to pass; that man and that nation were charged with serving God as the model of a people under His dominion and the vehicle through which a saving relationship could be established between Him and the alienated world of the nations.',
      christ: 'Israel failed to be the servant people. Yet from the nation rose a remnant — Jesus the Christ — who accomplished in His life and death the redemptive and reigning purposes of God. The church now exists as His body, to serve as Israel was chosen and redeemed to serve. The theology of Genesis is therefore wrapped up in the kingdom purposes of God, who, despite human failure, cannot be hindered in His ultimate objective of displaying His glory through His creation and His dominion.'
    }
  };

  /* Merge a curated entry over the backend study (curated keys win). English
     interface only, so localized backends keep their translated wording. */
  function withCuratedBook(data) {
    var name = bibleState.book && bibleState.book.name;
    var curated = (currentLang === DEFAULT_LANG && name) ? CURATED_BOOK_INSIGHTS[name] : null;
    if (!curated) return data;
    var out = {};
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(function (k) { out[k] = data[k]; });
    }
    Object.keys(curated).forEach(function (k) { out[k] = curated[k]; });
    return out;
  }

  // the curated entry alone (used as an offline / backend-down fallback)
  function curatedBookOnly() {
    var name = bibleState.book && bibleState.book.name;
    return (currentLang === DEFAULT_LANG && name) ? CURATED_BOOK_INSIGHTS[name] : null;
  }

  function renderChapterOverview(data) {
    return renderSectionedStudy(data, CHAPTER_SECTIONS,
      { book: bibleState.book.name, chapter: bibleState.chapter });
  }

  function renderBookOverview(data) {
    return renderSectionedStudy(data, BOOK_SECTIONS, { book: bibleState.book.name });
  }

  /* Owner-published maps & archaeology (from the Admin view) for a scope, shown
     inside the guide's "Background & world" cluster. Fetched from the shared
     admin store and injected after the guide renders, so chapters with nothing
     curated stay clean. */
  function buildAdminWorldPanel(maps, arch) {
    if ((!maps || !maps.length) && (!arch || !arch.length)) return null;
    var det = el('details', 'ctx-section ctx-admin-world');
    var sum = el('summary', 'ctx-summary');
    sum.appendChild(txt('span', 'ctx-title', t('admin.worldPanel')));
    det.appendChild(sum);
    var body = el('div', 'ctx-body');
    (maps || []).forEach(function (m) {
      var fig = el('figure', 'ctx-map');
      if (m.imageUrl) {
        var img = document.createElement('img');
        img.src = m.imageUrl; img.alt = m.title || 'map'; img.loading = 'lazy';
        img.className = 'ctx-map-img';
        fig.appendChild(img);
      }
      var cap = [m.title, m.caption].filter(Boolean).join(' — ');
      if (cap) fig.appendChild(txt('figcaption', 'ctx-map-cap', cap));
      if (fig.children.length) body.appendChild(fig);
    });
    (arch || []).forEach(function (a) {
      var card = el('div', 'ctx-find');
      if (a.title) card.appendChild(txt('h5', 'ctx-find-title', a.title));
      if (a.imageUrl) {
        var im = document.createElement('img');
        im.src = a.imageUrl; im.alt = a.title || 'artifact'; im.loading = 'lazy';
        im.className = 'ctx-find-img';
        card.appendChild(im);
      }
      if (a.description) card.appendChild(txt('p', 'ctx-text', a.description));
      if (card.children.length) body.appendChild(card);
    });
    if (!body.children.length) return null;
    det.appendChild(body);
    return det;
  }

  function injectAdminWorld(container, scope) {
    if (!container || !scope) return;
    Promise.all([adminList('map', scope), adminList('archaeology', scope)]).then(function (res) {
      if (container.querySelector('.ctx-admin-world')) return; // already injected
      var panel = buildAdminWorldPanel(res[0], res[1]);
      if (!panel) return;
      var world = container.querySelector('.ctx-group[data-group="world"]');
      if (world) { world.insertBefore(panel, world.firstChild); return; }
      var deeper = container.querySelector('.ctx-deeper') || container;
      var wrap = el('div', 'ctx-group');
      wrap.dataset.group = 'world';
      wrap.appendChild(panel);
      deeper.appendChild(txt('h4', 'ctx-group-title', t('grp.world')));
      deeper.appendChild(wrap);
    });
  }

  /* The "go deeper" groups: every non-essential section is folded into one of
     these labelled clusters, so the reader meets a short guide (the essentials)
     and opens the rest a group at a time instead of scanning 20-odd headings.
     Order here is the order the groups appear under the toggle. */
  var STUDY_GROUPS = [
    { key: 'story', label: 'grp.story' },
    { key: 'world', label: 'grp.world' },
    { key: 'theology', label: 'grp.theology' },
    { key: 'study', label: 'grp.study' }
  ];

  /* Build one section's collapsible panel (or null when it has no content).
     The archaeology / geography / timeline panels lazy-load, so they're always
     built when a scope is available. */
  function buildStudySectionNode(d, data, archScope, openState) {
    if (d.type === 'archaeology') return archScope ? buildArchaeologyPanel(d, archScope) : null;
    if (d.type === 'geography') return archScope ? buildGeographyPanel(d, archScope) : null;
    if (d.type === 'timeline') return archScope ? buildTimelinePanel(d, archScope) : null;
    var content = buildStudySection(d, data[d.key]);
    if (!content) return null;
    var det = el('details', 'ctx-section');
    if (openState) det.open = true;
    var sum = el('summary', 'ctx-summary');
    sum.appendChild(txt('span', 'ctx-title', t(d.label)));
    det.appendChild(sum);
    var body = el('div', 'ctx-body');
    body.appendChild(content);
    det.appendChild(body);
    return det;
  }

  /* Shared two-tier study for the chapter and book overviews. Tier 1 is the
     essentials (shown directly, first one open); tier 2 is everything else,
     folded into labelled groups behind a "Go deeper" toggle. Returns null when
     none of the rich keys are present, so callers can fall back to an older,
     simpler reply shape. */
  function renderSectionedStudy(data, sections, archScope) {
    if (!data) return null;
    // the archaeology panel loads on demand, so it never counts toward "rich"
    var hasRich = sections.some(function (d) {
      if (d.type === 'archaeology' || d.type === 'geography' || d.type === 'timeline') return false;
      var v = data[d.key];
      return d.type === 'prose' ? (typeof v === 'string' && v.trim()) : (Array.isArray(v) && v.length);
    });
    if (!hasRich) return null;

    var wrap = el('div', 'verse-context');

    // Tier 1 — essentials, shown directly; first non-empty panel open.
    var openFirst = true;
    sections.forEach(function (d) {
      if ((d.group || 'essentials') !== 'essentials') return;
      var node = buildStudySectionNode(d, data, archScope, openFirst);
      if (!node) return;
      openFirst = false;
      wrap.appendChild(node);
    });

    // Tier 2 — the rest, grouped, hidden until "Go deeper" is tapped.
    var deeper = el('div', 'ctx-deeper');
    deeper.hidden = true;
    var deeperCount = 0;
    STUDY_GROUPS.forEach(function (g) {
      var members = el('div', 'ctx-group');
      members.dataset.group = g.key;
      var built = 0;
      sections.forEach(function (d) {
        if (d.group !== g.key) return;
        var node = buildStudySectionNode(d, data, archScope, false);
        if (!node) return;
        members.appendChild(node);
        built++;
      });
      if (!built) return;
      deeper.appendChild(txt('h4', 'ctx-group-title', t(g.label)));
      deeper.appendChild(members);
      deeperCount += built;
    });

    if (deeperCount) {
      var btn = el('button', 'ctx-deeper-toggle');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      var caret = txt('span', 'ctx-deeper-caret', '▾');
      var lbl = txt('span', 'ctx-deeper-label', t('grp.deeper'));
      var count = txt('span', 'ctx-deeper-count', t('grp.more', { n: deeperCount }));
      btn.appendChild(caret); btn.appendChild(lbl); btn.appendChild(count);
      btn.addEventListener('click', function () {
        var show = deeper.hidden;
        deeper.hidden = !show;
        btn.setAttribute('aria-expanded', show ? 'true' : 'false');
        caret.textContent = show ? '▴' : '▾';
        lbl.textContent = show ? t('grp.showLess') : t('grp.deeper');
        count.hidden = show;
      });
      wrap.appendChild(btn);
      wrap.appendChild(deeper);
    }

    return wrap.children.length ? wrap : null;
  }

  /* The archaeology section is its own lazy fetch: opening it calls the
     `archaeology` endpoint for this book (or book+chapter) and renders a
     card per catalogued artifact. Kept separate so it doesn't bloat the
     already-heavy chapter/book overview generations. */
  function buildArchaeologyPanel(d, scope) {
    var det = el('details', 'ctx-section');
    var sum = el('summary', 'ctx-summary');
    sum.appendChild(txt('span', 'ctx-title', t(d.label)));
    det.appendChild(sum);
    var body = el('div', 'ctx-body');
    body.appendChild(txt('p', 'verse-panel-note', t('arch.hint')));
    det.appendChild(body);

    var loaded = false;
    det.addEventListener('toggle', function () {
      if (!det.open || loaded) return;
      loaded = true;
      body.textContent = '';
      body.appendChild(txt('p', 'verse-panel-note', t('arch.busy')));
      request('archaeology', scope)
        .then(function (data) {
          body.textContent = '';
          body.appendChild(renderArchaeology(data) || txt('p', 'verse-panel-note', t('arch.none')));
        })
        .catch(function (err) {
          loaded = false; // let the next open retry
          body.textContent = '';
          body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
        });
    });
    return det;
  }

  function renderArchaeology(data) {
    var artifacts = data && (data.artifacts || data.items);
    if (!Array.isArray(artifacts) || !artifacts.length) return null;
    var wrap = el('div', 'arch-list');
    artifacts.forEach(function (a) {
      var card = buildArtifactCard(a);
      if (card) wrap.appendChild(card);
    });
    return wrap.children.length ? wrap : null;
  }

  function buildArtifactCard(a) {
    if (!a) return null;
    var name = ((a.name || a.artifact) || '').trim();
    var card = el('div', 'arch-card');
    if (name) card.appendChild(txt('h5', 'arch-name', name));

    var fig = buildArtifactImage(a.image);
    if (fig) card.appendChild(fig);

    var dl = el('dl', 'arch-fields');
    addArchField(dl, 'arch.found', a.discoveryLocation);
    addArchField(dl, 'arch.now', a.currentLocation);
    addArchField(dl, 'arch.discovered', a.discoveryDate);
    addArchField(dl, 'arch.dated', a.artifactDate);
    addArchField(dl, 'arch.by', a.discoveredBy);
    addArchField(dl, 'arch.what', a.description);
    addArchRefField(dl, 'arch.passage', a.passage);
    addArchField(dl, 'arch.significance', a.significance);
    addArchField(dl, 'arch.supports', a.supports);
    addArchField(dl, 'arch.doesnt', a.doesntProve);
    addArchField(dl, 'arch.disagreement', a.disagreements);
    addArchField(dl, 'arch.primary', a.primarySource);
    addArchField(dl, 'arch.modern', a.scholarlySources);
    if (dl.children.length) card.appendChild(dl);

    var conf = (a.confidence || '').trim();
    if (conf) {
      var badge = el('div', 'arch-confidence');
      badge.appendChild(txt('span', 'christ-conf-label', t('arch.confidence')));
      badge.appendChild(txt('span', 'christ-conf-value christ-conf-' + confLevel(conf), conf));
      card.appendChild(badge);
    }
    return card.children.length ? card : null;
  }

  // a label/value pair, skipped when the value is empty
  function addArchField(dl, labelKey, val) {
    var text = (typeof val === 'string' ? val : '').trim();
    if (!text) return;
    dl.appendChild(txt('dt', 'arch-key', t(labelKey)));
    dl.appendChild(txt('dd', 'arch-val', text));
  }

  // the biblical passage becomes a link into the reader when it resolves
  function addArchRefField(dl, labelKey, val) {
    var ref = (typeof val === 'string' ? val : '').trim();
    if (!ref) return;
    dl.appendChild(txt('dt', 'arch-key', t(labelKey)));
    var dd = el('dd', 'arch-val');
    var loc = parseRef(ref);
    if (loc) {
      var link = txt('button', 'ctx-ref-link', ref);
      link.type = 'button';
      link.addEventListener('click', function () { openReaderAt(loc.book, loc.chapter); });
      dd.appendChild(link);
    } else {
      dd.textContent = ref;
    }
    dl.appendChild(dd);
  }

  /* Embed a public-domain artifact image via Wikimedia Commons' Special:FilePath,
     which resolves a plain file name to the actual image (no host-side hash to
     guess). We build the URL ourselves, so it is always Wikimedia-hosted, ask
     for a 480px thumbnail, show credit + license, and hide the figure if the
     file does not resolve. */
  function buildArtifactImage(image) {
    if (!image || typeof image !== 'object') return null;
    var file = (image.commonsFile || '').trim();
    if (!file) return null;
    var src = 'https://commons.wikimedia.org/wiki/Special:FilePath/' +
      encodeURIComponent(file) + '?width=480';

    var fig = el('figure', 'arch-figure');
    var img = el('img', 'arch-img');
    img.src = src;
    img.loading = 'lazy';
    img.alt = file.replace(/\.[a-z0-9]+$/i, '');
    img.addEventListener('error', function () { fig.hidden = true; });
    fig.appendChild(img);

    var credit = [image.credit, image.license].map(function (x) { return (x || '').trim(); })
      .filter(Boolean).join(' · ');
    if (credit) fig.appendChild(txt('figcaption', 'arch-credit', credit));
    return fig;
  }

  /* Biblical geography is a lazy panel too: opening it calls the `geography`
     endpoint for this book (or book+chapter) and renders a card per place,
     each with an interactive OpenStreetMap when the site is located. Kept
     separate from the heavy overview generation, like the archaeology panel. */
  function buildGeographyPanel(d, scope) {
    var det = el('details', 'ctx-section');
    var sum = el('summary', 'ctx-summary');
    sum.appendChild(txt('span', 'ctx-title', t(d.label)));
    det.appendChild(sum);
    var body = el('div', 'ctx-body');
    body.appendChild(txt('p', 'verse-panel-note', t('geo.hint')));
    det.appendChild(body);

    var loaded = false;
    det.addEventListener('toggle', function () {
      if (!det.open || loaded) return;
      loaded = true;
      body.textContent = '';
      body.appendChild(txt('p', 'verse-panel-note', t('geo.busy')));
      request('geography', scope)
        .then(function (data) {
          body.textContent = '';
          body.appendChild(renderGeography(data) || txt('p', 'verse-panel-note', t('geo.none')));
        })
        .catch(function (err) {
          loaded = false; // let the next open retry
          body.textContent = '';
          body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
        });
    });
    return det;
  }

  function renderGeography(data) {
    var places = data && (data.places || data.locations || data.items);
    if (!Array.isArray(places) || !places.length) return null;
    var wrap = el('div', 'arch-list');
    places.forEach(function (p) {
      var card = buildPlaceCard(p);
      if (card) wrap.appendChild(card);
    });
    return wrap.children.length ? wrap : null;
  }

  function buildPlaceCard(p) {
    if (!p) return null;
    var name = ((p.name || p.place) || '').trim();
    var card = el('div', 'arch-card geo-card');

    if (name) {
      var head = el('div', 'geo-head');
      head.appendChild(txt('h5', 'arch-name', name));
      var ident = (p.identification || p.status || '').trim();
      if (ident) head.appendChild(txt('span', 'geo-ident geo-ident-' + geoIdentLevel(ident), ident));
      card.appendChild(head);
    }

    var fig = buildArtifactImage(p.image);
    if (fig) card.appendChild(fig);

    var map = buildPlaceMap(p.lat, p.lng != null ? p.lng : p.lon);
    if (map) card.appendChild(map);

    var dl = el('dl', 'arch-fields');
    addArchField(dl, 'geo.modern', p.modernName || p.modern);
    addArchField(dl, 'geo.alternatives', p.alternatives);
    addArchField(dl, 'geo.region', p.region || p.boundaries);
    addArchField(dl, 'geo.importance', p.importance);
    addArchField(dl, 'geo.travel', p.travel);
    addArchField(dl, 'geo.archaeology', p.archaeology);
    addArchField(dl, 'geo.imagery', p.imagery);
    if (dl.children.length) card.appendChild(dl);

    addGeoGroup(card, 'geo.verses', buildCrossRefs(normalizeRefs(p.verses)));
    addGeoGroup(card, 'geo.people', buildNamedList(p.people));
    addGeoGroup(card, 'geo.events', buildBulletList(p.events));

    var conf = (p.confidence || '').trim();
    if (conf) {
      var badge = el('div', 'arch-confidence');
      badge.appendChild(txt('span', 'christ-conf-label', t('geo.confidence')));
      badge.appendChild(txt('span', 'christ-conf-value christ-conf-' + confLevel(conf), conf));
      card.appendChild(badge);
    }
    return card.children.length ? card : null;
  }

  // a labelled sub-group (verses / people / events) appended only when it has content
  function addGeoGroup(card, labelKey, node) {
    if (!node) return;
    card.appendChild(txt('h6', 'geo-group-title', t(labelKey)));
    card.appendChild(node);
  }

  /* An interactive, keyless OpenStreetMap embed centred on the site, plus a
     link out to the full map. Only rendered when the model gives real
     coordinates (a located, identifiable site); disputed/unknown sites get
     no map. */
  function buildPlaceMap(lat, lng) {
    var la = parseFloat(lat), lo = parseFloat(lng);
    if (!isFinite(la) || !isFinite(lo)) return null;
    if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
    if (la === 0 && lo === 0) return null; // null-island placeholder, treat as absent
    var d = 0.12;
    var bbox = [lo - d, la - d, lo + d, la + d].join(',');
    var wrap = el('div', 'geo-map');
    var frame = el('iframe', 'geo-map-frame');
    frame.src = 'https://www.openstreetmap.org/export/embed.html?bbox=' +
      encodeURIComponent(bbox) + '&layer=mapnik&marker=' + la + ',' + lo;
    frame.loading = 'lazy';
    frame.setAttribute('title', t('geo.mapTitle'));
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.addEventListener('error', function () { wrap.hidden = true; });
    wrap.appendChild(frame);
    var link = el('a', 'geo-map-link');
    link.href = 'https://www.openstreetmap.org/?mlat=' + la + '&mlon=' + lo + '#map=9/' + la + '/' + lo;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = t('geo.mapLink');
    wrap.appendChild(link);
    return wrap;
  }

  // identified -> green, disputed/uncertain -> amber, unknown/lost -> red
  function geoIdentLevel(s) {
    s = String(s || '').toLowerCase();
    if (/(unknown|unidentif|unlocat|not\s+located|lost)/.test(s)) return 'low';
    if (/(disput|uncertain|debat|proposed|possible|tentativ|approx)/.test(s)) return 'med';
    return 'high';
  }

  /* A chronological timeline is a lazy panel too: opening it calls the
     `timeline` endpoint for this book (or book+chapter) and renders a
     vertical timeline, one entry per event with its date, the figures
     alive, the empires and rulers of the period, and relevant
     archaeological and extrabiblical events. */
  function buildTimelinePanel(d, scope) {
    var det = el('details', 'ctx-section');
    var sum = el('summary', 'ctx-summary');
    sum.appendChild(txt('span', 'ctx-title', t(d.label)));
    det.appendChild(sum);
    var body = el('div', 'ctx-body');
    body.appendChild(txt('p', 'verse-panel-note', t('time.hint')));
    det.appendChild(body);

    var loaded = false;
    det.addEventListener('toggle', function () {
      if (!det.open || loaded) return;
      loaded = true;
      body.textContent = '';
      body.appendChild(txt('p', 'verse-panel-note', t('time.busy')));
      request('timeline', scope)
        .then(function (data) {
          body.textContent = '';
          body.appendChild(renderTimeline(data) || txt('p', 'verse-panel-note', t('time.none')));
        })
        .catch(function (err) {
          loaded = false; // let the next open retry
          body.textContent = '';
          body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
        });
    });
    return det;
  }

  function renderTimeline(data) {
    var entries = data && (data.entries || data.timeline || data.events || data.items);
    if (!Array.isArray(entries) || !entries.length) return null;
    var wrap = el('div', 'timeline');
    entries.forEach(function (e) {
      var node = buildTimelineEntry(e);
      if (node) wrap.appendChild(node);
    });
    return wrap.children.length ? wrap : null;
  }

  function buildTimelineEntry(e) {
    if (!e) return null;
    var event = ((e.event || e.title || e.name) || '').trim();
    var date = ((e.date || e.approxDate) || '').trim();
    if (!event && !date) return null;

    var item = el('div', 'tl-item');
    item.appendChild(el('span', 'tl-marker'));
    var card = el('div', 'arch-card tl-card');
    if (date) card.appendChild(txt('div', 'tl-date', date));
    if (event) card.appendChild(txt('h5', 'tl-event', event));

    var dl = el('dl', 'arch-fields');
    addArchRefField(dl, 'time.reference', e.reference || e.passage);
    addArchField(dl, 'time.alt', e.alternativeDates || e.altDates);
    if (dl.children.length) card.appendChild(dl);

    addGeoGroup(card, 'time.figures', buildNamedList(e.figures));
    addGeoGroup(card, 'time.empires', buildBulletList(e.empires));
    addGeoGroup(card, 'time.rulers', buildNamedList(e.rulers));
    addGeoGroup(card, 'time.archaeology', buildBulletList(e.archaeology));
    addGeoGroup(card, 'time.extrabiblical', buildBulletList(e.extrabiblical));

    item.appendChild(card);
    return card.children.length ? item : null;
  }

  function buildStudySection(d, val) {
    if (d.type === 'prose') return buildProseSection(val);
    if (d.type === 'list') return buildBulletList(val);
    if (d.type === 'named') return buildNamedList(val);
    if (d.type === 'refs') return buildCrossRefs(normalizeRefs(val));
    if (d.type === 'quiz') return buildKnowledgeCheck(val);
    if (d.type === 'faq') return buildFaqSection(val);
    return null;
  }

  function buildBulletList(arr) {
    if (!Array.isArray(arr)) return null;
    var ul = el('ul', 'ctx-list');
    arr.forEach(function (item) {
      var text = (typeof item === 'string' ? item : (item && (item.text || item.label || item.point))) || '';
      text = String(text).trim();
      if (text) ul.appendChild(txt('li', 'ctx-list-item', text));
    });
    return ul.children.length ? ul : null;
  }

  function buildNamedList(arr) {
    if (!Array.isArray(arr)) return null;
    var ul = el('ul', 'ctx-list');
    arr.forEach(function (item) {
      var name = '', note = '';
      if (typeof item === 'string') { name = item; }
      else if (item) { name = item.name || item.title || ''; note = item.note || item.description || ''; }
      name = String(name).trim();
      note = String(note).trim();
      if (!name && !note) return;
      var li = el('li', 'ctx-list-item');
      if (name) li.appendChild(txt('span', 'ctx-name', name));
      if (note) li.appendChild(txt('span', 'ctx-ref-note', (name ? ' — ' : '') + note));
      ul.appendChild(li);
    });
    return ul.children.length ? ul : null;
  }

  /* The knowledge check now comes in two tiers — medium (3) and hard (5).
     Accepts the new { medium, hard } shape and still renders a legacy flat
     array of questions as a single untiered check. */
  function buildKnowledgeCheck(val) {
    if (Array.isArray(val)) return buildQuizList(val);
    if (!val || typeof val !== 'object') return null;
    var wrap = el('div', 'quiz-tiers');
    var med = buildQuizTier('chap.quizMedium', val.medium);
    var hard = buildQuizTier('chap.quizHard', val.hard);
    if (med) wrap.appendChild(med);
    if (hard) wrap.appendChild(hard);
    return wrap.children.length ? wrap : null;
  }

  function buildQuizTier(labelKey, arr) {
    var list = buildQuizList(arr);
    if (!list) return null;
    var box = el('div', 'quiz-tier');
    box.appendChild(txt('h6', 'quiz-tier-title', t(labelKey)));
    box.appendChild(list);
    return box;
  }

  // an interactive multiple-choice knowledge check; each question locks after a pick
  function buildQuizList(arr) {
    if (!Array.isArray(arr) || !arr.length) return null;
    var wrap = el('div', 'chap-quiz');
    arr.forEach(function (q, qi) {
      var question = ((q && q.question) || '').trim();
      var options = (q && Array.isArray(q.options)) ? q.options : [];
      if (!question || !options.length) return;
      var answerIdx = (q && typeof q.answer === 'number') ? q.answer : 0;
      var explanation = ((q && q.explanation) || '').trim();

      var card = el('div', 'quiz-q');
      card.appendChild(txt('p', 'quiz-q-text', (qi + 1) + '. ' + question));
      var opts = el('div', 'quiz-opts');
      var exp = txt('p', 'quiz-explain', explanation);
      exp.hidden = true;
      var answered = false;

      options.forEach(function (opt, oi) {
        var b = txt('button', 'quiz-opt', String(opt));
        b.type = 'button';
        b.addEventListener('click', function () {
          if (answered) return;
          answered = true;
          [].slice.call(opts.children).forEach(function (child, ci) {
            child.classList.add('is-locked');
            if (ci === answerIdx) child.classList.add('is-correct');
          });
          if (oi !== answerIdx) b.classList.add('is-wrong');
          if (explanation) exp.hidden = false;
        });
        opts.appendChild(b);
      });
      card.appendChild(opts);
      if (explanation) card.appendChild(exp);
      wrap.appendChild(card);
    });
    return wrap.children.length ? wrap : null;
  }

  /* Common questions: a FAQ accordion. Each question is its own collapsible
     row so the section stays scannable; the answer may hold a few paragraphs,
     followed by an optional verse reference the backend tags the question with,
     linked into the reader. */
  function buildFaqSection(arr) {
    if (!Array.isArray(arr) || !arr.length) return null;
    var wrap = el('div', 'faq-list');
    arr.forEach(function (item) {
      var q = ((item && (item.question || item.q)) || '').trim();
      var an = ((item && (item.answer || item.a)) || '').trim();
      if (!q || !an) return;
      var det = el('details', 'faq-item');
      var sum = el('summary', 'faq-q');
      sum.appendChild(txt('span', 'faq-q-text', q));
      det.appendChild(sum);
      var body = el('div', 'faq-a');
      an.split(/\n{2,}|\r\n\r\n/).forEach(function (p) {
        p = p.trim();
        if (p) body.appendChild(txt('p', 'faq-a-text', p));
      });
      if (!body.children.length) body.appendChild(txt('p', 'faq-a-text', an));
      var verseLine = buildFaqVerse(item && (item.verse || item.reference || item.ref || item.passage));
      if (verseLine) body.appendChild(verseLine);
      det.appendChild(body);
      wrap.appendChild(det);
    });
    return wrap.children.length ? wrap : null;
  }

  /* The verse reference a FAQ item points at: "📖 See <ref>", where each
     resolvable reference links into that chapter of the reader. Accepts a
     string ("Exodus 3:6"), a list, or several refs separated by ; / , and
     renders nothing when there's no usable reference. */
  function buildFaqVerse(val) {
    if (!val) return null;
    var refs = (Array.isArray(val) ? val : String(val).split(/\s*[;,]\s*/))
      .map(function (r) { return String(r).trim(); })
      .filter(Boolean);
    if (!refs.length) return null;
    var p = el('p', 'faq-a-verse');
    p.appendChild(txt('span', 'faq-verse-label', '📖 ' + t('chap.faqSee') + ' '));
    refs.forEach(function (reference, i) {
      if (i) p.appendChild(txt('span', 'faq-verse-sep', '; '));
      var loc = parseRef(reference);
      if (loc) {
        var link = txt('button', 'faq-verse-link', reference);
        link.type = 'button';
        link.addEventListener('click', function () { openReaderAt(loc.book, loc.chapter); });
        p.appendChild(link);
      } else {
        p.appendChild(txt('span', 'faq-verse-ref', reference));
      }
    });
    return p;
  }

  // --- context & resources: generated per verse by the backend ---
  function fillContextPanel(panel, verse) {
    fetchInto(panel, 'verse-context', verse, {}, function (data) {
      return renderVerseContext(data);
    });
  }

  function fillResourcesPanel(panel, verse) {
    fetchInto(panel, 'verse-resources', verse, {}, function (data) {
      var items = (data && data.resources) || [];
      if (!items.length) return null;
      var ul = el('ul', 'verse-resource-list');
      items.forEach(function (item) {
        var li = el('li');
        if (item && item.url) {
          var a = txt('a', null, item.title || item.url);
          a.href = item.url;
          a.target = '_blank';
          a.rel = 'noopener';
          li.appendChild(a);
        } else {
          li.textContent = (item && item.title) || String(item);
        }
        ul.appendChild(li);
      });
      return ul;
    });
  }

  // --- knowledge check: easy / medium / hard, each a generated quiz ---
  function fillCheckPanel(panel, verse) {
    var diffs = el('div', 'quiz-diffs');
    var quiz = el('div', 'quiz-area');
    var buttons = {};

    [
      { id: 'easy', key: 'bible.easy' },
      { id: 'medium', key: 'bible.medium' },
      { id: 'hard', key: 'bible.hard' }
    ].forEach(function (level) {
      var btn = txt('button', 'quiz-diff', t(level.key));
      btn.type = 'button';
      btn.addEventListener('click', function () {
        Object.keys(buttons).forEach(function (id) {
          buttons[id].classList.toggle('is-active', id === level.id);
        });
        loadQuiz(quiz, verse, level.id);
      });
      buttons[level.id] = btn;
      diffs.appendChild(btn);
    });

    panel.appendChild(diffs);
    panel.appendChild(quiz);
  }

  function loadQuiz(area, verse, difficulty) {
    fetchInto(area, 'verse-quiz', verse, { difficulty: difficulty }, function (data) {
      return data && data.question ? buildQuiz(data) : null;
    });
  }

  function buildQuiz(data) {
    var wrap = el('div', 'quiz');
    wrap.appendChild(txt('p', 'quiz-question', data.question));

    var options = data.options || [];
    var answer = typeof data.answer === 'number' ? data.answer : -1;
    var explain = el('p', 'quiz-explain');
    explain.hidden = true;

    options.forEach(function (option, index) {
      var btn = txt('button', 'quiz-option', option);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var picks = wrap.querySelectorAll('.quiz-option');
        for (var i = 0; i < picks.length; i++) {
          picks[i].disabled = true;
          if (i === answer) picks[i].classList.add('is-correct');
        }
        if (index !== answer) btn.classList.add('is-wrong');
        if (data.explanation) {
          explain.textContent = data.explanation;
          explain.hidden = false;
        }
      });
      wrap.appendChild(btn);
    });

    wrap.appendChild(explain);
    return wrap;
  }

  /* One shape for every backend-fed panel: show a loading line, then either the
     built content or the "not connected yet" notice when the endpoint is empty. */
  function fetchInto(container, path, verse, extra, build) {
    container.textContent = '';
    container.appendChild(txt('p', 'verse-panel-note', t('bible.loading')));

    var body = {
      book: bibleState.book.name,
      chapter: bibleState.chapter,
      verse: verse.number,
      version: currentVersion()
    };
    Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });

    requestCached(path, body)
      .then(function (data) {
        var node = build(data);
        container.textContent = '';
        container.appendChild(node || txt('p', 'verse-panel-note', t('bible.sectionUnavailable')));
      })
      .catch(function (err) {
        container.textContent = '';
        container.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

  function stepChapter(delta) {
    if (!bibleState.book) return;
    var next = bibleState.chapter + delta;
    if (next < 1 || next > bibleState.book.chapters) return;
    bibleState.chapter = next;
    window.scrollTo(0, 0);
    loadChapter();
  }

  document.getElementById('bible-back').addEventListener('click', function () {
    if (bibleState.screen === 'verse') {
      showBibleScreen('reader');
      // land back on the verse we studied rather than the top of the chapter
      var card = document.querySelector('.verse-card[data-verse="' + bibleState.verse + '"]');
      if (card) card.scrollIntoView({ block: 'center' });
    } else if (bibleState.screen === 'reader') {
      renderChapterGrid();
      showBibleScreen('chapters');
    } else if (bibleState.screen === 'chapters') {
      renderBookGrid();
      showBibleScreen('books');
    } else if (bibleState.screen === 'books') {
      showBibleScreen('testaments');
    }
    window.scrollTo(0, 0);
  });

  document.getElementById('bible-prev').addEventListener('click', function () { stepChapter(-1); });
  document.getElementById('bible-next').addEventListener('click', function () { stepChapter(1); });

  /* Book search in the Bible view: type any book name and jump to its chapters.
     Works across both testaments regardless of which screen you're on. */
  (function wireBibleBookSearch() {
    var input = document.getElementById('bible-book-query');
    var results = document.getElementById('bible-book-results');
    if (!input || !results) return;
    input.addEventListener('input', function () {
      renderBookSuggestions(results, input.value, function (name) {
        input.value = '';
        results.hidden = true;
        openBookChapters(name);
      });
    });
    // Enter jumps straight to the single best match
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var best = matchBooks(input.value, 1)[0];
      if (best) { input.value = ''; results.hidden = true; openBookChapters(best.book.name); }
    });
  })();

  // rebuilt on a language change so the labels and breadcrumb follow the UI
  function renderBibleBrowser() {
    renderTestamentCards();
    renderVersionOptions();
    if (bibleState.screen === 'books') renderBookGrid();
    else if (bibleState.screen === 'chapters') renderChapterGrid();
    else if (bibleState.screen === 'verse') renderVerseFocus();
    updateBibleCrumbs();
    updatePrevNext();
  }

  /* ---------- chapter guide: overview, how it points to Jesus, background ---------- */

  /* Which book|chapter the guide currently holds, so opening it twice on the same
     chapter doesn't refetch, but moving to a new chapter does. */
  var chapterGuideKey = null;

  function resetChapterGuide() {
    var guide = document.getElementById('chapter-guide');
    var body = document.getElementById('chapter-guide-body');
    if (!guide || !body) return;
    guide.open = false;
    body.textContent = '';
    chapterGuideKey = null;
  }

  function loadChapterGuide() {
    var body = document.getElementById('chapter-guide-body');
    if (!body || !bibleState.book) return;
    var key = bibleState.book.name + '|' + bibleState.chapter;
    if (chapterGuideKey === key) return;
    chapterGuideKey = key;

    body.textContent = '';
    body.appendChild(txt('p', 'verse-panel-note', t('bible.guideBusy')));

    requestCached('chapter-insight', { book: bibleState.book.name, chapter: bibleState.chapter })
      .then(function (data) {
        // a late reply for a chapter we've since left shouldn't overwrite the new one
        if (chapterGuideKey !== key) return;
        var scope = bibleState.book.name + ' ' + bibleState.chapter;
        body.textContent = '';
        var rich = renderChapterOverview(data);
        if (rich) { body.appendChild(rich); injectAdminWorld(body, scope); appendProvenance(body, false); return; }
        // fall back to the older overview / points-to-Christ / background layout
        renderInsight(body, [
          { key: 'bible.overview', text: data && data.overview },
          { key: 'bible.pointsToChrist', text: data && data.christ },
          { key: 'bible.background', text: data && data.history }
        ], 'bible.guideUnavailable');
        appendProvenance(body, false);
      })
      .catch(function (err) {
        chapterGuideKey = null; // allow a retry on the next open
        body.textContent = '';
        body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

  /* The chapter's "Frequently asked questions" panel — its own section in the
     reader, separate from the chapter guide. It shows ONLY the owner-published
     FAQ for this chapter (from the shared admin store); there is no generated
     fallback. The whole panel stays hidden on chapters without a curated FAQ,
     so the tab appears only where questions have actually been written. It
     loads eagerly on chapter open (one cheap, cached admin-store read) to decide
     that visibility up front. */
  var chapterFaqKey = null;

  function resetChapterFaq() {
    var faq = document.getElementById('chapter-faq');
    var body = document.getElementById('chapter-faq-body');
    if (!faq || !body) return;
    faq.open = false;
    faq.hidden = true;
    body.textContent = '';
    chapterFaqKey = null;
  }

  function loadChapterFaq() {
    var faq = document.getElementById('chapter-faq');
    var body = document.getElementById('chapter-faq-body');
    if (!faq || !body || !bibleState.book) return;
    var key = bibleState.book.name + '|' + bibleState.chapter;
    if (chapterFaqKey === key) return;
    chapterFaqKey = key;
    var scope = bibleState.book.name + ' ' + bibleState.chapter;

    adminList('faq', scope).then(function (faqs) {
      if (chapterFaqKey !== key) return;
      var qa = (faqs && faqs.length && Array.isArray(faqs[0].qa)) ? faqs[0].qa : null;
      var node = buildFaqSection(qa);
      if (!node) { faq.hidden = true; body.textContent = ''; return; }  // no owner FAQ → hide the tab
      body.textContent = '';
      body.appendChild(node);
      faq.hidden = false;
    }, function () {
      if (chapterFaqKey !== key) return;
      chapterFaqKey = null;   // a failed read shouldn't stick; allow a retry
      faq.hidden = true;
    });
  }

  document.getElementById('chapter-faq').addEventListener('toggle', function () {
    if (this.open) loadChapterFaq();
  });
  warmOnIntent(document.getElementById('chapter-faq'), loadChapterFaq);

  document.getElementById('chapter-guide').addEventListener('toggle', function () {
    if (this.open) loadChapterGuide();
  });
  // warm it on hover/focus so the guide is generating before it's opened
  warmOnIntent(document.getElementById('chapter-guide'), loadChapterGuide);

  /* The whole-book overview that sits above the chapter grid. Keyed by book
     so it refetches when you switch books but not when reopened on the same. */
  var bookGuideKey = null;

  function resetBookGuide() {
    var guide = document.getElementById('book-guide');
    var body = document.getElementById('book-guide-body');
    if (!guide || !body) return;
    guide.open = false;
    body.textContent = '';
    bookGuideKey = null;
  }

  function loadBookGuide() {
    var body = document.getElementById('book-guide-body');
    if (!body || !bibleState.book) return;
    var key = bibleState.book.name;
    if (bookGuideKey === key) return;
    bookGuideKey = key;

    // If a verified curated overview exists for this book, show it immediately —
    // no waiting on the slow (~3 min) backend, and it can never be blocked by a
    // backend timeout or an empty reply. The backend still loads in the
    // background to fill the sections the curated entry doesn't cover.
    var curated = curatedBookOnly();
    body.textContent = '';
    if (curated) {
      var seed = renderBookOverview(curated);
      if (seed) { body.appendChild(seed); injectAdminWorld(body, key); appendProvenance(body, true); }
      else body.appendChild(txt('p', 'verse-panel-note', t('bible.bookBusy')));
    } else {
      body.appendChild(txt('p', 'verse-panel-note', t('bible.bookBusy')));
    }

    requestCached('book-insight', { book: bibleState.book.name })
      .then(function (data) {
        if (bookGuideKey !== key) return;
        var rich = renderBookOverview(withCuratedBook(data));
        if (rich) { body.textContent = ''; body.appendChild(rich); injectAdminWorld(body, key); appendProvenance(body, !!curated); return; }
        if (curated) return; // keep the curated overview already on screen
        renderInsight(body, [
          { key: 'bible.bookAbout', text: data && data.overview },
          { key: 'bible.pointsToChrist', text: data && data.christ },
          { key: 'bible.bookBackground', text: data && data.history }
        ], 'bible.bookUnavailable');
        appendProvenance(body, false);
      })
      .catch(function (err) {
        if (bookGuideKey !== key) return;
        if (curated) return; // the verified overview is already shown; leave it
        bookGuideKey = null;
        body.textContent = '';
        body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

  document.getElementById('book-guide').addEventListener('toggle', function () {
    if (this.open) loadBookGuide();
  });
  warmOnIntent(document.getElementById('book-guide'), loadBookGuide);

  /* ---------- single-verse study view ---------- */

  /* The chosen version's human label, shown under the reference so the reader
     always knows which translation they're looking at. */
  function currentVersionLabel() {
    var id = currentVersion();
    for (var i = 0; i < BIBLE_VERSIONS.length; i++) {
      if (BIBLE_VERSIONS[i].id === id) {
        return BIBLE_VERSIONS[i].labelKey ? t(BIBLE_VERSIONS[i].labelKey) : BIBLE_VERSIONS[i].label;
      }
    }
    return id || t('settings.translationDefault');
  }

  function currentVerseObj() {
    var vs = bibleState.chapterVerses || [];
    for (var i = 0; i < vs.length; i++) {
      if (vs[i].number === bibleState.verse) return vs[i];
    }
    return null;
  }

  function openVerseFocus(number) {
    bibleState.verse = number;
    showBibleScreen('verse');
    renderVerseFocus();
    window.scrollTo(0, 0);
  }

  function renderVerseFocus() {
    if (!bibleState.book) return;
    var v = currentVerseObj();
    document.getElementById('verse-focus-ref').textContent =
      bibleState.book.name + ' ' + bibleState.chapter + ':' + bibleState.verse;
    document.getElementById('verse-focus-version').textContent = currentVersionLabel();

    var text = document.getElementById('verse-focus-text');
    text.textContent = v ? v.text : t('bible.noVerseText');
    text.classList.toggle('is-empty', !v);

    renderFocusVideo(document.getElementById('verse-focus-video'), bibleState.verse);
    resetFocusDetails();
    updateVerseNav();
    updateBibleCrumbs();
    applyReadingPrefs();
  }

  /* The three expandables (context / chapter / book) each remember which
     verse|chapter|book they last filled, so reopening on the same target is
     free but moving to a new one refetches. */
  var focusKeys = { context: null, chapter: null, book: null, original: null };

  function resetFocusDetails() {
    ['verse-focus-original', 'verse-focus-context', 'verse-focus-chapter', 'verse-focus-book'].forEach(function (id) {
      var d = document.getElementById(id);
      if (d) d.open = false;
    });
    ['verse-focus-original-body', 'verse-focus-context-body', 'verse-focus-chapter-body', 'verse-focus-book-body'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.textContent = '';
    });
    focusKeys = { context: null, chapter: null, book: null, original: null };
  }

  function updateVerseNav() {
    var vs = bibleState.chapterVerses || [];
    var first = vs.length ? vs[0].number : 1;
    var last = vs.length ? vs[vs.length - 1].number : 1;
    var atStart = bibleState.chapter <= 1 && bibleState.verse <= first;
    var atEnd = bibleState.book &&
      bibleState.chapter >= bibleState.book.chapters && bibleState.verse >= last;
    document.getElementById('verse-focus-prev').disabled = atStart;
    document.getElementById('verse-focus-next').disabled = !!atEnd;
  }

  // move one verse at a time, rolling into the neighbouring chapter at the edges
  function stepVerse(delta) {
    var vs = bibleState.chapterVerses || [];
    var idx = -1;
    for (var i = 0; i < vs.length; i++) {
      if (vs[i].number === bibleState.verse) { idx = i; break; }
    }
    var next = idx + delta;
    if (idx !== -1 && next >= 0 && next < vs.length) {
      bibleState.verse = vs[next].number;
      renderVerseFocus();
      window.scrollTo(0, 0);
      return;
    }
    if (!bibleState.book) return;
    if (delta < 0 && bibleState.chapter > 1) {
      bibleState.chapter -= 1;
      bibleState.focusAfterLoad = 'last';
      showFocusLoading();
      loadChapter();
    } else if (delta > 0 && bibleState.chapter < bibleState.book.chapters) {
      bibleState.chapter += 1;
      bibleState.focusAfterLoad = 'first';
      showFocusLoading();
      loadChapter();
    }
  }

  function showFocusLoading() {
    document.getElementById('verse-focus-text').textContent = t('bible.busyStatus');
  }

  document.getElementById('verse-focus-prev').addEventListener('click', function () { stepVerse(-1); });
  document.getElementById('verse-focus-next').addEventListener('click', function () { stepVerse(1); });

  /* The verse's video, shown inline right under the text: the saved embed if one
     was posted, otherwise the paste-a-link form. Shares the same per-verse key as
     the chapter reader, so a video posted in either place shows in both. */
  function renderFocusVideo(container, number) {
    container.textContent = '';
    var map = loadVideos();
    var saved = map[verseKey(number)];

    if (saved) {
      var embed = videoEmbed(saved);
      if (embed) {
        container.appendChild(embed);
      } else {
        var link = txt('a', 'verse-video-link', saved);
        link.href = saved;
        link.target = '_blank';
        link.rel = 'noopener';
        container.appendChild(link);
      }
      var remove = txt('button', 'verse-panel-btn', t('bible.videoRemove'));
      remove.type = 'button';
      remove.addEventListener('click', function () {
        var m = loadVideos();
        delete m[verseKey(number)];
        saveVideos(m);
        renderFocusVideo(container, number);
      });
      container.appendChild(remove);
      return;
    }

    var form = el('div', 'verse-video-form');
    var input = el('input', 'verse-video-input');
    input.type = 'url';
    input.placeholder = t('bible.videoHint');
    var post = txt('button', 'verse-panel-btn', t('bible.videoPost'));
    post.type = 'button';
    var note = el('p', 'verse-panel-note');
    note.textContent = t('bible.verseVideoHint');

    post.addEventListener('click', function () {
      var url = input.value.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) { note.textContent = t('bible.videoInvalid'); return; }
      var m = loadVideos();
      m[verseKey(number)] = url;
      saveVideos(m);
      renderFocusVideo(container, number);
    });

    form.appendChild(input);
    form.appendChild(post);
    container.appendChild(form);
    container.appendChild(note);
  }

  // shared renderer for the chapter/book overview panels
  function renderInsight(body, sections, emptyKey) {
    body.textContent = '';
    var any = false;
    sections.forEach(function (s) {
      var text = (s.text || '').trim();
      if (!text) return;
      any = true;
      body.appendChild(txt('h4', 'chapter-guide-heading', t(s.key)));
      body.appendChild(txt('p', 'chapter-guide-text', text));
    });
    if (!any) body.appendChild(txt('p', 'verse-panel-note', t(emptyKey)));
  }

  // label for a version id, mirroring currentVersionLabel but for any id
  function versionLabelFor(id) {
    for (var i = 0; i < BIBLE_VERSIONS.length; i++) {
      if (BIBLE_VERSIONS[i].id === id) {
        return BIBLE_VERSIONS[i].labelKey ? t(BIBLE_VERSIONS[i].labelKey) : BIBLE_VERSIONS[i].label;
      }
    }
    return id || t('settings.translationDefault');
  }

  // pull one verse's text out of a fetched chapter payload; verse numbers can
  // come back as strings ("1") or ints, so compare them loosely by value
  function pickVerseText(data, number) {
    var vs = extractVerses(data);
    var want = String(number);
    for (var i = 0; i < vs.length; i++) {
      if (String(vs[i].number) === want) return vs[i].text;
    }
    return '';
  }

  /* ---- word-level interlinear (Strong's) ----
     The Original-language panel shows the Hebrew/Greek tagged with Strong's
     numbers (bolls.life: WLCa for the OT, TISCH for the NT). Each word is a
     chip; hovering, tapping, or focusing it shows its transliteration and a
     concise gloss from window.STRONGS_GLOSS (js/strongs-gloss.js, loaded on
     demand). The reader's own translation still reveals for the whole verse. */
  var BOLLS_OT = 'WLCa', BOLLS_NT = 'TISCH';
  var bollsCache = {};        // url -> Promise of a chapter's verse array
  var glossPromise = null;    // resolves once the gloss dictionary is loaded

  // bolls numbers the books 1-66 in the standard canon, matching BIBLE_BOOKS order
  var BOLLS_BOOK_NO = (function () {
    var map = {}, n = 0;
    BIBLE_BOOKS.forEach(function (grp) {
      grp.books.forEach(function (b) { map[b.name] = ++n; });
    });
    return map;
  })();

  // load the Strong's gloss dictionary once, on first use of the panel
  function ensureGloss() {
    if (window.STRONGS_GLOSS) return Promise.resolve(window.STRONGS_GLOSS);
    if (glossPromise) return glossPromise;
    glossPromise = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'js/strongs-gloss.js';
      s.onload = function () { resolve(window.STRONGS_GLOSS || {}); };
      s.onerror = function () { resolve({}); };   // words still show without a gloss
      document.head.appendChild(s);
    });
    return glossPromise;
  }

  // fetch one bolls chapter (cached in-session), returning its verse array
  function fetchBolls(trans, bookNo, chapter) {
    var url = 'https://bolls.life/get-text/' + trans + '/' + bookNo + '/' + chapter + '/';
    if (!bollsCache[url]) {
      bollsCache[url] = fetch(url).then(function (r) {
        if (!r.ok) throw new Error('bolls ' + r.status);
        return r.json();
      }).catch(function (e) { delete bollsCache[url]; throw e; });
    }
    return bollsCache[url];
  }
  function pickBollsVerse(arr, number) {
    if (!Array.isArray(arr)) return '';
    var want = String(number);
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].verse) === want) return arr[i].text || '';
    }
    return '';
  }

  // split a Strong's-tagged verse ("word<S>7225</S> …") into word tokens, each
  // carrying its Strong's number(s), transliteration, and gloss
  function parseStrongTokens(text, isHebrew, gloss) {
    var out = [];
    String(text || '').split(/\s+/).forEach(function (chunk) {
      if (!chunk) return;
      var nums = [], m, re = /<S>(\d+)<\/S>/g;
      while ((m = re.exec(chunk))) nums.push(m[1]);
      // drop the whole <S>number</S> spans, then any other stray tags
      var word = chunk.replace(/<S>\d+<\/S>/g, '').replace(/<[^>]*>/g, '').trim();
      if (!word && !nums.length) return;
      var entries = nums.map(function (num) {
        var key = (isHebrew ? 'H' : 'G') + num;
        var g = gloss && gloss[key];
        return { strong: key, translit: g ? g[0] : '', gloss: g ? g[1] : '' };
      });
      out.push({ word: word, entries: entries });
    });
    return out;
  }

  // the shared tooltip: fill it for a word, then place it under that word
  function fillWordTip(tip, tk) {
    tip.textContent = '';
    tip.appendChild(txt('span', 'vf-tip-word', tk.word));
    if (!tk.entries.length) {
      tip.appendChild(txt('span', 'vf-tip-gloss', t('bible.originalNoGloss')));
      return;
    }
    tk.entries.forEach(function (e) {
      var head = el('div', 'vf-tip-head');
      if (e.translit) head.appendChild(txt('span', 'vf-tip-translit', e.translit));
      head.appendChild(txt('span', 'vf-tip-strong', e.strong));
      tip.appendChild(head);
      tip.appendChild(txt('span', 'vf-tip-gloss', e.gloss || t('bible.originalNoGloss')));
    });
  }
  function placeWordTip(tip, wordEl, wrap) {
    tip.hidden = false;                       // must be visible to measure width
    var wrapR = wrap.getBoundingClientRect();
    var wr = wordEl.getBoundingClientRect();
    var top = wr.bottom - wrapR.top + 6;
    var left = wr.left - wrapR.left + wr.width / 2;
    var half = tip.offsetWidth / 2;
    left = Math.max(half + 4, Math.min(left, wrapR.width - half - 4));
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  }

  /* The New Testament was written in Koine Greek, but its authors sometimes kept
     a word in the Aramaic it was actually spoken — often a saying of Jesus, and
     usually translated by the text itself. This curated table surfaces those
     genuine Aramaic words on the verses where they appear (keyed "Book Ch:Vs");
     it is not a claim that the NT was composed in Aramaic. Each entry carries a
     standard transliteration and the meaning. */
  var NT_ARAMAIC = {
    'Matthew 5:22':  [{ translit: 'raca (rēqā)', meaning: 'a word of contempt — “empty-headed”, “worthless”' }],
    'Matthew 6:24':  [{ translit: 'mammon (māmōnā)', meaning: 'money or wealth personified as a master' }],
    'Matthew 27:33': [{ translit: 'Golgotha (gulgaltā)', meaning: '“place of a skull” — the text translates it' }],
    'Matthew 27:46': [{ translit: 'Eli, Eli, lema sabachthani', meaning: '“My God, my God, why have you forsaken me?” (Psalm 22:1); “Eli” is the Hebrew form of the Aramaic “Eloi”' }],
    'Mark 3:17':     [{ translit: 'Boanerges (bnē reges)', meaning: '“sons of thunder” — the name Jesus gave James and John' }],
    'Mark 5:41':     [{ translit: 'Talitha koum (ṭlīthā qūm)', meaning: '“Little girl, I say to you, arise” — the text translates it' }],
    'Mark 7:11':     [{ translit: 'Corban (qorbān)', meaning: '“given to God” — a gift dedicated as an offering' }],
    'Mark 7:34':     [{ translit: 'Ephphatha (ethpataḥ)', meaning: '“Be opened” — spoken as Jesus healed a deaf man' }],
    'Mark 10:51':    [{ translit: 'Rabbouni (rabbūnī)', meaning: '“my teacher / my master” — blind Bartimaeus to Jesus' }],
    'Mark 14:36':    [{ translit: 'Abba (abbā)', meaning: '“Father” — Jesus’ intimate address to God in Gethsemane' }],
    'Mark 15:22':    [{ translit: 'Golgotha (gulgaltā)', meaning: '“place of a skull” — the text translates it' }],
    'Mark 15:34':    [{ translit: 'Eloi, Eloi, lema sabachthani', meaning: '“My God, my God, why have you forsaken me?” (Psalm 22:1) — Jesus’ cry from the cross' }],
    'Luke 16:13':    [{ translit: 'mammon (māmōnā)', meaning: 'money or wealth personified as a master' }],
    'John 1:42':     [{ translit: 'Cephas (kēphā)', meaning: '“rock” — which the text renders as Peter' }],
    'John 19:13':    [{ translit: 'Gabbatha (gabbethā)', meaning: '“the Stone Pavement” — the text names it in Aramaic' }],
    'John 19:17':    [{ translit: 'Golgotha (gulgaltā)', meaning: '“place of a skull” — the text translates it' }],
    'John 20:16':    [{ translit: 'Rabbouni (rabbūnī)', meaning: '“Teacher” — Mary Magdalene’s cry to the risen Jesus; the text translates it' }],
    'Acts 1:19':     [{ translit: 'Akeldama (ḥăqēl dmā)', meaning: '“Field of Blood” — named in the local Aramaic' }],
    'Romans 8:15':   [{ translit: 'Abba (abbā)', meaning: '“Father” — the Aramaic cry of God’s adopted children' }],
    '1 Corinthians 16:22': [{ translit: 'Maranatha (māranā thā)', meaning: '“Our Lord, come!” — an early Aramaic prayer' }],
    'Galatians 4:6': [{ translit: 'Abba (abbā)', meaning: '“Father” — the Spirit’s cry within believers' }]
  };
  function aramaicWordsFor(book, chapter, verse) {
    return NT_ARAMAIC[book + ' ' + chapter + ':' + verse] || null;
  }

  // join the per-word transliterations into a single spoken-form line, in the
  // verse's own reading order (the first entry that carries a translit per word)
  function buildTransliteration(tokens) {
    if (!tokens || !tokens.length) return '';
    var parts = [];
    tokens.forEach(function (tk) {
      var tr = '';
      for (var i = 0; i < tk.entries.length; i++) {
        if (tk.entries[i].translit) { tr = tk.entries[i].translit; break; }
      }
      if (tr) parts.push(tr);
    });
    return parts.join(' ');
  }

  function renderOriginalInteractive(tokens, plainOriginal, translations, isHebrew, aramaic, targum) {
    var wrap = el('div', 'vf-original');
    var interlinear = !!(tokens && tokens.length);
    translations = translations || [];

    wrap.appendChild(txt('p', 'vf-original-lang', isHebrew ? t('bible.originalHebrew') : t('bible.originalGreek')));

    // a plain-language welcome so a newcomer meeting Hebrew/Greek for the first
    // time knows what they're looking at and how to use it (works on touch, too)
    if (interlinear) wrap.appendChild(txt('p', 'vf-original-intro', t('bible.originalIntro')));

    // --- Written: the Hebrew/Greek script itself ---
    var written = el('div', 'vf-original-section vf-original-written');
    written.appendChild(txt('p', 'vf-original-section-label', t('bible.originalWritten')));

    var line = el('p', 'vf-original-text');
    if (isHebrew) { line.setAttribute('dir', 'rtl'); line.classList.add('is-rtl'); }

    var tip = el('div', 'vf-tip'); tip.hidden = true;

    if (interlinear) {
      line.classList.add('is-interlinear');
      tokens.forEach(function (tk) {
        var w = txt('span', 'vf-word', tk.word);
        w.setAttribute('tabindex', '0');
        if (tk.entries.some(function (e) { return e.gloss || e.translit; })) w.classList.add('has-gloss');
        function show() { fillWordTip(tip, tk); placeWordTip(tip, w, wrap); tip._active = w; }
        function hide() { tip.hidden = true; tip._active = null; }
        w.addEventListener('mouseenter', show);
        w.addEventListener('mouseleave', hide);
        w.addEventListener('focus', show);
        w.addEventListener('blur', hide);
        w.addEventListener('click', function (e) {
          e.stopPropagation();               // don't also toggle the verse translation
          // tap this word to show it; tap the same word again to dismiss (touch)
          if (!tip.hidden && tip._active === w) hide(); else show();
        });
        line.appendChild(w);
        line.appendChild(document.createTextNode(' '));
      });
    } else {
      line.textContent = plainOriginal;
      line.setAttribute('tabindex', '0');
    }
    written.appendChild(line);
    wrap.appendChild(written);
    wrap.appendChild(tip);

    // --- Spoken: a transliteration of how the verse sounds read aloud ---
    // (only the interlinear source carries per-word transliterations)
    if (interlinear) {
      var translit = buildTransliteration(tokens);
      var spoken = el('div', 'vf-original-section vf-original-spoken');
      spoken.appendChild(txt('p', 'vf-original-section-label', t('bible.originalSpoken')));
      if (translit) {
        spoken.appendChild(txt('p', 'vf-original-translit', translit));
      } else {
        spoken.appendChild(txt('p', 'vf-original-translit is-empty', t('bible.originalSpokenUnavailable')));
      }
      wrap.appendChild(spoken);
    }

    // --- Aramaic: words the Greek text preserves in the language they were spoken ---
    if (aramaic && aramaic.length) {
      var ar = el('div', 'vf-original-section vf-original-aramaic');
      ar.appendChild(txt('p', 'vf-original-section-label', t('bible.originalAramaic')));
      ar.appendChild(txt('p', 'vf-original-aramaic-note', t('bible.originalAramaicNote')));
      var arList = el('ul', 'vf-aramaic-list');
      aramaic.forEach(function (a) {
        var li = el('li', 'vf-aramaic-item');
        li.appendChild(txt('span', 'vf-aramaic-word', a.translit));
        li.appendChild(txt('span', 'vf-aramaic-gloss', a.meaning));
        arList.appendChild(li);
      });
      ar.appendChild(arList);
      wrap.appendChild(ar);
    }

    // --- Aramaic tradition (OT Torah): the ancient Targum Onkelos rendering ---
    if (targum && targum.text) {
      var tg = el('div', 'vf-original-section vf-original-targum');
      tg.appendChild(txt('p', 'vf-original-section-label', t('bible.originalTargum')));
      tg.appendChild(txt('p', 'vf-original-aramaic-note', t('bible.originalTargumNote')));
      tg.appendChild(txt('p', 'vf-original-targum-text', targum.text));
      if (targum.credit) tg.appendChild(txt('p', 'vf-original-trans-credit', targum.credit));
      wrap.appendChild(tg);
    }

    // the reveal hint names the first (primary) translation
    var primaryLabel = (translations[0] && translations[0].label) || t('bible.originalDefaultLabel');
    wrap.appendChild(txt('p', 'vf-original-hint',
      t(interlinear ? 'bible.originalWordHint' : 'bible.originalHoverHint', { version: primaryLabel })));

    // one or more paired translations, each with its own attribution (required
    // for the CC BY New Testament text, a courtesy note for the public-domain ones)
    var trans = el('div', 'vf-original-trans');
    translations.forEach(function (tr) {
      var item = el('div', 'vf-original-trans-item');
      item.appendChild(txt('span', 'vf-original-trans-label', t('bible.originalTransLabel', { version: tr.label })));
      item.appendChild(txt('span', 'vf-original-trans-text', tr.text || t('bible.originalNoTrans')));
      if (tr.credit) item.appendChild(txt('p', 'vf-original-trans-credit', tr.credit));
      trans.appendChild(item);
    });
    wrap.appendChild(trans);

    if (interlinear) wrap.appendChild(txt('p', 'vf-original-credit', t('bible.originalCredit')));

    if (interlinear) {
      // the whole-verse translation stays visible so words can be compared to it
      wrap.classList.add('is-shown');
    } else {
      // plain fallback: hover / focus reveal the translation, tap toggles it
      line.addEventListener('click', function () { wrap.classList.toggle('is-shown'); });
    }
    return wrap;
  }

  function loadFocusOriginal() {
    var body = document.getElementById('verse-focus-original-body');
    if (!body) return;
    var key = verseKey(bibleState.verse);
    if (focusKeys.original === key) return;
    focusKeys.original = key;

    var isHebrew = bibleState.testament === 0;
    var originalId = isHebrew ? ORIGINAL_OT : ORIGINAL_NT;
    // the original is paired with a fixed scholarly translation — a Jewish
    // rendering for the Hebrew OT, a critical-text one for the Greek/Aramaic NT —
    // plus the ASV as a second, formal-equivalent reading in both testaments
    var studyId = isHebrew ? STUDY_TRANS_OT : STUDY_TRANS_NT;
    var primaryLabel = t(isHebrew ? 'bible.originalTransOT' : 'bible.originalTransNT');
    var primaryCredit = t(isHebrew ? 'bible.originalTransCreditOT' : 'bible.originalTransCreditNT');

    var wantVerse = bibleState.verse;
    var book = bibleState.book.name, chap = bibleState.chapter;
    var bookNo = BOLLS_BOOK_NO[book];
    var bollsTrans = isHebrew ? BOLLS_OT : BOLLS_NT;
    // the Aramaic Targum Onkelos covers only the Torah (Genesis–Deuteronomy)
    var wantTargum = isHebrew && !!TORAH_BOOKS[book];

    body.textContent = '';
    body.appendChild(txt('p', 'verse-panel-note', t('bible.originalBusy')));

    // bolls gives the Strong's-tagged words; n8n gives the plain original (a
    // fallback if bolls is down) and the paired translations
    var quiet = function () { return null; };
    Promise.all([
      bookNo ? fetchBolls(bollsTrans, bookNo, chap).catch(quiet) : Promise.resolve(null),
      requestCached('bible-chapter', { book: book, chapter: chap, version: studyId }).catch(quiet),
      requestCached('bible-chapter', { book: book, chapter: chap, version: originalId }).catch(quiet),
      ensureGloss(),
      requestCached('bible-chapter', { book: book, chapter: chap, version: STUDY_TRANS_ASV }).catch(quiet),
      wantTargum ? requestCached('bible-chapter', { book: book, chapter: chap, version: TARGUM_ONKELOS }).catch(quiet) : Promise.resolve(null)
    ]).then(function (res) {
      if (focusKeys.original !== key) return;
      var bollsArr = res[0], transData = res[1], plainData = res[2], gloss = res[3], asvData = res[4], targumData = res[5];
      var tokens = null, plainOriginal = '';
      var tagged = pickBollsVerse(bollsArr, wantVerse);
      if (tagged) {
        tokens = parseStrongTokens(tagged, isHebrew, gloss);
        plainOriginal = tagged.replace(/<S>\d+<\/S>/g, '').replace(/<[^>]*>/g, '');
      }
      if (!plainOriginal) plainOriginal = pickVerseText(plainData, wantVerse);

      // the paired translations, primary (JPS/TCENT) first, then the ASV
      var translations = [];
      var primaryText = pickVerseText(transData, wantVerse);
      if (primaryText) translations.push({ label: primaryLabel, text: primaryText, credit: primaryCredit });
      var asvText = pickVerseText(asvData, wantVerse);
      if (asvText) translations.push({ label: t('bible.originalTransASV'), text: asvText, credit: t('bible.originalTransCreditASV') });

      // NT: Aramaic words preserved in the Greek; OT Torah: the Targum Onkelos rendering
      var aramaic = isHebrew ? null : aramaicWordsFor(book, chap, wantVerse);
      var targumText = wantTargum ? pickVerseText(targumData, wantVerse) : '';
      var targum = targumText ? { text: targumText, credit: t('bible.originalTargumCredit') } : null;

      body.textContent = '';
      if (!tokens && !plainOriginal) {
        body.appendChild(txt('p', 'verse-panel-note', t('bible.originalUnavailable')));
        return;
      }
      body.appendChild(renderOriginalInteractive(tokens, plainOriginal, translations, isHebrew, aramaic, targum));
    }).catch(function (err) {
      if (focusKeys.original !== key) return;
      focusKeys.original = null;
      body.textContent = '';
      body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
    });
  }

  function loadFocusContext() {
    var body = document.getElementById('verse-focus-context-body');
    var key = verseKey(bibleState.verse);
    if (focusKeys.context === key) return;
    focusKeys.context = key;
    body.textContent = '';
    body.appendChild(txt('p', 'verse-panel-note', t('bible.contextBusy')));
    requestCached('verse-context', {
      book: bibleState.book.name, chapter: bibleState.chapter,
      verse: bibleState.verse, version: currentVersion()
    })
      .then(function (data) {
        if (focusKeys.context !== key) return;
        var node = renderVerseContext(data);
        body.textContent = '';
        if (node) { body.appendChild(node); appendProvenance(body, false); }
        else body.appendChild(txt('p', 'verse-panel-note', t('bible.sectionUnavailable')));
      })
      .catch(function (err) {
        if (focusKeys.context !== key) return;
        focusKeys.context = null;
        body.textContent = '';
        body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

  function loadFocusChapter() {
    var body = document.getElementById('verse-focus-chapter-body');
    var key = bibleState.book.name + '|' + bibleState.chapter;
    if (focusKeys.chapter === key) return;
    focusKeys.chapter = key;
    body.textContent = '';
    body.appendChild(txt('p', 'verse-panel-note', t('bible.guideBusy')));
    requestCached('chapter-insight', { book: bibleState.book.name, chapter: bibleState.chapter })
      .then(function (data) {
        if (focusKeys.chapter !== key) return;
        var rich = renderChapterOverview(data);
        if (rich) { body.textContent = ''; body.appendChild(rich); appendProvenance(body, false); return; }
        renderInsight(body, [
          { key: 'bible.overview', text: data && data.overview },
          { key: 'bible.pointsToChrist', text: data && data.christ },
          { key: 'bible.background', text: data && data.history }
        ], 'bible.guideUnavailable');
        appendProvenance(body, false);
      })
      .catch(function (err) {
        if (focusKeys.chapter !== key) return;
        focusKeys.chapter = null;
        body.textContent = '';
        body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

  function loadFocusBook() {
    var body = document.getElementById('verse-focus-book-body');
    var key = bibleState.book.name;
    if (focusKeys.book === key) return;
    focusKeys.book = key;
    // Show the verified curated overview instantly if we have one; the backend
    // still loads in the background to fill the remaining sections.
    var curated = curatedBookOnly();
    body.textContent = '';
    if (curated) {
      var seed = renderBookOverview(curated);
      if (seed) { body.appendChild(seed); appendProvenance(body, true); }
      else body.appendChild(txt('p', 'verse-panel-note', t('bible.bookBusy')));
    } else {
      body.appendChild(txt('p', 'verse-panel-note', t('bible.bookBusy')));
    }
    requestCached('book-insight', { book: bibleState.book.name })
      .then(function (data) {
        if (focusKeys.book !== key) return;
        var rich = renderBookOverview(withCuratedBook(data));
        if (rich) { body.textContent = ''; body.appendChild(rich); appendProvenance(body, !!curated); return; }
        if (curated) return; // keep the curated overview already on screen
        renderInsight(body, [
          { key: 'bible.bookAbout', text: data && data.overview },
          { key: 'bible.pointsToChrist', text: data && data.christ },
          { key: 'bible.bookBackground', text: data && data.history }
        ], 'bible.bookUnavailable');
        appendProvenance(body, false);
      })
      .catch(function (err) {
        if (focusKeys.book !== key) return;
        if (curated) return; // the verified overview is already shown; leave it
        focusKeys.book = null;
        body.textContent = '';
        body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

  document.getElementById('verse-focus-original').addEventListener('toggle', function () {
    if (this.open) loadFocusOriginal();
  });
  document.getElementById('verse-focus-context').addEventListener('toggle', function () {
    if (this.open) loadFocusContext();
  });
  document.getElementById('verse-focus-chapter').addEventListener('toggle', function () {
    if (this.open) loadFocusChapter();
  });
  document.getElementById('verse-focus-book').addEventListener('toggle', function () {
    if (this.open) loadFocusBook();
  });
  // warm each study panel on hover/focus so it's generating before it opens
  warmOnIntent(document.getElementById('verse-focus-original'), loadFocusOriginal);
  warmOnIntent(document.getElementById('verse-focus-context'), loadFocusContext);
  warmOnIntent(document.getElementById('verse-focus-chapter'), loadFocusChapter);
  warmOnIntent(document.getElementById('verse-focus-book'), loadFocusBook);

  /* ---------- jumping into the reader from anywhere (plans) ---------- */

  function findBook(name) {
    for (var g = 0; g < BIBLE_BOOKS.length; g++) {
      var books = BIBLE_BOOKS[g].books;
      for (var i = 0; i < books.length; i++) {
        if (books[i].name === name) return { testament: g, book: books[i] };
      }
    }
    return null;
  }

  function openReaderAt(name, chapter) {
    var found = findBook(name);
    if (!found) return;
    showView('bible'); // resets the browser to the testaments; we then jump past it
    bibleState.testament = found.testament;
    bibleState.book = found.book;
    bibleState.chapter = Math.max(1, Math.min(chapter || 1, found.book.chapters));
    renderChapterGrid();
    showBibleScreen('reader');
    window.scrollTo(0, 0);
    loadChapter();
  }

  /* Jump to a book's chapter picker (used by the book-search boxes in the Bible
     view and in Search scripture). Unlike openReaderAt it stops at the chapter
     grid so the reader can choose where to start. */
  function openBookChapters(name) {
    var found = findBook(name);
    if (!found) return;
    showView('bible');
    bibleState.testament = found.testament;
    bibleState.book = found.book;
    bibleState.chapter = 1;
    renderChapterGrid();
    showBibleScreen('chapters');
    window.scrollTo(0, 0);
  }

  /* Match books by name for the search boxes. A leading-word match ranks above a
     mid-name one so "jo" surfaces Job/John/Joel/Jonah before "Song of Solomon".
     Returns [{ testament, book }] limited to `limit`. */
  function matchBooks(query, limit) {
    var q = (query || '').trim().toLowerCase();
    if (!q) return [];
    var starts = [], contains = [];
    BIBLE_BOOKS.forEach(function (group, gi) {
      group.books.forEach(function (book) {
        var name = book.name.toLowerCase();
        if (name.indexOf(q) === 0) starts.push({ testament: gi, book: book });
        else if (name.indexOf(q) !== -1) contains.push({ testament: gi, book: book });
      });
    });
    var out = starts.concat(contains);
    return typeof limit === 'number' ? out.slice(0, limit) : out;
  }

  /* Shared renderer for a list of book matches into a suggestions container.
     `onPick(name)` runs when a suggestion is chosen; `note` is shown per row. */
  function renderBookSuggestions(container, query, onPick, note) {
    if (!container) return;
    var matches = matchBooks(query, 8);
    container.textContent = '';
    if (!query.trim() || !matches.length) { container.hidden = true; return; }
    matches.forEach(function (m) {
      var btn = el('button', 'book-suggestion');
      btn.type = 'button';
      btn.appendChild(txt('span', 'book-suggestion-icon', '📖'));
      var label = el('span', 'book-suggestion-text');
      label.appendChild(txt('span', 'book-suggestion-name', m.book.name));
      label.appendChild(txt('span', 'book-suggestion-meta', t(BIBLE_BOOKS[m.testament].testamentKey)));
      btn.appendChild(label);
      if (note) btn.appendChild(txt('span', 'book-suggestion-note', note));
      btn.addEventListener('click', function () { onPick(m.book.name); });
      container.appendChild(btn);
    });
    container.hidden = false;
  }

  /* ---------- bible plans ---------- */

  /* A flat, chapter-by-chapter reading order (both testaments in canonical
     order), built once from the book list the browser already uses. */
  var canonCache = null;
  function canonList() {
    if (canonCache) return canonCache;
    canonCache = [];
    BIBLE_BOOKS.forEach(function (group) {
      group.books.forEach(function (book) {
        for (var c = 1; c <= book.chapters; c++) canonCache.push({ book: book.name, chapter: c });
      });
    });
    return canonCache;
  }

  /* A roughly chronological book order — the order events happened, rather than
     the order the books are bound. Chapter-level, which is the granularity a
     day-by-day plan needs. */
  var CHRONO_ORDER = [
    'Genesis', 'Job', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
    'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Chronicles',
    'Psalms', '2 Chronicles', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
    '1 Kings', '2 Kings', 'Obadiah', 'Joel', 'Jonah', 'Amos', 'Hosea',
    'Isaiah', 'Micah', 'Nahum', 'Zephaniah', 'Habakkuk', 'Jeremiah',
    'Lamentations', 'Ezekiel', 'Daniel', 'Ezra', 'Nehemiah', 'Esther',
    'Haggai', 'Zechariah', 'Malachi',
    'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'James', 'Galatians',
    '1 Thessalonians', '2 Thessalonians', '1 Corinthians', '2 Corinthians',
    'Romans', 'Ephesians', 'Philippians', 'Colossians', 'Philemon',
    '1 Timothy', 'Titus', '2 Timothy', '1 Peter', '2 Peter', 'Hebrews',
    'Jude', '1 John', '2 John', '3 John', 'Revelation'
  ];

  function orderedList(order) {
    var byName = {};
    BIBLE_BOOKS.forEach(function (g) { g.books.forEach(function (b) { byName[b.name] = b; }); });
    var out = [];
    order.forEach(function (name) {
      var b = byName[name];
      if (!b) return;
      for (var c = 1; c <= b.chapters; c++) out.push({ book: name, chapter: c });
    });
    return out;
  }

  // split a flat reading list into as-even-as-possible daily portions
  function chunkInto(list, days) {
    var out = [];
    var per = list.length / days;
    for (var d = 0; d < days; d++) {
      var slice = list.slice(Math.round(d * per), Math.round((d + 1) * per));
      if (slice.length) out.push(slice);
    }
    return out;
  }

  /* A curated 30-day introduction for someone new to faith: the gospel first
     (John, Mark, the cross and resurrection), then how to live it out. One
     chapter a day, each a self-contained step. */
  var NEW_BELIEVER_READINGS = [
    ['John', 1], ['John', 3], ['Mark', 1], ['Luke', 15], ['John', 14],
    ['Psalms', 23], ['Psalms', 51], ['Luke', 23], ['Luke', 24], ['John', 20],
    ['Romans', 3], ['Romans', 5], ['Romans', 6], ['Romans', 8], ['Romans', 12],
    ['Ephesians', 2], ['Philippians', 2], ['Philippians', 4], ['Colossians', 3],
    ['Matthew', 5], ['Matthew', 6], ['Matthew', 7], ['1 Corinthians', 13],
    ['Galatians', 5], ['James', 1], ['1 John', 1], ['1 John', 4],
    ['1 Peter', 1], ['Acts', 2], ['Revelation', 21]
  ];

  // book-name helpers for the plan catalog
  function booksInTestament(idx) {
    var out = [];
    if (BIBLE_BOOKS[idx]) BIBLE_BOOKS[idx].books.forEach(function (b) { out.push(b.name); });
    return out;
  }
  function everyChapterOneDay(names) {
    return orderedList(names).map(function (x) { return [x]; });
  }
  function daysPlan(names, days) { return chunkInto(orderedList(names), days); }

  var GOSPELS = ['Matthew', 'Mark', 'Luke', 'John'];
  var PENTATEUCH = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'];
  var WISDOM_BOOKS = ['Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon'];
  var MAJOR_PROPHETS = ['Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel'];
  var MINOR_PROPHETS = ['Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'];
  var PAULINE = ['Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon'];
  var GENERAL_EPISTLES = ['Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude'];

  // The classic M'Cheyne shape: four readings a day, the whole Bible in a year.
  // (Adapted: the Bible is split into four streams read in parallel.)
  function mcheynePlan() {
    var all = canonList();
    var q = Math.ceil(all.length / 4);
    var streams = [all.slice(0, q), all.slice(q, 2 * q), all.slice(2 * q, 3 * q), all.slice(3 * q)];
    var days = 365;
    var chunked = streams.map(function (s) { return chunkInto(s, days); });
    var out = [];
    for (var d = 0; d < days; d++) {
      var day = [];
      chunked.forEach(function (c) { if (c[d]) day = day.concat(c[d]); });
      if (day.length) out.push(day);
    }
    return out;
  }

  /* The full plan catalog — 100+ reading plans in categories. The four original
     plans keep their i18n labels and stable ids so saved progress carries over;
     the generated plans use plain English labels (their day counts are computed
     live). Categories are i18n keys so the section headings still translate. */
  function buildPlansCatalog() {
    var plans = [];
    function add(id, category, label, hint, build) {
      plans.push({ id: id, category: category, label: label, hint: hint, build: build });
    }

    // ---- Start here ----
    plans.push({ id: 'newbeliever', category: 'plans.catStart', labelKey: 'plans.newBeliever', hintKey: 'plans.newBelieverHint',
      build: function () { return NEW_BELIEVER_READINGS.map(function (r) { return [{ book: r[0], chapter: r[1] }]; }); } });

    // ---- Whole Bible ----
    plans.push({ id: 'year', category: 'plans.catWholeBible', labelKey: 'plans.year', hintKey: 'plans.yearHint',
      build: function () { return chunkInto(canonList(), 365); } });
    plans.push({ id: 'chrono', category: 'plans.catWholeBible', labelKey: 'plans.chrono', hintKey: 'plans.chronoHint',
      build: function () { return chunkInto(orderedList(CHRONO_ORDER), 365); } });
    [90, 120, 150, 180, 270, 540, 730].forEach(function (d) {
      add('wb' + d, 'plans.catWholeBible', 'Whole Bible in ' + d + ' days', 'Canonical order', function () { return chunkInto(canonList(), d); });
    });
    add('mcheyne', 'plans.catWholeBible', "M'Cheyne Reading Plan", 'Four readings a day, whole Bible in a year', mcheynePlan);
    add('fiveday', 'plans.catWholeBible', '5-Day Bible Reading Program', 'The whole Bible, built for five days a week', function () { return chunkInto(canonList(), 260); });
    add('chrono180', 'plans.catWholeBible', 'Chronological in 180 days', 'In the order events happened', function () { return chunkInto(orderedList(CHRONO_ORDER), 180); });
    add('chrono730', 'plans.catWholeBible', 'Chronological in 2 years', 'In the order events happened', function () { return chunkInto(orderedList(CHRONO_ORDER), 730); });

    // ---- New Testament ----
    [30, 45, 60, 90, 120, 180].forEach(function (d) {
      add('nt' + d, 'plans.catNT', 'New Testament in ' + d + ' days', 'All 27 books', function () { return daysPlan(booksInTestament(1), d); });
    });

    // ---- Old Testament ----
    [120, 180, 270, 365, 540].forEach(function (d) {
      add('ot' + d, 'plans.catOT', 'Old Testament in ' + d + ' days', 'All 39 books', function () { return daysPlan(booksInTestament(0), d); });
    });

    // ---- Gospels & the life of Jesus ----
    [21, 30, 40, 60].forEach(function (d) {
      add('gospels' + d, 'plans.catGospels', 'The Gospels in ' + d + ' days', 'Matthew, Mark, Luke, John', function () { return daysPlan(GOSPELS, d); });
    });
    add('lifeofchrist', 'plans.catGospels', 'The Life of Christ', 'The four Gospels, one chapter a day', function () { return everyChapterOneDay(GOSPELS); });
    add('john21', 'plans.catGospels', 'John in 21 days', 'One chapter a day', function () { return everyChapterOneDay(['John']); });
    add('mark16', 'plans.catGospels', 'Mark in 16 days', 'The fast-paced Gospel, a chapter a day', function () { return everyChapterOneDay(['Mark']); });
    add('luke24', 'plans.catGospels', 'Luke in 24 days', 'One chapter a day', function () { return everyChapterOneDay(['Luke']); });
    add('matthew28', 'plans.catGospels', 'Matthew in 28 days', 'One chapter a day', function () { return everyChapterOneDay(['Matthew']); });

    // ---- Psalms & wisdom ----
    [30, 60, 90, 150].forEach(function (d) {
      add('psalms' + d, 'plans.catWisdom', 'Psalms in ' + d + ' days', '150 psalms of prayer and praise', function () { return daysPlan(['Psalms'], d); });
    });
    add('proverbs31', 'plans.catWisdom', 'Proverbs in a month', 'A chapter of wisdom each day', function () { return everyChapterOneDay(['Proverbs']); });
    add('wisdom90', 'plans.catWisdom', 'Wisdom & Poetry in 90 days', 'Job, Psalms, Proverbs, Ecclesiastes, Song', function () { return daysPlan(WISDOM_BOOKS, 90); });
    add('ecclesiastes12', 'plans.catWisdom', 'Ecclesiastes in 12 days', 'One chapter a day', function () { return everyChapterOneDay(['Ecclesiastes']); });
    add('job21', 'plans.catWisdom', 'Job in 3 weeks', 'Reading through suffering and hope', function () { return chunkInto(orderedList(['Job']), 21); });
    add('psprov60', 'plans.catWisdom', 'Psalms & Proverbs in 60 days', 'Prayer and wisdom side by side', function () { return daysPlan(['Psalms', 'Proverbs'], 60); });

    // ---- Sections & topics ----
    add('pentateuch30', 'plans.catSections', 'The Torah in 30 days', 'Genesis through Deuteronomy', function () { return daysPlan(PENTATEUCH, 30); });
    add('pentateuch60', 'plans.catSections', 'The Torah in 60 days', 'The five books of Moses', function () { return daysPlan(PENTATEUCH, 60); });
    add('majorprophets60', 'plans.catSections', 'The Major Prophets in 60 days', 'Isaiah to Daniel', function () { return daysPlan(MAJOR_PROPHETS, 60); });
    add('minorprophets24', 'plans.catSections', 'The Minor Prophets in 24 days', 'Hosea to Malachi', function () { return daysPlan(MINOR_PROPHETS, 24); });
    add('pauline45', 'plans.catSections', "Paul's Letters in 45 days", 'Romans through Philemon', function () { return daysPlan(PAULINE, 45); });
    add('general21', 'plans.catSections', 'The General Epistles in 21 days', 'Hebrews through Jude', function () { return daysPlan(GENERAL_EPISTLES, 21); });
    add('acts28', 'plans.catSections', 'Acts in 28 days', 'The birth of the church', function () { return everyChapterOneDay(['Acts']); });
    add('genesis50', 'plans.catSections', 'Genesis in 50 days', 'Where the whole story begins', function () { return everyChapterOneDay(['Genesis']); });
    add('romans16', 'plans.catSections', 'Romans in 16 days', "Paul's masterwork on the gospel", function () { return everyChapterOneDay(['Romans']); });
    add('isaiah66', 'plans.catSections', 'Isaiah in 66 days', 'The gospel foretold', function () { return everyChapterOneDay(['Isaiah']); });
    add('revelation22', 'plans.catSections', 'Revelation in 22 days', 'How the story ends', function () { return everyChapterOneDay(['Revelation']); });

    // ---- One book at a time (all 66) ----
    BIBLE_BOOKS.forEach(function (g) {
      g.books.forEach(function (b) {
        add('book:' + b.name, 'plans.catBooks', b.name, b.chapters + (b.chapters > 1 ? ' chapters, one a day' : ' chapter'),
          (function (name) { return function () { return everyChapterOneDay([name]); }; })(b.name));
      });
    });

    return plans;
  }

  var PLANS = buildPlansCatalog();

  /* ---- custom, build-your-own plans (device-local) ---- */
  var CUSTOM_PLANS_KEY = 'tgp.customPlans';
  function loadCustomPlans() {
    try { var a = JSON.parse(window.localStorage.getItem(CUSTOM_PLANS_KEY)); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveCustomPlans(a) {
    try { window.localStorage.setItem(CUSTOM_PLANS_KEY, JSON.stringify(a)); } catch (e) { /* view-only */ }
  }
  // turn a saved custom plan's scope into a flat chapter list
  function customScopeList(scope) {
    if (scope === 'wholeBible') return canonList();
    if (scope === 'nt') return orderedList(booksInTestament(1));
    if (scope === 'ot') return orderedList(booksInTestament(0));
    var f = findBook(scope);
    if (f) { var out = []; for (var c = 1; c <= f.book.chapters; c++) out.push({ book: f.book.name, chapter: c }); return out; }
    return canonList();
  }
  // custom plans as plan objects the rest of the code understands
  function customPlanObjects() {
    return loadCustomPlans().map(function (cp) {
      return { id: cp.id, category: 'plans.catCustom', label: cp.title, custom: true, scope: cp.scope, days: cp.days,
        build: (function (c) { return function () { return chunkInto(customScopeList(c.scope), c.days); }; })(cp) };
    });
  }
  function allPlans() { return customPlanObjects().concat(PLANS); }
  // label / hint that works for both i18n plans and literal-label plans
  function planLabel(plan) { return plan.labelKey ? t(plan.labelKey) : (plan.label || ''); }
  function planHint(plan) { return plan.hintKey ? t(plan.hintKey) : (plan.hint || ''); }

  var PLANS_KEY = 'tgp.plans';
  function loadPlanProgress() {
    try { return JSON.parse(window.localStorage.getItem(PLANS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function savePlanProgress(p) {
    try { window.localStorage.setItem(PLANS_KEY, JSON.stringify(p)); } catch (e) { /* view-only */ }
  }

  var currentPlan = null;

  function showPlansScreen(name) {
    document.getElementById('plans-grid').hidden = name !== 'grid';
    document.getElementById('plan-detail').hidden = name !== 'detail';
    var builder = document.getElementById('plan-builder');
    if (builder) builder.hidden = name !== 'builder';
  }

  var PLAN_CATEGORY_ORDER = [
    'plans.catCustom', 'plans.catStart', 'plans.catWholeBible', 'plans.catNT',
    'plans.catOT', 'plans.catGospels', 'plans.catWisdom', 'plans.catSections', 'plans.catBooks'
  ];

  function renderPlans() {
    var grid = document.getElementById('plans-grid');
    if (!grid) return;
    grid.textContent = '';

    // a card that opens the build-your-own form
    var builder = document.createElement('button');
    builder.type = 'button';
    builder.className = 'feature-card plan-build-card';
    builder.appendChild(txt('span', 'feature-label', '＋ ' + t('plans.buildOwn')));
    builder.appendChild(txt('span', 'feature-hint', t('plans.buildOwnHint')));
    builder.addEventListener('click', openPlanBuilder);
    grid.appendChild(builder);

    // group plans by category, in a fixed order
    var byCat = {};
    allPlans().forEach(function (plan) {
      (byCat[plan.category] = byCat[plan.category] || []).push(plan);
    });

    PLAN_CATEGORY_ORDER.forEach(function (cat) {
      var items = byCat[cat];
      if (!items || !items.length) return;
      grid.appendChild(txt('h2', 'plan-cat-head', t(cat)));
      var row = el('div', 'plan-cat-grid');
      items.forEach(function (plan) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'feature-card';
        card.appendChild(txt('span', 'feature-label', planLabel(plan)));
        var hint = planHint(plan);
        var days = plan.build().length;
        hint += (hint ? ' · ' : '') + t('plans.dayCount', { n: days });
        card.appendChild(txt('span', 'feature-hint', hint));
        card.addEventListener('click', function () { openPlan(plan); });
        row.appendChild(card);
      });
      grid.appendChild(row);
    });

    setStatus(document.getElementById('plans-status'), '', false);
  }

  function fillPlanBookSelect() {
    var sel = document.getElementById('plan-book-select');
    sel.textContent = '';
    BIBLE_BOOKS.forEach(function (g) {
      g.books.forEach(function (b) {
        var o = document.createElement('option');
        o.value = b.name;
        o.textContent = b.name;
        sel.appendChild(o);
      });
    });
    var prog = loadPlanProgress();
    sel.value = (prog.bookPlan && prog.bookPlan.lastBook) || 'John';
  }

  function openPlan(plan) {
    currentPlan = plan;
    showPlansScreen('detail');
    document.getElementById('plan-detail-title').textContent = planLabel(plan);
    // the new-believer plan carries a note on which translation to start with
    var note = document.getElementById('plan-note');
    if (note) {
      if (plan.id === 'newbeliever') { note.textContent = t('plans.newBelieverNote'); note.hidden = false; }
      else { note.hidden = true; note.textContent = ''; }
    }
    document.getElementById('plan-book-field').hidden = !plan.book;
    if (plan.book) fillPlanBookSelect();
    // custom plans can be deleted; built-in ones only reset
    var del = document.getElementById('plan-delete');
    if (del) del.hidden = !plan.custom;
    renderPlanDays();
    window.scrollTo(0, 0);
  }

  // the day list for the active plan, plus the storage key its progress lives under
  function planDaysFor(plan) {
    if (plan.book) {
      var name = document.getElementById('plan-book-select').value;
      var found = findBook(name);
      var days = [];
      if (found) for (var c = 1; c <= found.book.chapters; c++) days.push([{ book: name, chapter: c }]);
      return { days: days, key: 'book:' + name };
    }
    return { days: plan.build(), key: plan.id };
  }

  // "Genesis 1–3", collapsing runs of consecutive chapters in the same book
  function passageLabel(day) {
    var parts = [];
    var i = 0;
    while (i < day.length) {
      var book = day[i].book;
      var start = day[i].chapter;
      var end = start;
      var j = i + 1;
      while (j < day.length && day[j].book === book && day[j].chapter === end + 1) { end = day[j].chapter; j++; }
      parts.push(book + ' ' + (start === end ? start : start + '–' + end));
      i = j;
    }
    return parts.join(', ');
  }

  function renderPlanDays() {
    var wrap = document.getElementById('plan-days');
    if (!wrap || !currentPlan) return;
    wrap.textContent = '';

    var pd = planDaysFor(currentPlan);
    var prog = loadPlanProgress();
    var done = (prog[pd.key] && prog[pd.key].done) || {};
    var total = pd.days.length;
    var doneCount = 0;
    for (var k in done) { if (done[k]) doneCount++; }

    document.getElementById('plan-progress-fill').style.width =
      total ? (doneCount / total * 100).toFixed(0) + '%' : '0%';
    document.getElementById('plan-progress-label').textContent =
      (total && doneCount === total) ? t('plans.finished')
                                     : t('plans.daysDone', { done: doneCount, total: total });

    // the first unread day gets a "next up" accent
    var nextIndex = -1;
    for (var d = 0; d < total; d++) { if (!done[d]) { nextIndex = d; break; } }

    pd.days.forEach(function (day, index) {
      wrap.appendChild(buildPlanDay(pd.key, day, index, !!done[index], index === nextIndex));
    });
  }

  function buildPlanDay(progKey, day, index, isRead, isNext) {
    var row = el('div', 'plan-day' + (isRead ? ' is-read' : '') + (isNext ? ' is-next' : ''));

    var info = el('div', 'plan-day-info');
    info.appendChild(txt('span', 'plan-day-num', t('plans.day', { n: index + 1 })));
    info.appendChild(txt('span', 'plan-day-ref', passageLabel(day)));
    row.appendChild(info);

    var actions = el('div', 'plan-day-actions');
    var read = txt('button', 'plan-day-read', t('plans.readNow'));
    read.type = 'button';
    read.addEventListener('click', function () { openReaderAt(day[0].book, day[0].chapter); });
    actions.appendChild(read);

    var mark = txt('button', 'plan-day-mark' + (isRead ? ' is-read' : ''),
      isRead ? t('plans.readDone') : t('plans.markRead'));
    mark.type = 'button';
    mark.addEventListener('click', function () { togglePlanDay(progKey, index); });
    actions.appendChild(mark);

    row.appendChild(actions);
    return row;
  }

  function togglePlanDay(progKey, index) {
    var prog = loadPlanProgress();
    if (!prog[progKey]) prog[progKey] = { done: {} };
    var nowRead = !prog[progKey].done[index];
    prog[progKey].done[index] = nowRead;
    savePlanProgress(prog);
    renderPlanDays();
    // marking a day read (not un-marking) counts toward streak + badges
    if (nowRead) { recordActivity(); checkBadges(); renderProgressUI(); }
  }

  document.getElementById('plan-back').addEventListener('click', function () {
    showPlansScreen('grid');
    window.scrollTo(0, 0);
  });
  document.getElementById('plan-book-select').addEventListener('change', function () {
    var prog = loadPlanProgress();
    prog.bookPlan = prog.bookPlan || {};
    prog.bookPlan.lastBook = this.value;
    savePlanProgress(prog);
    renderPlanDays();
  });
  document.getElementById('plan-reset').addEventListener('click', function () {
    if (!currentPlan || !window.confirm(t('plans.resetConfirm'))) return;
    var pd = planDaysFor(currentPlan);
    var prog = loadPlanProgress();
    delete prog[pd.key];
    savePlanProgress(prog);
    renderPlanDays();
  });
  document.getElementById('plan-delete').addEventListener('click', function () {
    if (!currentPlan || !currentPlan.custom || !window.confirm(t('plans.deleteConfirm'))) return;
    // drop the custom plan and its saved progress, then return to the grid
    saveCustomPlans(loadCustomPlans().filter(function (cp) { return cp.id !== currentPlan.id; }));
    var prog = loadPlanProgress();
    delete prog[currentPlan.id];
    savePlanProgress(prog);
    currentPlan = null;
    renderPlans();
    showPlansScreen('grid');
    window.scrollTo(0, 0);
  });

  /* ---- build-your-own plan ---- */
  function fillPlanBuilderScope() {
    var sel = document.getElementById('plan-build-scope');
    if (!sel || sel.dataset.built) return;
    sel.dataset.built = '1';
    function opt(value, label) { var o = el('option'); o.value = value; o.textContent = label; return o; }
    sel.appendChild(opt('wholeBible', t('plans.scopeWhole')));
    sel.appendChild(opt('nt', t('plans.scopeNT')));
    sel.appendChild(opt('ot', t('plans.scopeOT')));
    // every book, grouped by testament
    BIBLE_BOOKS.forEach(function (g) {
      var grp = el('optgroup');
      grp.label = t(g.testamentKey);
      g.books.forEach(function (b) { grp.appendChild(opt(b.name, b.name)); });
      sel.appendChild(grp);
    });
  }
  function openPlanBuilder() {
    fillPlanBuilderScope();
    showPlansScreen('builder');
    var status = document.getElementById('plan-build-status');
    if (status) status.textContent = '';
    window.scrollTo(0, 0);
  }
  // how many chapters a chosen scope covers (to sanity-check the day count)
  function scopeChapterCount(scope) { return customScopeList(scope).length; }

  (function wirePlanBuilder() {
    var back = document.getElementById('plan-build-back');
    if (back) back.addEventListener('click', function () { showPlansScreen('grid'); window.scrollTo(0, 0); });
    var form = document.getElementById('plan-build-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = document.getElementById('plan-build-status');
      var title = document.getElementById('plan-build-title').value.trim();
      var scope = document.getElementById('plan-build-scope').value;
      var days = parseInt(document.getElementById('plan-build-days').value, 10);
      if (!title) { setStatus(status, t('plans.buildNeedTitle'), true); return; }
      if (!scope) { setStatus(status, t('plans.buildNeedScope'), true); return; }
      var maxDays = scopeChapterCount(scope);
      if (!(days >= 1)) { setStatus(status, t('plans.buildNeedDays'), true); return; }
      if (days > maxDays) days = maxDays; // never more days than chapters
      var cp = { id: 'custom:' + Date.now(), title: title, scope: scope, days: days };
      var list = loadCustomPlans();
      list.unshift(cp);
      saveCustomPlans(list);
      // reset the form and open the new plan
      document.getElementById('plan-build-title').value = '';
      renderPlans();
      openPlan(customPlanObjects()[0]);
    });
  })();

  /* ---------- the road to apologetics: 200 questions, one badge each ---------- */

  /* The questions live in js/apologetics-data.js as APOLO_THEMES (20 themed
     chapters of 10). Opening a question's prepared answer earns its badge.
     Progress is a flat list of topic ids in tgp.apologetics. */
  var APOLO_KEY = 'tgp.apologetics';
  // stable id for a question: chapter index + question index
  function apoloId(ti, qi) { return 'a' + ti + 'q' + qi; }

  function loadApolo() {
    var s = {};
    try { s = JSON.parse(window.localStorage.getItem(APOLO_KEY)) || {}; } catch (e) { s = {}; }
    if (!Array.isArray(s.done)) s.done = [];
    return s;
  }
  function saveApolo(s) {
    try { window.localStorage.setItem(APOLO_KEY, JSON.stringify(s)); } catch (e) { /* view-only */ }
  }
  function apoloDoneSet() {
    var set = {};
    loadApolo().done.forEach(function (id) { set[id] = true; });
    return set;
  }
  function markApoloDone(id) {
    var s = loadApolo();
    if (s.done.indexOf(id) === -1) s.done.push(id);
    saveApolo(s);
  }

  /* ---- lesson difficulty: how deep the prepared answers are written ----
     A device-local preference (beginner / intermediate / advanced) folded into
     the scenario we send, so the same question can be answered simply for a
     newcomer or robustly for a skeptic. */
  var APOLO_DIFF_KEY = 'tgp.apoloDifficulty';
  var APOLO_DIFFS = ['beginner', 'intermediate', 'advanced'];
  function apoloDifficulty() {
    var d = window.localStorage.getItem(APOLO_DIFF_KEY);
    return APOLO_DIFFS.indexOf(d) !== -1 ? d : 'intermediate';
  }
  function setApoloDifficulty(d) {
    if (APOLO_DIFFS.indexOf(d) === -1) d = 'intermediate';
    try { window.localStorage.setItem(APOLO_DIFF_KEY, d); } catch (e) { /* view-only */ }
    updateApoloDifficultyUI();
  }
  // the instruction appended to a question so the answer matches the chosen depth
  function apoloDepthDirective(d) {
    if (d === 'beginner') return ' Please answer at a beginner level: assume no background knowledge, define any terms in plain words, keep it short, warm, and encouraging.';
    if (d === 'advanced') return ' Please answer at an advanced level: engage the strongest counter-arguments directly, cite specific thinkers, sources, and precise references, and reason rigorously.';
    return ' Please answer at an intermediate level: clear and practical, with the key scriptures and reasons someone could actually use in conversation.';
  }
  // the scenario string actually sent for a lesson question, depth folded in
  function apoloScenario(q) { return q + apoloDepthDirective(apoloDifficulty()); }
  function updateApoloDifficultyUI() {
    var d = apoloDifficulty();
    document.querySelectorAll('#apolo-difficulty .apolo-diff-opt').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.difficulty === d);
    });
  }

  // running totals over all chapters
  function apoloCounts() {
    var set = apoloDoneSet();
    var total = 0, done = 0;
    if (typeof APOLO_THEMES !== 'undefined') {
      APOLO_THEMES.forEach(function (th, ti) {
        th.questions.forEach(function (q, qi) { total++; if (set[apoloId(ti, qi)]) done++; });
      });
    }
    return { total: total, done: done };
  }

  var APOLO_RANKS = ['Seeker', 'Student', 'Defender', 'Apologist', 'Ambassador', 'Champion', 'Contender for the Faith'];
  function apoloRank(done, total) {
    if (done >= total && total > 0) return APOLO_RANKS[6];
    if (done === 0) return APOLO_RANKS[0];
    if (done < 10) return APOLO_RANKS[1];
    if (done < 30) return APOLO_RANKS[2];
    if (done < 75) return APOLO_RANKS[3];
    if (done < 125) return APOLO_RANKS[4];
    return APOLO_RANKS[5];
  }

  function updateApoloHero() {
    var c = apoloCounts();
    var rank = document.getElementById('road-rank');
    if (!rank) return;
    rank.textContent = apoloRank(c.done, c.total);
    document.getElementById('road-level').textContent = t('apologetics.levelLabel', { n: c.done });
    document.getElementById('road-xp').textContent = t('apologetics.xpLabel', { n: c.done * 50 });
    document.getElementById('road-progress-fill').style.width = c.total ? (c.done / c.total * 100).toFixed(0) + '%' : '0%';
    document.getElementById('road-stations').textContent = (c.done === c.total && c.total)
      ? t('apologetics.complete')
      : t('dash.badgesEarned', { done: c.done, total: c.total });
  }

  function themeDoneCount(th, ti, set) {
    var n = 0;
    th.questions.forEach(function (q, qi) { if (set[apoloId(ti, qi)]) n++; });
    return n;
  }

  /* ---- the map: a Candy-Crush-style trail of "worlds", each a themed set of
     retro "lessons". Worlds unlock as the one before them is cleared; lessons
     unlock one after another. `apoloStage` holds the open world (null = map). */
  var apoloStage = null;

  function themeComplete(ti, set) {
    var th = APOLO_THEMES[ti];
    return themeDoneCount(th, ti, set) === th.questions.length;
  }
  // a world is playable once the previous one is cleared (or it's already begun)
  function themeUnlocked(ti, set) {
    if (ti === 0) return true;
    if (themeDoneCount(APOLO_THEMES[ti], ti, set) > 0) return true;
    return themeComplete(ti - 1, set);
  }
  // a lesson opens after the one before it is cleared (or if it's already done)
  function levelUnlocked(ti, qi, set) {
    if (qi === 0) return true;
    if (set[apoloId(ti, qi)]) return true;
    return !!set[apoloId(ti, qi - 1)];
  }
  // the first world still in progress — the one to highlight as "current"
  function currentThemeIndex(set) {
    for (var ti = 0; ti < APOLO_THEMES.length; ti++) {
      if (themeUnlocked(ti, set) && !themeComplete(ti, set)) return ti;
    }
    return -1;
  }

  function renderApologetics() {
    // keep the Apologist-mode difficulty label in step with the language
    if (typeof updateApologistLevelUI === 'function') updateApologistLevelUI();
    updateApoloDifficultyUI();
    var road = document.getElementById('apologetics-road');
    if (!road || typeof APOLO_THEMES === 'undefined') return;
    updateApoloHero();
    road.textContent = '';
    // a stage that no longer exists (e.g. after a reset) falls back to the map
    if (apoloStage !== null && !APOLO_THEMES[apoloStage]) apoloStage = null;
    road.appendChild(apoloStage === null ? buildApoloMap() : buildApoloStage(apoloStage));
  }

  function buildApoloMap() {
    var set = apoloDoneSet();
    var map = el('div', 'apolo-map');
    map.appendChild(txt('p', 'apolo-map-hint', t('apologetics.mapHint')));
    var track = el('div', 'apolo-map-track');
    var current = currentThemeIndex(set);
    APOLO_THEMES.forEach(function (th, ti) {
      var done = themeDoneCount(th, ti, set);
      var full = done === th.questions.length;
      var unlocked = themeUnlocked(ti, set);

      var node = el('button', 'apolo-node ' + (full ? 'is-complete' : (unlocked ? 'is-unlocked' : 'is-locked')));
      node.type = 'button';
      if (ti === current) node.className += ' is-current';

      var disc = el('span', 'apolo-node-disc');
      disc.appendChild(txt('span', 'apolo-node-icon', full ? '✓' : (unlocked ? (th.icon || '☩') : '🔒')));
      node.appendChild(disc);

      var label = el('span', 'apolo-node-label');
      label.appendChild(txt('span', 'apolo-node-world', t('apologetics.worldWord', { n: ti + 1 })));
      label.appendChild(txt('span', 'apolo-node-name', th.theme));
      label.appendChild(txt('span', 'apolo-node-stars', full ? t('apologetics.worldComplete') : t('apologetics.starsOf', { done: done, total: th.questions.length })));
      node.appendChild(label);

      if (unlocked) {
        node.addEventListener('click', function () { apoloStage = ti; renderApologetics(); window.scrollTo(0, 0); });
      } else {
        node.disabled = true;
        node.title = t('apologetics.stageLocked');
      }
      track.appendChild(node);
    });
    map.appendChild(track);
    return map;
  }

  function buildApoloStage(ti) {
    var set = apoloDoneSet();
    var th = APOLO_THEMES[ti];
    var stage = el('div', 'apolo-stage');

    var top = el('div', 'apolo-stage-top');
    var back = txt('button', 'apolo-back', '‹ ' + t('apologetics.backToMap'));
    back.type = 'button';
    back.addEventListener('click', function () { apoloStage = null; renderApologetics(); window.scrollTo(0, 0); });
    top.appendChild(back);

    var titleWrap = el('div', 'apolo-stage-titlewrap');
    titleWrap.appendChild(txt('span', 'apolo-stage-icon', th.icon || '☩'));
    var titles = el('div', 'apolo-stage-titles');
    titles.appendChild(txt('span', 'apolo-stage-world', t('apologetics.worldWord', { n: ti + 1 })));
    titles.appendChild(txt('h3', 'apolo-stage-name', th.theme));
    titleWrap.appendChild(titles);
    top.appendChild(titleWrap);

    top.appendChild(txt('span', 'apolo-stage-progress apolo-stage-progress-js',
      t('apologetics.starsOf', { done: themeDoneCount(th, ti, set), total: th.questions.length })));
    stage.appendChild(top);

    var levels = el('div', 'apolo-levels');
    th.questions.forEach(function (q, qi) {
      levels.appendChild(buildApoloLevel(ti, qi, q, set));
    });
    stage.appendChild(levels);
    return stage;
  }

  function buildApoloLevel(ti, qi, q, set) {
    var id = apoloId(ti, qi);
    var done = !!set[id];
    var unlocked = levelUnlocked(ti, qi, set);

    var level = el('details', 'apolo-level ' + (done ? 'is-cleared' : (unlocked ? 'is-open' : 'is-locked')));
    level.setAttribute('data-lesson', qi);

    var head = el('summary', 'apolo-level-head');
    head.appendChild(txt('span', 'apolo-level-badge', done ? '⭐' : (unlocked ? String(qi + 1) : '🔒')));
    var textWrap = el('span', 'apolo-level-textwrap');
    textWrap.appendChild(txt('span', 'apolo-level-num', t('apologetics.lessonWord', { n: qi + 1 })));
    textWrap.appendChild(txt('span', 'apolo-level-q', q));
    head.appendChild(textWrap);
    head.appendChild(txt('span', 'apolo-level-stat',
      done ? t('apologetics.cleared') : (unlocked ? t('apologetics.tapToStart') : t('apologetics.lessonLocked'))));
    level.appendChild(head);

    var body = el('div', 'apolo-level-body');
    level.appendChild(body);

    if (!unlocked) {
      // locked lessons can't be opened
      head.addEventListener('click', function (e) { e.preventDefault(); });
      return level;
    }

    var loaded = false;
    level.addEventListener('toggle', function () {
      if (level.open && !loaded) { loaded = true; loadApoloAnswer(body, id, q, level); }
    });
    // warm the answer on hover (network only — opening is what clears the lesson)
    warmOnIntent(level, function () { requestCached('evangelism-prep', { scenario: apoloScenario(q) }); });
    return level;
  }

  function loadApoloAnswer(body, id, q, level) {
    body.textContent = '';
    body.appendChild(txt('p', 'verse-panel-note', t('apologetics.preparing')));
    requestCached('evangelism-prep', { scenario: apoloScenario(q) })
      .then(function (data) {
        body.textContent = '';
        body.appendChild(txt('div', 'road-station-answer prose', cleanAIText(((data && data.prep) || '').trim())));
        renderApoloFollowups(body, q, 0);
        // preparing the answer clears this lesson (once) and lights up the next
        if (apoloDoneSet()[id]) return;
        markApoloDone(id);
        level.classList.remove('is-open');
        level.classList.add('is-cleared');
        var badge = level.querySelector('.apolo-level-badge');
        if (badge) badge.textContent = '⭐';
        var stat = level.querySelector('.apolo-level-stat');
        if (stat) stat.textContent = t('apologetics.cleared');
        refreshApoloAfterClear(id);
        updateApoloHero();
        notify('badge', t('notif.badge.title'), t('notif.badge.body', { name: q }));
        recordActivity();
        checkBadges();
        renderProgressUI();
      })
      .catch(function (err) {
        body.textContent = '';
        body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

  /* ---- follow-up questions ----
     After an answer, offer AI-suggested next questions (from the apolo-followups
     webhook). Tapping one opens its answer inline, which can itself branch into
     more follow-ups — capped a couple of levels deep so it can't run away. */
  var APOLO_FOLLOWUP_MAX_DEPTH = 2;

  function renderApoloFollowups(container, q, depth) {
    if (depth >= APOLO_FOLLOWUP_MAX_DEPTH) return;
    var wrap = el('div', 'apolo-followups');
    var label = txt('p', 'apolo-followups-label', t('apologetics.followupsLoading'));
    wrap.appendChild(label);
    container.appendChild(wrap);
    requestCached('apolo-followups', { scenario: q, difficulty: apoloDifficulty() })
      .then(function (data) {
        var qs = (data && data.questions) || [];
        if (!qs.length) { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); return; }
        label.textContent = t('apologetics.followupsHeading');
        var chips = el('div', 'apolo-followup-chips');
        qs.forEach(function (fq) {
          fq = cleanAIText(String(fq || '').trim());
          if (!fq) return;
          var chip = txt('button', 'apolo-followup', fq);
          chip.type = 'button';
          chip.addEventListener('click', function () {
            if (chip.dataset.opened) return;
            chip.dataset.opened = '1';
            chip.classList.add('is-open');
            openApoloFollowupAnswer(wrap, fq, depth);
          });
          chips.appendChild(chip);
        });
        wrap.appendChild(chips);
      })
      .catch(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); });
  }

  // load and show the answer to a tapped follow-up, then its own follow-ups
  function openApoloFollowupAnswer(wrap, fq, depth) {
    var ans = el('div', 'apolo-followup-answer');
    ans.appendChild(txt('p', 'apolo-followup-q', fq));
    var body = el('div', 'apolo-followup-body');
    body.appendChild(txt('p', 'verse-panel-note', t('apologetics.preparing')));
    ans.appendChild(body);
    wrap.appendChild(ans);
    requestCached('evangelism-prep', { scenario: fq + apoloDepthDirective(apoloDifficulty()) })
      .then(function (data) {
        body.textContent = '';
        body.appendChild(txt('div', 'road-station-answer prose', cleanAIText(((data && data.prep) || '').trim())));
        renderApoloFollowups(body, fq, depth + 1);
      })
      .catch(function (err) {
        body.textContent = '';
        body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

  /* After a lesson is cleared: update the world's star tally in the header and
     unlock the next lesson tile in place (so the answer stays open to read). */
  function refreshApoloAfterClear(id) {
    var parts = id.slice(1).split('q');
    var ti = parseInt(parts[0], 10), qi = parseInt(parts[1], 10);
    var th = APOLO_THEMES[ti];
    var set = apoloDoneSet();

    var prog = document.querySelector('.apolo-stage-progress-js');
    if (prog) prog.textContent = t('apologetics.starsOf', { done: themeDoneCount(th, ti, set), total: th.questions.length });

    var levelsWrap = document.querySelector('.apolo-levels');
    if (levelsWrap) {
      var tiles = levelsWrap.querySelectorAll('.apolo-level');
      var nextTile = tiles[qi + 1];
      if (nextTile && nextTile.classList.contains('is-locked')) {
        nextTile.parentNode.replaceChild(buildApoloLevel(ti, qi + 1, th.questions[qi + 1], set), nextTile);
      }
    }
  }

  document.getElementById('apologetics-reset').addEventListener('click', function () {
    if (!window.confirm(t('apologetics.resetConfirm'))) return;
    saveApolo({ done: [] });
    apoloStage = null;
    renderApologetics();
  });

  // lesson difficulty toggle: sets the depth used for every prepared answer
  document.querySelectorAll('#apolo-difficulty .apolo-diff-opt').forEach(function (btn) {
    btn.addEventListener('click', function () { setApoloDifficulty(btn.dataset.difficulty); });
  });
  updateApoloDifficultyUI();

  /* ============ Apologist Mode ============
     A live drill: the backend presents a real objection at the student's
     current difficulty, the student answers by typing or speaking, and the
     backend returns scored, specific feedback. The difficulty is stored in
     localStorage and nudged up as the student improves. */
  var APOLOGIST_LEVEL_KEY = 'tgp.apologistLevel';
  var apologistState = { objection: null, recog: null, listening: false, stopMic: null };

  function apologistLevel() {
    var n = parseInt(window.localStorage.getItem(APOLOGIST_LEVEL_KEY), 10);
    return (n >= 1 && n <= 5) ? n : 1;
  }
  function setApologistLevel(n) {
    n = Math.max(1, Math.min(5, parseInt(n, 10) || 1));
    try { window.localStorage.setItem(APOLOGIST_LEVEL_KEY, String(n)); } catch (e) { /* view-only */ }
    updateApologistLevelUI();
  }
  function updateApologistLevelUI() {
    var dots = document.getElementById('apologist-level-dots');
    var text = document.getElementById('apologist-level-text');
    if (!dots || !text) return;
    var lvl = apologistLevel();
    dots.textContent = '';
    // each dot is a clickable toggle for that difficulty (1..5)
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var dot = el('button', 'apologist-dot' + (n <= lvl ? ' is-on' : ''));
        dot.type = 'button';
        dot.title = t('apologist.setLevel', { n: n });
        dot.setAttribute('aria-label', t('apologist.setLevel', { n: n }));
        dot.addEventListener('click', function () { setApologistLevel(n); });
        dots.appendChild(dot);
      })(i);
    }
    text.textContent = t('apologist.levelName' + lvl);
  }

  // both the Apologist-mode and Objections perspective pickers share the catalogue
  function populatePerspectiveSelects() {
    if (typeof APOLO_PERSPECTIVES === 'undefined') return;
    ['apologist-perspective', 'objections-perspective'].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var placeholder = sel.querySelector('option');
      sel.textContent = '';
      if (placeholder) sel.appendChild(placeholder);
      APOLO_PERSPECTIVES.forEach(function (p) {
        var o = el('option');
        o.value = p.label;
        o.textContent = (p.icon ? p.icon + '  ' : '') + p.label;
        sel.appendChild(o);
      });
    });
  }

  // BCP-47 tag for the speech recognizer; most of our codes work as-is
  function speechLangTag(code) { return code === 'en' ? 'en-US' : code; }

  function setupApologistMic() {
    var mic = document.getElementById('apologist-mic');
    var note = document.getElementById('apologist-mic-note');
    var ta = document.getElementById('apologist-response');
    if (!mic || !ta) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { mic.hidden = true; if (note) note.hidden = false; return; }
    mic.hidden = false;

    function stopMic() {
      if (apologistState.recog) { try { apologistState.recog.stop(); } catch (e) { /* ignore */ } }
      apologistState.listening = false;
      mic.classList.remove('is-live');
    }
    apologistState.stopMic = stopMic;

    mic.addEventListener('click', function () {
      if (apologistState.listening) { stopMic(); return; }
      var recog = new SR();
      recog.lang = speechLangTag(currentLang);
      recog.interimResults = true;
      recog.continuous = true;
      var base = ta.value ? ta.value.replace(/\s*$/, '') + ' ' : '';
      var finalText = '';
      recog.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
        }
        ta.value = base + finalText + interim;
      };
      recog.onerror = function () { stopMic(); };
      recog.onend = function () { apologistState.listening = false; mic.classList.remove('is-live'); };
      apologistState.recog = recog;
      apologistState.listening = true;
      mic.classList.add('is-live');
      try { recog.start(); } catch (e) { stopMic(); }
    });
  }

  function loadNewObjection() {
    var arena = document.getElementById('apologist-arena');
    var status = document.getElementById('apologist-status');
    var btn = document.getElementById('apologist-new');
    if (!arena || !btn) return;
    if (apologistState.stopMic) apologistState.stopMic();
    var persp = (document.getElementById('apologist-perspective') || {}).value || '';
    btn.disabled = true;
    btn.textContent = t('apologist.loading');
    var fb = document.getElementById('apologist-feedback');
    fb.hidden = true; fb.textContent = '';
    status.textContent = '';
    request('apologist-objection', { difficulty: apologistLevel(), perspective: persp })
      .then(function (data) {
        apologistState.objection = data;
        document.getElementById('apologist-obj-perspective').textContent =
          (data.perspective || persp || '') + (data.topic ? ' · ' + data.topic : '');
        document.getElementById('apologist-obj-text').textContent = data.objection || '';
        document.getElementById('apologist-response').value = '';
        arena.hidden = false;
      })
      .catch(function (err) { status.textContent = err.message; })
      .then(function () { btn.disabled = false; btn.textContent = t('apologist.newObjection'); });
  }

  var APOLOGIST_SCORES = [
    ['biblical', 'apologist.scoreBiblical'],
    ['context', 'apologist.scoreContext'],
    ['historical', 'apologist.scoreHistorical'],
    ['logical', 'apologist.scoreLogical'],
    ['fairness', 'apologist.scoreFairness'],
    ['communication', 'apologist.scoreComm']
  ];
  function scoreClass(n) { return n >= 75 ? 'is-high' : (n >= 50 ? 'is-mid' : 'is-low'); }

  function submitEvaluation() {
    if (apologistState.stopMic) apologistState.stopMic();
    var ta = document.getElementById('apologist-response');
    var status = document.getElementById('apologist-status');
    var resp = (ta.value || '').trim();
    if (!apologistState.objection) { status.textContent = t('apologist.needObjection'); return; }
    if (!resp) { status.textContent = t('apologist.needAnswer'); return; }
    var fb = document.getElementById('apologist-feedback');
    var btn = document.getElementById('apologist-submit');
    btn.disabled = true;
    status.textContent = '';
    fb.hidden = false; fb.textContent = '';
    fb.appendChild(txt('p', 'verse-panel-note', t('apologist.grading')));
    request('apologist-evaluate', {
      objection: apologistState.objection.objection,
      perspective: apologistState.objection.perspective,
      difficulty: apologistState.objection.difficulty || apologistLevel(),
      response: resp
    })
      .then(function (data) {
        fb.textContent = '';
        fb.appendChild(renderEvaluation(data));
        if (data.nextDifficulty) setApologistLevel(data.nextDifficulty);
      })
      .catch(function (err) {
        fb.textContent = '';
        fb.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      })
      .then(function () { btn.disabled = false; });
  }

  function renderEvaluation(data) {
    var wrap = el('div', 'apologist-report');

    var overall = data.overall || 0;
    var head = el('div', 'apologist-overall ' + scoreClass(overall));
    head.appendChild(txt('span', 'apologist-overall-num', String(overall)));
    head.appendChild(txt('span', 'apologist-overall-label', t('apologist.overall')));
    wrap.appendChild(head);

    var scores = data.scores || {};
    var bars = el('div', 'apologist-scores');
    APOLOGIST_SCORES.forEach(function (pair) {
      var n = scores[pair[0]] || 0;
      var row = el('div', 'score-row');
      row.appendChild(txt('span', 'score-label', t(pair[1])));
      var track = el('div', 'score-track');
      var fill = el('div', 'score-fill ' + scoreClass(n));
      fill.style.width = n + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(txt('span', 'score-num', String(n)));
      bars.appendChild(row);
    });
    wrap.appendChild(bars);

    appendReportBlock(wrap, 'apologist.strongest', data.strongest, 'is-strong');
    appendReportBlock(wrap, 'apologist.weakest', data.weakest, 'is-weak');
    appendReportBlock(wrap, 'apologist.missing', data.missing, 'is-missing');
    appendReportBlock(wrap, 'apologist.stronger', data.stronger, 'is-model');

    if (Array.isArray(data.study) && data.study.length) {
      var box = el('div', 'apologist-block is-study');
      box.appendChild(txt('h4', 'apologist-block-title', t('apologist.study')));
      box.appendChild(buildNamedList(data.study.map(function (s) { return { name: s.topic, note: s.note }; })));
      wrap.appendChild(box);
    }
    if ((data.encouragement || '').trim()) {
      wrap.appendChild(txt('p', 'apologist-encouragement', cleanAIText(data.encouragement.trim())));
    }
    return wrap;
  }
  function appendReportBlock(wrap, labelKey, val, cls) {
    val = cleanAIText((val || '').trim());
    if (!val) return;
    var box = el('div', 'apologist-block ' + (cls || ''));
    box.appendChild(txt('h4', 'apologist-block-title', t(labelKey)));
    box.appendChild(txt('p', 'apologist-block-text', val));
    wrap.appendChild(box);
  }

  /* ============ Objections & Apologetics ============
     Real objections grouped by the perspective that raises them; opening one
     asks the `objection-study` endpoint for a full, fair analysis. A free-form
     box analyzes any objection the user types. */
  var OBJECTION_SECTIONS = [
    ['objectionStated', 'objections.stated', 'prose'],
    ['assumptions', 'objections.assumptions', 'list'],
    ['shortResponse', 'objections.short', 'prose'],
    ['detailedResponse', 'objections.detailed', 'prose'],
    ['biblicalContext', 'objections.biblical', 'prose'],
    ['logicalAnalysis', 'objections.logical', 'prose'],
    ['historicalEvidence', 'objections.historical', 'prose'],
    ['archaeologicalEvidence', 'objections.archaeological', 'prose'],
    ['languageEvidence', 'objections.language', 'prose'],
    ['strongestCounter', 'objections.counter', 'prose'],
    ['counterResponse', 'objections.counterResponse', 'prose'],
    ['uncertainty', 'objections.uncertainty', 'prose'],
    ['sources', 'objections.sources', 'list']
  ];

  function renderObjectionStudy(data) {
    if (!data) return null;
    var wrap = el('div', 'verse-context');
    var openFirst = true;
    OBJECTION_SECTIONS.forEach(function (s) {
      var content = s[2] === 'list' ? buildBulletList(data[s[0]]) : buildProseSection(data[s[0]]);
      if (!content) return;
      var det = el('details', 'ctx-section');
      if (openFirst) { det.open = true; openFirst = false; }
      var sum = el('summary', 'ctx-summary');
      sum.appendChild(txt('span', 'ctx-title', t(s[1])));
      det.appendChild(sum);
      var body = el('div', 'ctx-body');
      body.appendChild(content);
      det.appendChild(body);
      wrap.appendChild(det);
    });
    return wrap.children.length ? wrap : null;
  }

  function loadObjectionStudy(body, objection, perspective) {
    body.textContent = '';
    body.appendChild(txt('p', 'verse-panel-note', t('objections.analyzing')));
    requestCached('objection-study', { objection: objection, perspective: perspective || '' })
      .then(function (data) {
        body.textContent = '';
        body.appendChild(renderObjectionStudy(data) || txt('p', 'verse-panel-note', t('objections.none')));
      })
      .catch(function (err) {
        body.textContent = '';
        body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

  function renderObjectionsList() {
    var list = document.getElementById('objections-list');
    if (!list || typeof APOLO_PERSPECTIVES === 'undefined') return;
    list.textContent = '';
    APOLO_PERSPECTIVES.forEach(function (p) {
      var group = el('details', 'objection-group');
      var sum = el('summary', 'objection-group-head');
      sum.appendChild(txt('span', 'objection-group-icon', p.icon || '☩'));
      var titles = el('span', 'objection-group-titles');
      titles.appendChild(txt('span', 'objection-group-name', p.label));
      if (p.blurb) titles.appendChild(txt('span', 'objection-group-blurb', p.blurb));
      sum.appendChild(titles);
      group.appendChild(sum);
      var gbody = el('div', 'objection-group-body');
      p.objections.forEach(function (obj) {
        var row = el('details', 'apolo-objection');
        var head = el('summary', 'apolo-objection-head');
        head.appendChild(txt('span', 'apolo-objection-q', obj));
        row.appendChild(head);
        var body = el('div', 'apolo-objection-body');
        row.appendChild(body);
        var loaded = false;
        row.addEventListener('toggle', function () {
          if (row.open && !loaded) { loaded = true; loadObjectionStudy(body, obj, p.label); }
        });
        (function (objection, perspective) {
          warmOnIntent(row, function () { requestCached('objection-study', { objection: objection, perspective: perspective || '' }); });
        })(obj, p.label);
        gbody.appendChild(row);
      });
      group.appendChild(gbody);
      list.appendChild(group);
    });
  }

  // one-time wiring for both apologetics features
  (function setupApologeticsFeatures() {
    populatePerspectiveSelects();
    setupApologistMic();
    updateApologistLevelUI();
    var newBtn = document.getElementById('apologist-new');
    if (newBtn) newBtn.addEventListener('click', loadNewObjection);
    var submitBtn = document.getElementById('apologist-submit');
    if (submitBtn) submitBtn.addEventListener('click', submitEvaluation);
    var objForm = document.getElementById('objections-form');
    if (objForm) objForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('objections-input');
      var q = (input.value || '').trim();
      if (!q) return;
      var persp = (document.getElementById('objections-perspective') || {}).value || '';
      var box = document.getElementById('objections-custom');
      box.hidden = false; box.textContent = '';
      box.appendChild(txt('p', 'verse-panel-note', t('objections.analyzing')));
      request('objection-study', { objection: q, perspective: persp })
        .then(function (data) {
          box.textContent = '';
          box.appendChild(renderObjectionStudy(data) || txt('p', 'verse-panel-note', t('objections.none')));
        })
        .catch(function (err) {
          box.textContent = '';
          box.appendChild(txt('p', 'verse-panel-note is-error', err.message));
        });
    });
    renderObjectionsList();
  })();

  /* ---------- tips for new believers ---------- */

  var TIP_IDS = ['t1', 'trans', 't2', 't3', 't4', 't5', 't6', 't7', 't8',
    't9', 't10', 't11', 't12', 't13', 't14'];
  // a simple study method, shown under the "How to study the Bible" subtitle
  var STUDY_IDS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

  function renderTipList(listId, ids) {
    var list = document.getElementById(listId);
    if (!list) return;
    list.textContent = '';
    ids.forEach(function (id, i) {
      var card = el('article', 'tip-card');
      card.appendChild(txt('span', 'tip-num', String(i + 1)));
      var body = el('div', 'tip-body');
      body.appendChild(txt('h3', 'tip-title', t('tips.' + id + '.title')));
      body.appendChild(txt('p', 'tip-text', t('tips.' + id + '.body')));
      card.appendChild(body);
      list.appendChild(card);
    });
  }

  function renderTips() {
    renderTipList('tips-list', TIP_IDS);
    renderTipList('study-list', STUDY_IDS);
  }

  /* ---------- progress: streak, badges, notifications ---------- */

  /* One device-local store behind the whole gamification layer: the reading
     streak, which chapters have been read, which badges are earned, and the
     notification feed. Everything here is derived from actions the user already
     takes (reading a chapter, finishing a plan day, clearing an apologetics
     stage), so it needs no account and no backend. */
  var PROGRESS_KEY = 'tgp.progress';

  function loadProgress() {
    var p = {};
    try { p = JSON.parse(window.localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) { p = {}; }
    if (typeof p.streak !== 'number') p.streak = 0;
    if (typeof p.longest !== 'number') p.longest = 0;
    if (typeof p.daysActive !== 'number') p.daysActive = 0;
    if (typeof p.lastDay !== 'string') p.lastDay = null;
    if (!p.chapters || typeof p.chapters !== 'object') p.chapters = {};
    if (!p.badges || typeof p.badges !== 'object') p.badges = {};
    if (!Array.isArray(p.notifs)) p.notifs = [];
    return p;
  }
  function saveProgress(p) {
    try { window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (e) { /* view-only */ }
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function dayGap(from, to) {
    var a = new Date(from + 'T00:00:00');
    var b = new Date(to + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  // called whenever the user does something that counts as "showing up" today
  function recordActivity() {
    var p = loadProgress();
    var today = todayStr();
    if (p.lastDay === today) return; // already counted today

    if (p.lastDay && dayGap(p.lastDay, today) === 1) p.streak += 1;
    else p.streak = 1;
    p.lastDay = today;
    p.daysActive += 1;
    if (p.streak > p.longest) p.longest = p.streak;
    saveProgress(p);

    if (p.streak === 1) notify('streak', t('notif.streakStart.title'), t('notif.streakStart.body'));
    else notify('streak', t('notif.streak.title', { n: p.streak }), t('notif.streak.body', { n: p.streak }));
  }

  function chapterCount(p) {
    var n = 0;
    for (var k in p.chapters) { if (p.chapters[k]) n++; }
    return n;
  }
  // --- badge predicates over reading / streak / plan progress ---
  function testamentComplete(p, idx) {
    var g = BIBLE_BOOKS[idx];
    if (!g) return false;
    for (var i = 0; i < g.books.length; i++) {
      var b = g.books[i];
      for (var c = 1; c <= b.chapters; c++) { if (!p.chapters[b.name + '|' + c]) return false; }
    }
    return true;
  }
  function totalPlanDays() {
    var prog = loadPlanProgress();
    var n = 0;
    for (var k in prog) {
      if (k === 'bookPlan') continue;
      var d = prog[k] && prog[k].done;
      for (var i in (d || {})) { if (d[i]) n++; }
    }
    return n;
  }
  function planComplete(key, days) {
    var prog = loadPlanProgress();
    var d = prog[key] && prog[key].done;
    if (!d) return false;
    var n = 0;
    for (var i in d) { if (d[i]) n++; }
    return n >= days;
  }
  function anyBookPlanComplete() {
    var prog = loadPlanProgress();
    for (var k in prog) {
      if (k.indexOf('book:') !== 0) continue;
      var found = findBook(k.slice(5));
      if (!found) continue;
      var d = prog[k].done || {};
      var n = 0;
      for (var i in d) { if (d[i]) n++; }
      if (n >= found.book.chapters) return true;
    }
    return false;
  }

  // how many chapters of a given book have been read
  function chaptersReadIn(p, name, total) {
    var n = 0;
    for (var c = 1; c <= total; c++) { if (p.chapters[name + '|' + c]) n++; }
    return n;
  }
  // resolve a list of candidate book names to the ones that exist in the canon
  function resolveBooks(names) {
    var out = [];
    names.forEach(function (nm) {
      var f = findBook(nm);
      if (f) out.push({ name: f.book.name, chapters: f.book.chapters });
    });
    return out;
  }
  // every chapter of every book in the group has been read
  function groupComplete(p, books) {
    for (var i = 0; i < books.length; i++) {
      if (chaptersReadIn(p, books[i].name, books[i].chapters) < books[i].chapters) return false;
    }
    return true;
  }

  /* Over a thousand collectible badges, all generated so the how-to text stays
     in step with the data and every badge is earned through something the app
     already tracks: reading (per chapter, per book, per collection, and running
     totals), streaks, reading plans, and the Road to Apologetics. */
  function buildGeneralBadges() {
    var list = [];

    // ---- reading totals (📖) ----
    [1, 3, 5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 90, 100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1100, 1189].forEach(function (n) {
      list.push({
        id: 'chap:' + n, cat: 'Reading', icon: '📖',
        title: n === 1 ? 'First chapter' : (n >= 1189 ? 'Every chapter read' : ('Read ' + n + ' chapters')),
        desc: 'Read a total of ' + n + ' chapter' + (n > 1 ? 's' : ''),
        test: (function (need) { return function (p) { return chapterCount(p) >= need; }; })(n)
      });
    });

    // ---- streaks (🔥) and days in the Word (📅) ----
    [2, 3, 5, 7, 10, 14, 21, 30, 40, 50, 75, 100, 150, 200, 250, 300, 365, 500, 730, 1000].forEach(function (n) {
      list.push({
        id: 'streak:' + n, cat: 'Streaks', icon: '🔥',
        title: n + '-day streak', desc: 'Read on ' + n + ' days in a row',
        test: (function (need) { return function (p) { return p.longest >= need; }; })(n)
      });
    });
    [5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 365, 500, 730, 1000].forEach(function (n) {
      list.push({
        id: 'days:' + n, cat: 'Streaks', icon: '📅',
        title: n + ' days in the Word', desc: 'Read on ' + n + ' separate days',
        test: (function (need) { return function (p) { return p.daysActive >= need; }; })(n)
      });
    });

    // ---- testament milestones (👑) ----
    list.push({ id: 'ot', cat: 'Milestones', icon: '📜', title: 'Old Testament complete', desc: 'Read every chapter of all 39 Old Testament books', test: function (p) { return testamentComplete(p, 0); } });
    list.push({ id: 'nt', cat: 'Milestones', icon: '✝', title: 'New Testament complete', desc: 'Read every chapter of all 27 New Testament books', test: function (p) { return testamentComplete(p, 1); } });
    list.push({ id: 'whole', cat: 'Milestones', icon: '👑', title: 'The whole Bible', desc: 'Read every chapter of all 66 books', test: function (p) { return testamentComplete(p, 0) && testamentComplete(p, 1); } });

    // ---- reading plans (🏆) ----
    [1, 3, 7, 14, 21, 30, 60, 90, 120, 180, 270, 365].forEach(function (n) {
      list.push({
        id: 'planday:' + n, cat: 'Plans', icon: n >= 365 ? '🏆' : (n >= 100 ? '🏔️' : (n >= 30 ? '⛰️' : (n >= 7 ? '🗺️' : '🧭'))),
        title: n === 1 ? 'On the path' : ('Completed ' + n + ' plan days'),
        desc: 'Complete ' + n + ' reading-plan day' + (n > 1 ? 's' : ''),
        test: (function (need) { return function () { return totalPlanDays() >= need; }; })(n)
      });
    });
    list.push({ id: 'bookplan', cat: 'Plans', icon: '🎓', title: 'Book finisher', desc: 'Complete a One-Book-at-a-Time plan', test: function () { return anyBookPlanComplete(); } });
    list.push({ id: 'yearplan', cat: 'Plans', icon: '📿', title: 'The long road', desc: 'Complete the Bible-in-a-Year plan', test: function () { return planComplete('year', 365); } });

    // ---- canonical collections (📚): finish a whole section of Scripture ----
    var COLLECTIONS = [
      ['The Torah', ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy']],
      ['The Historical Books', ['Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther']],
      ['Wisdom & Poetry', ['Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon']],
      ['The Major Prophets', ['Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel']],
      ['The Minor Prophets', ['Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi']],
      ['The Four Gospels', ['Matthew', 'Mark', 'Luke', 'John']],
      ['The Pauline Epistles', ['Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon']],
      ['The General Epistles', ['Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude']]
    ];
    COLLECTIONS.forEach(function (pair, i) {
      var books = resolveBooks(pair[1]);
      if (!books.length) return;
      list.push({
        id: 'coll:' + i, cat: 'Collections', icon: '📚',
        title: pair[0] + ' complete',
        desc: 'Read every chapter of ' + pair[0].replace(/^The /, ''),
        test: (function (bks) { return function (p) { return groupComplete(p, bks); }; })(books)
      });
    });

    // ---- landmark chapters (⭐): read a famous, pivotal chapter ----
    var LANDMARKS = [
      ['Genesis 1', 'Creation'], ['Genesis 3', 'The Fall'], ['Genesis 12', 'The call of Abraham'],
      ['Exodus 3', 'The burning bush'], ['Exodus 14', 'The Red Sea'], ['Exodus 20', 'The Ten Commandments'],
      ['Leviticus 16', 'The Day of Atonement'], ['Deuteronomy 6', 'The Shema'], ['Joshua 1', 'Be strong and courageous'],
      ['Judges 7', 'Gideon’s three hundred'], ['Ruth 1', 'Where you go I will go'], ['1 Samuel 17', 'David and Goliath'],
      ['2 Samuel 7', 'The covenant with David'], ['1 Kings 18', 'Elijah on Mount Carmel'], ['Job 38', 'God answers Job'],
      ['Psalm 1', 'The two ways'], ['Psalm 22', 'The suffering psalm'], ['Psalm 23', 'The Lord is my shepherd'],
      ['Psalm 51', 'Create in me a clean heart'], ['Psalm 91', 'The shelter of the Most High'], ['Psalm 119', 'The longest psalm'],
      ['Psalm 139', 'Fearfully and wonderfully made'], ['Proverbs 3', 'Trust in the Lord'], ['Ecclesiastes 3', 'A time for everything'],
      ['Isaiah 6', 'Here am I, send me'], ['Isaiah 9', 'A child is born'], ['Isaiah 40', 'Comfort my people'],
      ['Isaiah 53', 'The suffering servant'], ['Jeremiah 29', 'Plans to prosper you'], ['Ezekiel 37', 'The valley of dry bones'],
      ['Daniel 3', 'The fiery furnace'], ['Daniel 6', 'Daniel in the lions’ den'], ['Jonah 2', 'Jonah’s prayer'],
      ['Micah 6', 'Act justly, love mercy'], ['Matthew 5', 'The Sermon on the Mount'], ['Matthew 6', 'The Lord’s Prayer'],
      ['Matthew 28', 'The Great Commission'], ['Luke 2', 'The birth of Jesus'], ['Luke 15', 'The prodigal son'],
      ['John 1', 'The Word made flesh'], ['John 3', 'For God so loved the world'], ['John 14', 'The way, the truth, the life'],
      ['Acts 2', 'Pentecost'], ['Romans 8', 'No condemnation'], ['Romans 12', 'A living sacrifice'],
      ['1 Corinthians 13', 'The love chapter'], ['1 Corinthians 15', 'The resurrection chapter'], ['Galatians 5', 'The fruit of the Spirit'],
      ['Ephesians 6', 'The armor of God'], ['Philippians 4', 'Rejoice always'], ['Hebrews 11', 'The hall of faith'],
      ['James 1', 'Consider it pure joy'], ['Revelation 21', 'A new heaven and earth'], ['Revelation 22', 'The river of life']
    ];
    LANDMARKS.forEach(function (pair, i) {
      var loc = parseRef(pair[0]);
      if (!loc) return;
      list.push({
        id: 'mark:' + i, cat: 'Landmark Chapters', icon: '⭐',
        title: pair[1], desc: 'Read ' + loc.book + ' ' + loc.chapter + ' — ' + pair[1],
        test: (function (b, c) { return function (p) { return !!p.chapters[b + '|' + c]; }; })(loc.book, loc.chapter)
      });
    });

    // ---- Road to Apologetics: a badge for every lesson and every world ----
    if (typeof APOLO_THEMES !== 'undefined') {
      APOLO_THEMES.forEach(function (th, ti) {
        th.questions.forEach(function (q, qi) {
          list.push({
            id: 'apolo:' + apoloId(ti, qi), cat: 'Apologetics: Lessons', icon: '🛡️',
            title: 'Lesson: ' + q,
            desc: 'Prepare an answer to “' + q + '” on the Road to Apologetics',
            test: (function (aid) { return function () { return !!apoloDoneSet()[aid]; }; })(apoloId(ti, qi))
          });
        });
      });
      APOLO_THEMES.forEach(function (th, ti) {
        list.push({
          id: 'apoloworld:' + ti, cat: 'Apologetics: Worlds', icon: '🏰',
          title: 'World ' + (ti + 1) + ': ' + th.theme,
          desc: 'Clear every lesson in “' + th.theme + '”',
          test: (function (idx) { return function () { return themeComplete(idx, apoloDoneSet()); }; })(ti)
        });
      });
      // ranks earned as more lessons are cleared
      [['Student', 1], ['Defender', 10], ['Apologist', 30], ['Ambassador', 75], ['Champion', 125], ['Contender for the Faith', 200]].forEach(function (pair, i) {
        list.push({
          id: 'apolorank:' + i, cat: 'Apologetics: Ranks', icon: '🎖️',
          title: 'Rank: ' + pair[0], desc: 'Clear ' + pair[1] + ' apologetics lesson' + (pair[1] > 1 ? 's' : ''),
          test: (function (need) { return function () { return apoloCounts().done >= need; }; })(pair[1])
        });
      });
    }

    // ---- one group per book: "Finished X" plus a badge for every chapter ----
    BIBLE_BOOKS.forEach(function (g) {
      g.books.forEach(function (b) {
        (function (book) {
          var cat = book.name;
          list.push({
            id: 'book:' + book.name, cat: cat, icon: '📗',
            title: 'Finished ' + book.name,
            desc: 'Read all ' + book.chapters + ' chapter' + (book.chapters > 1 ? 's' : '') + ' of ' + book.name,
            test: function (p) { return chaptersReadIn(p, book.name, book.chapters) >= book.chapters; }
          });
          for (var c = 1; c <= book.chapters; c++) {
            (function (ch) {
              list.push({
                id: 'ch:' + book.name + '|' + ch, cat: cat, icon: '📖',
                title: book.name + ' ' + ch,
                desc: 'Read ' + book.name + ' chapter ' + ch,
                test: function (p) { return !!p.chapters[book.name + '|' + ch]; }
              });
            })(c);
          }
        })(b);
      });
    });

    return list;
  }

  var GENERAL_BADGES = buildGeneralBadges();

  function checkBadges() {
    var p = loadProgress();
    var fresh = [];
    GENERAL_BADGES.forEach(function (b) {
      if (!p.badges[b.id] && b.test(p)) { p.badges[b.id] = todayStr(); fresh.push(b); }
    });
    if (!fresh.length) return;
    saveProgress(p);
    // a few at once → one toast each; a whole batch → a single summary, no spam
    if (fresh.length <= 4) {
      fresh.forEach(function (b) {
        notify('badge', t('notif.badge.title'), t('notif.badge.body', { name: b.title }));
      });
    } else {
      notify('badge', t('notif.badge.title'), t('notif.badgeBatch', { n: fresh.length }));
    }
  }

  // record that a chapter was read, then re-check streak and badges
  function markChapterRead(book, chapter) {
    var p = loadProgress();
    var key = book + '|' + chapter;
    if (!p.chapters[key]) { p.chapters[key] = true; saveProgress(p); }
    recordActivity();
    checkBadges();
    renderProgressUI();
  }

  /* ---- notifications: a stored feed plus a transient toast ---- */

  // icon per notification kind: badges, streaks, and messages from the team
  function notifIcon(type) {
    if (type === 'badge') return '🏅';
    if (type === 'message') return '✉️';
    if (type === 'report') return '📩';
    return '🔥';
  }

  function notify(type, title, body) {
    var p = loadProgress();
    p.notifs.unshift({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: type, title: title, body: body, ts: Date.now(), read: false
    });
    if (p.notifs.length > 40) p.notifs = p.notifs.slice(0, 40);
    saveProgress(p);
    showToast(type, title, body);
    renderNotifUI();
    if (type === 'badge') celebrateBadge();
  }

  /* ---- badge celebration: green flash + confetti from both sides + a trumpet
     fanfare. All self-contained (no assets): the sound is synthesized with the
     Web Audio API, the confetti drawn on a throwaway canvas. Honors
     prefers-reduced-motion by toning the visuals down, and de-bounces so a
     burst of badges doesn't stack a dozen overlays. */
  var celebrateBusy = false;
  var celebrateAudioCtx = null;
  function celebrateBadge() {
    if (celebrateBusy) return;
    celebrateBusy = true;
    setTimeout(function () { celebrateBusy = false; }, 1600);
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    playTrumpetFanfare();
    flashGreen(reduce);
    if (!reduce) blastConfetti();
  }

  function flashGreen(reduce) {
    var flash = el('div', 'celebrate-flash');
    document.body.appendChild(flash);
    // force a reflow so the transition runs, then fade in and back out
    void flash.offsetWidth;
    flash.classList.add('is-on');
    setTimeout(function () { flash.classList.remove('is-on'); }, reduce ? 240 : 420);
    setTimeout(function () { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 1100);
  }

  function blastConfetti() {
    var canvas = el('canvas', 'celebrate-confetti');
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W = window.innerWidth, H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    var colors = ['#2fbf6b', '#8be0a8', '#e8c33a', '#ffffff', '#1c7a4b', '#f5c451'];
    var parts = [];
    function spawn(fromLeft) {
      var n = 70;
      for (var i = 0; i < n; i++) {
        var ang = fromLeft ? (-Math.PI / 2.6 + Math.random() * 0.8) : (-Math.PI + Math.PI / 2.6 - Math.random() * 0.8);
        var speed = 9 + Math.random() * 12;
        parts.push({
          x: fromLeft ? -10 : W + 10,
          y: H * (0.55 + Math.random() * 0.35),
          vx: Math.cos(ang) * speed * (fromLeft ? 1 : -1),
          vy: Math.sin(ang) * speed,
          size: 5 + Math.random() * 7,
          color: colors[(Math.random() * colors.length) | 0],
          rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
          life: 0
        });
      }
    }
    spawn(true); spawn(false);

    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var elapsed = ts - start;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.vy += 0.35;               // gravity
        p.vx *= 0.99;               // drag
        p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life++;
        var alpha = Math.max(0, 1 - elapsed / 2200);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (elapsed < 2300) { window.requestAnimationFrame(frame); }
      else if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }
    window.requestAnimationFrame(frame);
  }

  // a short brass-like fanfare (G–C–E–G rising, then a held chord)
  function playTrumpetFanfare() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!celebrateAudioCtx) celebrateAudioCtx = new AC();
      var ac = celebrateAudioCtx;
      if (ac.state === 'suspended') ac.resume();
      var now = ac.currentTime;
      var master = ac.createGain();
      master.gain.value = 0.0001;
      master.connect(ac.destination);

      function note(freq, start, dur, peak) {
        var t0 = now + start;
        var osc1 = ac.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = freq;
        var osc2 = ac.createOscillator(); osc2.type = 'square'; osc2.frequency.value = freq;
        var g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + 0.03);   // sharp brass attack
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc1.connect(g); osc2.connect(g); g.connect(master);
        osc1.start(t0); osc2.start(t0);
        osc1.stop(t0 + dur + 0.05); osc2.stop(t0 + dur + 0.05);
      }
      master.gain.setValueAtTime(0.28, now);
      var G4 = 392.0, C5 = 523.25, E5 = 659.25, G5 = 783.99;
      note(G4, 0.00, 0.16, 0.5);
      note(C5, 0.14, 0.16, 0.5);
      note(E5, 0.28, 0.16, 0.5);
      note(G5, 0.42, 0.55, 0.6);
      // triumphant held chord
      note(C5, 0.42, 0.6, 0.35);
      note(E5, 0.42, 0.6, 0.35);
      master.gain.setValueAtTime(0.28, now + 0.9);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
    } catch (e) { /* audio best-effort */ }
  }

  function showToast(type, title, body) {
    var stack = document.getElementById('toast-stack');
    if (!stack) return;
    var toast = el('div', 'toast toast-' + type);
    toast.appendChild(txt('span', 'toast-icon', notifIcon(type)));
    var textWrap = el('div', 'toast-text');
    textWrap.appendChild(txt('p', 'toast-title', title));
    if (body) textWrap.appendChild(txt('p', 'toast-body', body));
    toast.appendChild(textWrap);
    stack.appendChild(toast);
    // fade in, hold, fade out, remove
    (window.requestAnimationFrame || function (f) { f(); })(function () { toast.classList.add('is-in'); });
    setTimeout(function () {
      toast.classList.remove('is-in');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 400);
    }, 4600);
  }

  function unreadCount() {
    return loadProgress().notifs.filter(function (n) { return !n.read; }).length;
  }

  function renderNotifUI() {
    var count = unreadCount();
    document.querySelectorAll('.js-notif-count').forEach(function (badge) {
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.hidden = count === 0;
    });
  }

  function renderNotifList() {
    var list = document.getElementById('notif-list');
    if (!list) return;
    list.textContent = '';
    var notifs = loadProgress().notifs;
    if (!notifs.length) {
      list.appendChild(txt('p', 'notif-empty', t('notif.empty')));
      return;
    }
    notifs.forEach(function (n) {
      var item = el('div', 'notif-item notif-' + n.type);
      item.appendChild(txt('span', 'notif-item-icon', notifIcon(n.type)));
      var body = el('div', 'notif-item-body');
      body.appendChild(txt('p', 'notif-item-title', n.title));
      if (n.body) body.appendChild(txt('p', 'notif-item-text', n.body));
      item.appendChild(body);
      list.appendChild(item);
    });
  }

  function openNotif() {
    var panel = document.getElementById('notif-panel');
    var scrim = document.getElementById('notif-scrim');
    // pull any team messages waiting for this device, then render
    syncServerNotifs();
    renderNotifList();
    panel.hidden = false;
    scrim.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    // opening the drawer clears the unread count
    var p = loadProgress();
    p.notifs.forEach(function (n) { n.read = true; });
    saveProgress(p);
    renderNotifUI();
    (window.requestAnimationFrame || function (f) { f(); })(function () { panel.classList.add('is-open'); });
  }
  function closeNotif() {
    var panel = document.getElementById('notif-panel');
    var scrim = document.getElementById('notif-scrim');
    panel.classList.remove('is-open');
    scrim.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    setTimeout(function () { panel.hidden = true; }, 250);
  }

  /* ---- the Home dashboard: streak numbers + badge grid ---- */

  /* First-run "start here": a brand-new reader lands on Today with zeroed stats
     and no obvious first step. Until they've read a chapter or shown up once, we
     surface a small, friendly card pointing at three concrete starting points.
     It disappears the moment they engage, so it never nags a returning reader. */
  function renderFirstRun() {
    var host = document.getElementById('first-run');
    if (!host) return;
    var p = loadProgress();
    var isNew = p.daysActive === 0 && chapterCount(p) === 0;
    if (!isNew) { host.hidden = true; host.textContent = ''; return; }
    if (host.dataset.built === '1') { host.hidden = false; return; }

    host.textContent = '';
    host.appendChild(txt('h2', 'today-section-title', t('home.firstRunTitle')));
    host.appendChild(txt('p', 'first-run-lede', t('home.firstRunLede')));
    var grid = el('div', 'first-run-grid');
    [
      { view: 'plans', n: '1', t: 'home.firstRunPlan', d: 'home.firstRunPlanHint' },
      { view: 'bible', n: '2', t: 'home.firstRunBible', d: 'home.firstRunBibleHint' },
      { view: 'tips',  n: '3', t: 'home.firstRunTips', d: 'home.firstRunTipsHint' }
    ].forEach(function (step) {
      var b = el('button', 'first-run-step');
      b.type = 'button';
      b.appendChild(txt('span', 'first-run-n', step.n));
      var body = el('span', 'first-run-body');
      body.appendChild(txt('span', 'first-run-t', t(step.t)));
      body.appendChild(txt('span', 'first-run-d', t(step.d)));
      b.appendChild(body);
      b.addEventListener('click', function () { showView(step.view); });
      grid.appendChild(b);
    });
    host.appendChild(grid);
    host.dataset.built = '1';
    host.hidden = false;
  }

  function renderProgressUI() {
    var p = loadProgress();
    document.querySelectorAll('.js-streak-count').forEach(function (n) { n.textContent = String(p.streak); });
    renderFirstRun();
    renderWalkWeek();
    renderWalkEncourage();
    renderExploreApoloTag();
    var days = document.getElementById('dash-days');
    if (days) days.textContent = String(p.daysActive);
    var chapters = document.getElementById('dash-chapters');
    if (chapters) chapters.textContent = String(chapterCount(p));

    var earned = GENERAL_BADGES.filter(function (b) { return p.badges[b.id]; }).length;
    // the summary appears both as a home teaser and atop the Badges tab
    document.querySelectorAll('.js-badge-summary').forEach(function (summary) {
      summary.textContent = t('dash.badgesEarned', { done: earned, total: GENERAL_BADGES.length });
    });

    // the full grid is over a thousand tiles — only build it when it's on screen
    if (document.getElementById('view-badges').classList.contains('is-active')) renderBadgeGrid();
  }

  function renderBadgeGrid() {
    var wrap = document.getElementById('badge-grid');
    if (!wrap) return;
    var p = loadProgress();
    wrap.textContent = '';

    // group by category, keeping the order categories first appear
    var cats = [], byCat = {};
    GENERAL_BADGES.forEach(function (b) {
      if (!byCat[b.cat]) { byCat[b.cat] = []; cats.push(b.cat); }
      byCat[b.cat].push(b);
    });

    var frag = document.createDocumentFragment();
    cats.forEach(function (cat) {
      var items = byCat[cat];
      var ec = items.filter(function (b) { return p.badges[b.id]; }).length;
      var group = el('div', 'badge-group');
      group.appendChild(txt('h4', 'badge-group-title', cat + ' · ' + ec + '/' + items.length));
      var grid = el('div', 'badge-grid-inner');
      items.forEach(function (b) {
        var got = !!p.badges[b.id];
        var tile = el('div', 'badge' + (got ? ' is-earned' : ' is-locked'));
        tile.appendChild(txt('span', 'badge-icon', got ? b.icon : '🔒'));
        tile.appendChild(txt('span', 'badge-name', b.title));
        tile.appendChild(txt('span', 'badge-desc', b.desc)); // how-to, shown earned or locked
        grid.appendChild(tile);
      });
      group.appendChild(grid);
      frag.appendChild(group);
    });
    wrap.appendChild(frag);
  }

  /* ---------- beta readiness (temporary launch tracker) ----------
     A plain count of tasks shipped vs. tasks recommended before beta. Lives in
     its own tab above Settings; delete this block, its view, its nav link, and
     the showView/openApp calls once it reaches 100%. */
  var BETA_TASKS = [
    { cat: 'Reading & study', items: [
      { t: 'Bible reader — browse and read by chapter', done: true },
      { t: 'Verse of the day', done: true },
      { t: 'Search scripture', done: true },
      { t: 'Highlights & side notes', done: true },
      { t: 'Cross-references — arc map, lookup & dropdown builder', done: true },
      { t: 'Illustrated Bible timeline', done: true },
      { t: 'Definitions — A–Z with admin entries', done: true },
      { t: 'Reading-progress dial', done: true },
      { t: 'Messianic prophecy — fulfilments, timeline & odds', done: true }
    ]},
    { cat: 'Growth & discipleship', items: [
      { t: 'Devotional generator & write-your-own', done: true },
      { t: 'Bible plans — 121 plans + plan builder', done: true },
      { t: 'The Road to Apologetics — stations, Apologist Mode, objections', done: true },
      { t: 'Tips for new believers', done: true },
      { t: 'Badges & celebrations', done: true }
    ]},
    { cat: 'Platform & experience', items: [
      { t: 'Dark / light theming', done: true },
      { t: '40-language interface', done: true },
      { t: 'Settings — one group per feature', done: true },
      { t: 'Daily reading reminders (web push)', done: true },
      { t: 'Responsive & accessibility QA pass', done: false, note: 'A skip-to-content link now ships; still to do — sweep every view on phone sizes and a full keyboard & screen-reader check.' }
    ]},
    { cat: 'Backend (n8n)', items: [
      { t: 'Core Claude workflows & credential', done: true },
      { t: 'Devotional length & apologetics tone wired to prompts', done: true },
      { t: 'Multilingual scripture via Claude', done: true },
      { t: 'Reader endpoints — chapter, context, insights, quiz', done: true },
      { t: 'Definitions, follow-ups & reminders workflows', done: true },
      { t: 'Wire search-context & translation into scripture', done: false, note: 'Settings exist in the UI but the scripture node ignores them.' },
      { t: 'Save / read verses keyed by language', done: false, note: 'Today one verse is stored in one language only.' },
      { t: 'Rewrite the apologetics system prompt', done: false, note: 'evangelism-prep path stays; the prompt needs the apologetics rework.' }
    ]},
    { cat: 'Accounts & sync', items: [
      { t: 'Sign-in / accounts', done: true, note: 'Clerk sign-in / create-account is wired into the app; signing in identifies the user and starts cloud sync.' },
      { t: 'Cloud-saved plans, progress & notes', done: false, note: 'The sync client mirrors on-device state to the backend on sign-in; still needs an end-to-end check that it persists and merges across devices.' }
    ]},
    { cat: 'Release readiness', items: [
      { t: 'Content QA across all 40 languages', done: false, note: 'Spot-check scripture and generated text per language.' },
      { t: 'Install as an app (PWA) — offline & icon', done: true, note: 'Shipped: a precaching service worker (network-first for pages so a new deploy always wins, stale-while-revalidate for assets), web manifest, installable icon and iOS install meta. The shell opens with no connection and installs to the home screen.' },
      { t: 'Error monitoring', done: true, note: 'Shipped: a privacy-respecting on-device ring buffer captures the last 15 runtime errors and rides along (with version + user agent) on any problem report a reader sends, so breakage surfaces to the team with no third-party telemetry. Usage counters are still optional/future.' },
      { t: 'Privacy policy & about page', done: true, note: 'Shipped: an About view (linked from the footer) with what the app is, a plain-language privacy note (on-device storage, optional Clerk sign-in, the AI backend, opt-in push, no ad tracking), and a study-notes trust explainer.' },
      { t: 'Label AI vs reviewed study content', done: true, note: 'Shipped: every verse-context, chapter and book overview ends with an honest provenance footnote — "AI-assisted" for generated notes, a green "reviewed" mark for the curated ones.' },
      { t: 'Image / artwork credits page', done: false, note: 'The About page now credits scripture & data sources (bible-api, API.Bible, WLC, Tischendorf, openbible CC BY, Strong\'s); still add the Wikimedia artwork attributions in one place (the timeline already shows per-image credit inline).' }
    ]}
  ];

  /* ---------- readiness audit (letter-graded) ----------
     A qualitative grade per dimension, to sit above the plain task tally. The
     app is strong on features and content; the points it's missing are release-
     hardening — offline, accounts, launch checks. Scores are 0-100; the letter
     is derived. Edit the scores/notes freely as things land. */
  var AUDIT_DIMENSIONS = [
    { name: 'Content & study features', score: 95,
      note: 'Reader, search, cross-references, timeline, messianic prophecy, devotionals, plans, apologetics and definitions — an unusually complete study Bible for teaching evangelism and apologetics.' },
    { name: 'Offline & speed', score: 88,
      note: 'Now strong: a precaching service worker serves the whole shell offline (network-first pages, stale-while-revalidate assets), a persistent localStorage answer cache (tgp.genCache.v1) makes chapter guides, context and quizzes reappear instantly across reloads, and drop-downs still warm on hover. Remaining nit: the Definitions endpoint isn’t on the persistent cache yet.' },
    { name: 'Backend robustness', score: 72,
      note: 'The n8n + Claude endpoints all respond, but the search-context and translation settings are ignored by the scripture node, verses save in one language only, and the apologetics prompt still needs its rework.' },
    { name: 'Accounts & sync', score: 70,
      note: 'Sign-in genuinely works — Clerk mounts the sign-in / create-account / user button and, once signed in, starts the sync client that mirrors on-device state. Two caveats keep this from an A: it runs on a Clerk dev instance (pk_test key) and the sync API points at a Vercel *preview* origin, and cross-device persistence hasn’t been verified end-to-end. Front-end (GitHub Pages) and API (Vercel) are cross-origin, so CORS/env must be confirmed.' },
    { name: 'Release readiness', score: 74,
      note: 'A big lift: the installable PWA/offline shell, an About + privacy page, on-device error capture (attached to reports), and honest AI-vs-reviewed labels on every study note have all shipped. Still open before a public beta: a consolidated artwork-credits page, a full 40-language content spot-check, and an accessibility pass (a keyboard / screen-reader sweep on phone sizes, and a skip-to-content link).' }
  ];
  var AUDIT_WEIGHTS = {
    'Content & study features': 3,
    'Offline & speed': 2,
    'Backend robustness': 2,
    'Accounts & sync': 1,
    'Release readiness': 1
  };
  function gradeLetter(score) {
    if (score >= 93) return 'A';  if (score >= 90) return 'A-';
    if (score >= 87) return 'B+'; if (score >= 83) return 'B'; if (score >= 80) return 'B-';
    if (score >= 77) return 'C+'; if (score >= 73) return 'C'; if (score >= 70) return 'C-';
    if (score >= 67) return 'D+'; if (score >= 63) return 'D'; if (score >= 60) return 'D-';
    return 'F';
  }
  function auditOverall() {
    var wsum = 0, ssum = 0;
    AUDIT_DIMENSIONS.forEach(function (d) {
      var w = AUDIT_WEIGHTS[d.name] || 1; wsum += w; ssum += w * d.score;
    });
    var score = wsum ? Math.round(ssum / wsum) : 0;
    return { score: score, letter: gradeLetter(score) };
  }

  /* The remaining path to 100%. Offline/PWA and the persistent answer cache are
     now shipped, so those earlier priorities are done; what's left is release-
     hardening and the three backend prompt items. Ordered to unblock beta. */
  var FOCUS_NOW = [
    { t: 'Harden the backend prompts',
      d: 'Three n8n items: make the scripture node honour the search-context and translation settings, save/read verses keyed by language, and finish the apologetics system-prompt rework.' },
    { t: 'Verify accounts & cloud sync end-to-end',
      d: 'Move Clerk off the dev pk_test key, confirm the Vercel/Neon sync API is reachable cross-origin from GitHub Pages (CORS + env), then check that plans, progress and notes persist and merge across two devices.' },
    { t: 'Curate the on-ramp overviews',
      d: 'Book & chapter overviews are AI-drafted for 65 of 66 books (Genesis is the reviewed exception). Curate the books a new believer opens first — John, Mark, Luke, Psalms, Romans, Acts — so the "reviewed" mark spreads to high-traffic reading.' },
    { t: 'Finish the release-readiness pages',
      d: 'About + privacy, error capture and AI-vs-reviewed labels have shipped. Remaining: a consolidated artwork-credits page, and hiding the Beta/Admin tabs from the public build.' },
    { t: 'Accessibility & 40-language QA',
      d: 'Skip-to-content link done; still run a keyboard/screen-reader sweep on phone sizes, and spot-check scripture and generated text per language. (<html lang> already updates on language change.)' }
  ];

  function renderAudit(panel) {
    var overall = auditOverall();
    var wrap = el('div', 'audit-block');
    var head = el('div', 'audit-head');
    var badge = el('div', 'audit-grade grade-' + overall.letter.charAt(0).toLowerCase());
    badge.appendChild(txt('span', 'audit-grade-letter', overall.letter));
    badge.appendChild(txt('span', 'audit-grade-score', overall.score + ' / 100'));
    head.appendChild(badge);
    var htext = el('div', 'audit-head-text');
    htext.appendChild(txt('h2', 'audit-title', 'Readiness grade'));
    htext.appendChild(txt('p', 'audit-sub', 'Feature-complete and content-rich, with offline/PWA and the persistent answer cache now shipped. The gap to 100% is release-hardening — backend prompts, verified accounts/sync, and launch checks.'));
    head.appendChild(htext);
    wrap.appendChild(head);

    var grid = el('div', 'audit-grid');
    AUDIT_DIMENSIONS.forEach(function (d) {
      var letter = gradeLetter(d.score);
      var card = el('div', 'audit-dim');
      var top = el('div', 'audit-dim-top');
      top.appendChild(txt('span', 'audit-dim-name', d.name));
      top.appendChild(txt('span', 'audit-dim-grade grade-' + letter.charAt(0).toLowerCase(), letter));
      card.appendChild(top);
      var track = el('div', 'audit-dim-track');
      var fill = el('div', 'audit-dim-fill'); fill.style.width = d.score + '%';
      track.appendChild(fill); card.appendChild(track);
      card.appendChild(txt('p', 'audit-dim-note', d.note));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    panel.appendChild(wrap);
  }

  function renderFocus(panel) {
    var wrap = el('div', 'beta-callout focus-block');
    wrap.appendChild(txt('h2', 'beta-callout-title', 'Focus now — the path to 100%'));
    wrap.appendChild(txt('p', 'beta-callout-lede', 'What remains between today’s grade and a 100% public beta, in the order to tackle it.'));
    var road = el('div', 'beta-road');
    FOCUS_NOW.forEach(function (f, i) {
      var r = el('div', 'beta-road-item');
      r.appendChild(txt('span', 'beta-road-n', String(i + 1)));
      var body = el('span', 'beta-road-t');
      body.appendChild(txt('strong', 'focus-t', f.t));
      body.appendChild(txt('span', 'focus-d', f.d));
      r.appendChild(body);
      road.appendChild(r);
    });
    wrap.appendChild(road);
    panel.appendChild(wrap);
  }

  function betaTally() {
    var done = 0, total = 0;
    BETA_TASKS.forEach(function (c) { c.items.forEach(function (i) { total++; if (i.done) done++; }); });
    return { done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0 };
  }
  // keep the little percentage badge on the nav link current
  function updateBetaBadge() {
    var badge = document.getElementById('nav-beta-pct');
    if (badge) badge.textContent = betaTally().pct + '%';
  }
  function renderBeta() {
    var panel = document.getElementById('beta-panel');
    if (!panel) return;
    panel.textContent = '';
    var overall = betaTally();
    var remaining = overall.total - overall.done;

    // hero: big percentage + overall bar
    var hero = el('div', 'beta-hero');
    var top = el('div', 'beta-hero-top');
    var fig = el('div', 'beta-hero-figure');
    var pct = el('span', 'beta-hero-pct'); pct.textContent = overall.pct; pct.appendChild(txt('span', 'beta-hero-unit', '%'));
    fig.appendChild(pct);
    var lab = el('div', 'beta-hero-label');
    lab.appendChild(txt('span', 'beta-hero-strong', overall.done + ' of ' + overall.total + ' tasks complete'));
    lab.appendChild(txt('span', 'beta-hero-sub', remaining + ' recommended before beta'));
    fig.appendChild(lab);
    top.appendChild(fig);
    var stage = overall.pct >= 100 ? t('beta.stageReady') : overall.pct >= 90 ? t('beta.stageRC') : overall.pct >= 66 ? t('beta.stageFeature') : overall.pct >= 40 ? t('beta.stageCore') : t('beta.stageEarly');
    top.appendChild(txt('span', 'beta-stage-chip', stage));
    hero.appendChild(top);
    var track = el('div', 'beta-track');
    var fill = el('div', 'beta-track-fill');
    hero.appendChild(track); track.appendChild(fill);
    panel.appendChild(hero);

    // letter-graded readiness audit
    renderAudit(panel);

    // by area
    panel.appendChild(txt('h2', 'prog-subhead', t('beta.byArea')));
    var mini = [];
    BETA_TASKS.forEach(function (c) {
      var d = c.items.filter(function (i) { return i.done; }).length;
      var row = progressBar(c.cat, d, c.items.length);
      panel.appendChild(row);
      mini.push(row.querySelector('.prog-bar-fill'));
    });

    // your four named priorities, front and centre
    renderFocus(panel);

    // every task, by area
    panel.appendChild(txt('h2', 'prog-subhead', t('beta.everyTask')));
    var cards = el('div', 'beta-cards');
    BETA_TASKS.forEach(function (c) {
      var d = c.items.filter(function (i) { return i.done; }).length;
      var p = c.items.length ? Math.round((d / c.items.length) * 100) : 0;
      var card = el('div', 'beta-card');
      var head = el('div', 'beta-card-head');
      head.appendChild(txt('h3', 'beta-card-title', c.cat));
      head.appendChild(txt('span', 'beta-card-pct', p + '%'));
      card.appendChild(head);
      var list = el('ul', 'beta-items');
      c.items.forEach(function (i) {
        var li = el('li', 'beta-item ' + (i.done ? 'is-done' : 'is-todo'));
        li.appendChild(txt('span', 'beta-mark ' + (i.done ? 'done' : 'todo'), i.done ? '✓' : ''));
        var body = el('span', 'beta-item-text');
        body.appendChild(document.createTextNode(i.t));
        if (i.note) body.appendChild(txt('span', 'beta-item-note', i.note));
        li.appendChild(body);
        list.appendChild(li);
      });
      card.appendChild(list);
      cards.appendChild(card);
    });
    panel.appendChild(cards);

    // the road to beta — remaining tasks in a sensible order
    var order = ['Accounts & sync', 'Backend (n8n)', 'Release readiness', 'Platform & experience'];
    var todo = [];
    order.forEach(function (name) {
      var c = BETA_TASKS.filter(function (x) { return x.cat === name; })[0];
      if (c) c.items.forEach(function (i) { if (!i.done) todo.push(i.t); });
    });
    if (todo.length) {
      var callout = el('div', 'beta-callout');
      callout.appendChild(txt('h2', 'beta-callout-title', t('beta.roadHeading')));
      callout.appendChild(txt('p', 'beta-callout-lede', t('beta.roadLede')));
      var road = el('div', 'beta-road');
      todo.forEach(function (tk, i) {
        var r = el('div', 'beta-road-item');
        r.appendChild(txt('span', 'beta-road-n', String(i + 1)));
        r.appendChild(txt('span', 'beta-road-t', tk));
        road.appendChild(r);
      });
      callout.appendChild(road);
      panel.appendChild(callout);
    } else {
      panel.appendChild(txt('p', 'prog-note', t('beta.doneNote')));
    }

    // animate the bars in (setTimeout: reliable even when not compositing)
    window.setTimeout(function () {
      fill.style.width = overall.pct + '%';
      mini.forEach(function (f) { /* progressBar already set width inline */ });
    }, 60);
  }

  /* ---------- reading progress (a Credit-Karma-style dial) ----------
     A big semicircular gauge for the share of the whole Bible read, then a
     testament split and a section-by-section breakdown. All from the same
     per-chapter reading data the badges use. */
  var PROGRESS_SECTIONS = [
    { key: 'progress.secTorah', names: ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'] },
    { key: 'progress.secHistory', names: ['Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther'] },
    { key: 'progress.secWisdom', names: ['Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon'] },
    { key: 'progress.secMajor', names: ['Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel'] },
    { key: 'progress.secMinor', names: ['Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'] },
    { key: 'progress.secGospels', names: ['Matthew', 'Mark', 'Luke', 'John', 'Acts'] },
    { key: 'progress.secPaul', names: ['Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon'] },
    { key: 'progress.secGeneral', names: ['Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'] }
  ];

  // read / total chapters across a list of books
  function sectionTally(p, names) {
    var read = 0, total = 0;
    resolveBooks(names).forEach(function (b) {
      total += b.chapters;
      read += chaptersReadIn(p, b.name, b.chapters);
    });
    return { read: read, total: total };
  }
  // read / total chapters for a whole testament (0 = OT, 1 = NT)
  function testamentTally(p, idx) {
    var read = 0, total = 0;
    BIBLE_BOOKS[idx].books.forEach(function (b) {
      total += b.chapters;
      read += chaptersReadIn(p, b.name, b.chapters);
    });
    return { read: read, total: total };
  }
  function booksFinished(p) {
    var n = 0;
    BIBLE_BOOKS.forEach(function (g) {
      g.books.forEach(function (b) { if (chaptersReadIn(p, b.name, b.chapters) >= b.chapters) n++; });
    });
    return n;
  }

  // one labelled progress bar (label · read/total · percent)
  function progressBar(label, read, total) {
    var pct = total ? Math.round((read / total) * 100) : 0;
    var row = el('div', 'prog-bar-row');
    var head = el('div', 'prog-bar-head');
    head.appendChild(txt('span', 'prog-bar-label', label));
    head.appendChild(txt('span', 'prog-bar-count', read + '/' + total + ' · ' + pct + '%'));
    row.appendChild(head);
    var track = el('div', 'prog-bar-track');
    var fill = el('div', 'prog-bar-fill');
    fill.style.width = pct + '%';
    track.appendChild(fill);
    row.appendChild(track);
    return row;
  }

  function renderReadingProgress() {
    var panel = document.getElementById('progress-panel');
    if (!panel) return;
    var p = loadProgress();
    var read = chapterCount(p), total = 1189;
    var pct = total ? (read / total) * 100 : 0;
    var pctR = Math.round(pct);
    panel.textContent = '';

    // --- the dial: a semicircular gauge, filled to the percentage read ---
    var ARC = 282.743; // path length of the semicircle below (π · r, r = 90)
    var off = ARC * (1 - pct / 100);
    var dial = el('div', 'prog-dial');
    dial.innerHTML =
      '<svg class="prog-dial-svg" viewBox="0 0 200 128" role="img" aria-label="' + pctR + '%">' +
        '<defs><linearGradient id="progGrad" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0" stop-color="#f6c453"/><stop offset="0.5" stop-color="#6fcf97"/><stop offset="1" stop-color="#56ccf2"/>' +
        '</linearGradient></defs>' +
        '<path class="prog-dial-track" d="M 10 118 A 90 90 0 0 1 190 118" fill="none" stroke-width="16" stroke-linecap="round"/>' +
        '<path class="prog-dial-value" d="M 10 118 A 90 90 0 0 1 190 118" fill="none" stroke-width="16" stroke-linecap="round" stroke="url(#progGrad)" ' +
          'stroke-dasharray="' + ARC + '" stroke-dashoffset="' + ARC + '"/>' +
      '</svg>';
    var center = el('div', 'prog-dial-center');
    center.appendChild(txt('span', 'prog-dial-pct', pctR + '%'));
    center.appendChild(txt('span', 'prog-dial-caption', t('progress.ofBible')));
    dial.appendChild(center);
    panel.appendChild(dial);

    // headline counts under the dial
    var counts = el('div', 'prog-counts');
    function stat(num, label) {
      var s = el('div', 'prog-count');
      s.appendChild(txt('span', 'prog-count-num', String(num)));
      s.appendChild(txt('span', 'prog-count-label', label));
      return s;
    }
    counts.appendChild(stat(read, t('progress.chaptersRead')));
    counts.appendChild(stat(total - read, t('progress.chaptersLeft')));
    counts.appendChild(stat(booksFinished(p) + '/66', t('progress.booksFinished')));
    panel.appendChild(counts);

    // testament split
    var tHead = txt('h2', 'prog-subhead', t('progress.byTestament'));
    panel.appendChild(tHead);
    var ot = testamentTally(p, 0), nt = testamentTally(p, 1);
    panel.appendChild(progressBar(t('bible.oldTestament'), ot.read, ot.total));
    panel.appendChild(progressBar(t('bible.newTestament'), nt.read, nt.total));

    // section-by-section
    panel.appendChild(txt('h2', 'prog-subhead', t('progress.bySection')));
    PROGRESS_SECTIONS.forEach(function (sec) {
      var tally = sectionTally(p, sec.names);
      panel.appendChild(progressBar(t(sec.key), tally.read, tally.total));
    });

    // encouragement
    var note = txt('p', 'prog-note', pctR >= 100 ? t('progress.doneNote') : (read === 0 ? t('progress.startNote') : t('progress.keepNote', { left: total - read })));
    panel.appendChild(note);

    // set the fill to the true value (a short timeout lets the CSS transition
    // animate it in when the page is on screen; the value is correct either way)
    var valPath = dial.querySelector('.prog-dial-value');
    if (valPath) window.setTimeout(function () { valPath.style.strokeDashoffset = off; }, 60);
  }

  // wire the bell + streak chips (there's one pair in the sidebar, one in the topbar)
  document.querySelectorAll('.js-notif-open').forEach(function (btn) {
    btn.addEventListener('click', openNotif);
  });
  document.querySelectorAll('.js-streak-open').forEach(function (btn) {
    btn.addEventListener('click', function () { showView('home'); });
  });

  // theme toggle (Today header) + verse Save / Share
  document.querySelectorAll('[data-theme-choice]').forEach(function (btn) {
    btn.addEventListener('click', function () { applyTheme(btn.dataset.themeChoice); });
  });
  var saveBtn = document.getElementById('verse-save');
  if (saveBtn) saveBtn.addEventListener('click', toggleSaveVerse);
  var shareBtn = document.getElementById('verse-share');
  if (shareBtn) shareBtn.addEventListener('click', shareVerse);
  document.getElementById('notif-close').addEventListener('click', closeNotif);
  document.getElementById('notif-scrim').addEventListener('click', closeNotif);
  document.getElementById('notif-clear').addEventListener('click', function () {
    var p = loadProgress();
    p.notifs = [];
    saveProgress(p);
    renderNotifList();
    renderNotifUI();
  });

  /* ---------- push reminders (web push) ---------- */

  var swReg = null;

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (swReg) return Promise.resolve(swReg);
    return navigator.serviceWorker.register('sw.js').then(
      function (reg) { swReg = reg; return reg; },
      function () { return null; }
    );
  }

  // VAPID public key travels as base64url; PushManager wants a Uint8Array
  function urlB64ToBytes(base64) {
    var pad = '='.repeat((4 - base64.length % 4) % 4);
    var b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = window.atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function reminderStatus(msg, isError) {
    var el = document.getElementById('reminder-status');
    if (el) setStatus(el, msg, isError);
  }

  function initPush() {
    var box = document.getElementById('setting-daily-reminder');
    if (!box) return;
    if (!pushSupported() || typeof PUSH_VAPID_PUBLIC === 'undefined' || !PUSH_VAPID_PUBLIC) {
      box.disabled = true;
      reminderStatus(t('settings.reminderUnsupported'), false);
      return;
    }
    box.checked = !!settings.dailyReminder;
    // keep the service worker registered so notification taps are handled
    registerSW();
    box.addEventListener('change', function () {
      if (box.checked) enablePush();
      else disablePush();
    });
  }

  function enablePush() {
    reminderStatus(t('settings.reminderEnabling'), false);
    registerSW()
      .then(function (reg) {
        if (!reg) throw new Error('sw');
        return Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') throw new Error('perm');
          return reg.pushManager.getSubscription().then(function (existing) {
            return existing || reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlB64ToBytes(PUSH_VAPID_PUBLIC)
            });
          });
        });
      })
      .then(function (sub) {
        return request('push-subscribe', {
          subscription: sub.toJSON(),
          tzOffset: new Date().getTimezoneOffset(),
          hour: 8
        });
      })
      .then(function () {
        settings.dailyReminder = true;
        persistSettings();
        reminderStatus(t('settings.reminderOn'), false);
      })
      .catch(function (err) {
        var box = document.getElementById('setting-daily-reminder');
        if (box) box.checked = false;
        settings.dailyReminder = false;
        persistSettings();
        reminderStatus(err && err.message === 'perm' ? t('settings.reminderDenied') : t('settings.reminderFailed'), true);
      });
  }

  function disablePush() {
    settings.dailyReminder = false;
    persistSettings();
    reminderStatus(t('settings.reminderOff'), false);
    registerSW().then(function (reg) {
      if (!reg) return;
      return reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) return;
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () {
          return request('push-unsubscribe', { endpoint: endpoint }).catch(function () {});
        });
      });
    }).catch(function () {});
  }

  /* ---------- tool forms ---------- */

  // kept so a language change can relabel buttons that aren't mid-request
  var wiredForms = [];

  function wireForm(options) {
    var form = document.getElementById(options.formId);
    var result = document.getElementById(options.resultId);
    var status = document.getElementById(options.statusId);
    var button = form.querySelector('button[type="submit"]');
    var busy = false;

    wiredForms.push({
      relabel: function () {
        if (!busy) button.textContent = t(options.submitKey);
      }
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var payload = options.collect();
      if (!payload) return;

      busy = true;
      button.disabled = true;
      button.textContent = t(options.busyKey);
      setStatus(status, t(options.busyStatusKey), false);

      request(options.path, payload)
        .then(function (data) {
          options.render(data, result);
          result.hidden = false;
          setStatus(status, '', false);
        })
        .catch(function (err) {
          result.hidden = true;
          setStatus(status, err.message, true);
        })
        .then(function () {
          busy = false;
          button.disabled = false;
          button.textContent = t(options.submitKey);
        });
    });
  }

  // a form whose only input is one text field — the common shape
  function textField(inputId, field) {
    return function () {
      var value = document.getElementById(inputId).value.trim();
      if (!value) return null;
      var payload = {};
      payload[field] = value;
      return payload;
    };
  }

  function retranslateForms() {
    wiredForms.forEach(function (entry) {
      entry.relabel();
    });
  }

  wireForm({
    formId: 'search-form',
    resultId: 'search-result',
    statusId: 'search-status',
    path: 'search-scripture',
    submitKey: 'search.submit',
    busyKey: 'search.busy',
    busyStatusKey: 'search.busyStatus',
    collect: textField('search-query', 'query'),
    render: function (data) {
      document.getElementById('search-text').textContent = (data.text || '').trim();
      document.getElementById('search-ref').textContent = data.reference || '';
    }
  });

  /* As you type in Search scripture, offer matching books of the Bible so a book
     name jumps you straight into the reader instead of a passage lookup. */
  (function wireSearchBookSuggestions() {
    var input = document.getElementById('search-query');
    var results = document.getElementById('search-book-results');
    if (!input || !results) return;
    input.addEventListener('input', function () {
      renderBookSuggestions(results, input.value, function (name) {
        results.hidden = true;
        openBookChapters(name);
      }, t('search.openBook'));
    });

    /* If the whole query is just a book name (no chapter/verse numbers), Enter
       opens that book instead of running a passage lookup that would miss.
       Captured on document so it runs before the form's own submit handler. */
    document.addEventListener('submit', function (e) {
      if (!e.target || e.target.id !== 'search-form') return;
      var q = input.value.trim();
      if (!q || /\d/.test(q)) return;
      var best = matchBooks(q, 1)[0];
      if (best && best.book.name.toLowerCase() === q.toLowerCase()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        results.hidden = true;
        openBookChapters(best.book.name);
      }
    }, true);
  })();

  /* Search by word or topic. The app doesn't bundle the whole Bible locally and
     the licensed API key is server-side, so this runs against bolls.life's
     keyless, CORS-open search over the World English Bible (public domain, the
     same host the interlinear already uses). bolls numbers the Protestant canon
     1-66 (Genesis..Revelation) with apocrypha at 67+, so we filter to <=66 and
     name each hit from BIBLE_BOOKS. Every result opens in the reader. */
  (function wireVerseWordSearch() {
    var form = document.getElementById('verse-search-form');
    var input = document.getElementById('verse-search-query');
    var results = document.getElementById('verse-search-results');
    var countEl = document.getElementById('verse-search-count');
    var statusEl = document.getElementById('verse-search-status');
    if (!form || !input) return;

    var CANON = [];
    BIBLE_BOOKS.forEach(function (g) { g.books.forEach(function (b) { CANON.push(b); }); });
    function canonName(n) { var b = CANON[n - 1]; return b ? b.name : null; }
    function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }

    var MAX = 40;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      results.hidden = true; results.textContent = '';
      countEl.hidden = true;
      setStatus(statusEl, t('search.wordBusy'), false);
      fetch('https://bolls.life/v2/find/WEB?search=' + encodeURIComponent(q) + '&limit=200&page=1')
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (j) {
          var arr = (j && j.results) || (Array.isArray(j) ? j : []);
          var canon = arr.filter(function (v) { return v.book >= 1 && v.book <= 66; });
          setStatus(statusEl, '', false);
          countEl.hidden = false;
          if (!canon.length) { countEl.textContent = t('search.wordNone', { q: q }); return; }
          countEl.textContent = t('search.wordCount', { n: canon.length, q: q });
          results.textContent = '';
          canon.slice(0, MAX).forEach(function (v) {
            var name = canonName(v.book);
            if (!name) return;
            var card = el('button', 'verse-search-item');
            card.type = 'button';
            card.appendChild(txt('span', 'verse-search-ref', name + ' ' + v.chapter + ':' + v.verse));
            card.appendChild(txt('span', 'verse-search-text', stripTags(v.text)));
            card.addEventListener('click', function () { openReaderAt(name, v.chapter); });
            results.appendChild(card);
          });
          if (canon.length > MAX) results.appendChild(txt('p', 'verse-search-more', t('search.wordMore', { n: MAX })));
          results.hidden = false;
        })
        .catch(function () { setStatus(statusEl, t('search.wordError'), true); });
    });
  })();

  wireForm({
    formId: 'devotional-form',
    resultId: 'devotional-result',
    statusId: 'devotional-status',
    path: 'generate-devotional',
    submitKey: 'devotional.submit',
    busyKey: 'devotional.busy',
    busyStatusKey: 'devotional.busyStatus',
    // send the topic plus the length the reader picked in the view
    collect: function () {
      var topic = document.getElementById('devotional-topic').value.trim();
      if (!topic) return null;
      return { topic: topic, length: settings.devotionalLength || 'medium' };
    },
    render: function (data, result) {
      var text = cleanAIText((data.devotional || '').trim());
      result.textContent = text;
      // remember it so it can be saved, and reveal the Save button
      var topic = document.getElementById('devotional-topic').value.trim();
      lastAiDevotional = { title: topic || t('devotional.untitled'), body: text };
      var saveBtn = document.getElementById('devotional-save');
      if (saveBtn) { saveBtn.hidden = false; saveBtn.disabled = false; saveBtn.textContent = t('devotional.save'); }
    }
  });

  /* ---- personal devotionals: save AI ones and write your own ---- */
  var MY_DEVO_KEY = 'tgp.myDevotionals';
  var lastAiDevotional = null;
  function loadMyDevos() {
    try { var a = JSON.parse(window.localStorage.getItem(MY_DEVO_KEY)); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveMyDevos(list) {
    try { window.localStorage.setItem(MY_DEVO_KEY, JSON.stringify(list)); } catch (e) { /* view-only */ }
  }
  function addMyDevo(devo) {
    var list = loadMyDevos();
    list.unshift({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      title: devo.title, body: devo.body, source: devo.source, ts: Date.now() });
    if (list.length > 200) list = list.slice(0, 200);
    saveMyDevos(list);
    renderMyDevotionals();
  }
  function deleteMyDevo(id) {
    saveMyDevos(loadMyDevos().filter(function (d) { return d.id !== id; }));
    renderMyDevotionals();
  }
  function renderMyDevotionals() {
    var wrap = document.getElementById('devotional-mine');
    if (!wrap) return;
    wrap.textContent = '';
    var list = loadMyDevos();
    if (!list.length) { wrap.appendChild(txt('p', 'devo-mine-empty', t('devotional.mineEmpty'))); return; }
    list.forEach(function (d) {
      var det = el('details', 'devo-saved');
      var sum = el('summary', 'devo-saved-head');
      sum.appendChild(txt('span', 'devo-saved-title', d.title));
      sum.appendChild(txt('span', 'devo-saved-tag', t(d.source === 'own' ? 'devotional.tagOwn' : 'devotional.tagAi')));
      det.appendChild(sum);
      var body = el('div', 'devo-saved-body');
      body.appendChild(txt('div', 'prose devo-saved-text', d.body));
      var del = txt('button', 'devo-saved-delete', t('devotional.delete'));
      del.type = 'button';
      del.addEventListener('click', function () {
        if (window.confirm(t('devotional.deleteConfirm'))) deleteMyDevo(d.id);
      });
      body.appendChild(del);
      det.appendChild(body);
      wrap.appendChild(det);
    });
  }
  (function wireDevotionalSaves() {
    var saveBtn = document.getElementById('devotional-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (!lastAiDevotional) return;
        addMyDevo({ title: lastAiDevotional.title, body: lastAiDevotional.body, source: 'ai' });
        saveBtn.disabled = true;
        saveBtn.textContent = t('devotional.saved');
      });
    }
    var ownForm = document.getElementById('devotional-own-form');
    if (ownForm) {
      ownForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var title = document.getElementById('devo-own-title').value.trim();
        var bodyEl = document.getElementById('devo-own-body');
        var body = bodyEl.value.trim();
        if (!title || !body) return;
        addMyDevo({ title: title, body: body, source: 'own' });
        document.getElementById('devo-own-title').value = '';
        bodyEl.value = '';
      });
    }
  })();

  /* Devotional length chooser: the chips in the view mirror (and update) the
     saved "Length" setting, so a quick pick here sticks for next time too. */
  (function wireDevoLength() {
    var chips = Array.prototype.slice.call(document.querySelectorAll('[data-devo-length]'));
    if (!chips.length) return;
    function paint() {
      var current = settings.devotionalLength || 'medium';
      chips.forEach(function (chip) {
        var on = chip.getAttribute('data-devo-length') === current;
        chip.classList.toggle('is-active', on);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        settings.devotionalLength = chip.getAttribute('data-devo-length');
        persistSettings();
        var sel = document.getElementById('setting-devotional-length');
        if (sel) sel.value = settings.devotionalLength; // keep Settings in step
        paint();
      });
    });
    paint();
    devoLengthPaint = paint; // let the settings screen re-sync the chips
  })();

  wireForm({
    formId: 'apologetics-form',
    resultId: 'apologetics-result',
    statusId: 'apologetics-status',
    // the webhook path stays as it was so the live workflow keeps working
    path: 'evangelism-prep',
    submitKey: 'apologetics.submit',
    busyKey: 'apologetics.busy',
    busyStatusKey: 'apologetics.busyStatus',
    collect: textField('apologetics-scenario', 'scenario'),
    render: function (data, result) {
      result.textContent = cleanAIText((data.prep || '').trim());
    }
  });

  /* ---------- cross-references ----------
     Enter a verse; reuse the verse-context endpoint (which already returns
     crossRefs) and show just the linked references. */
  (function wireCrossref() {
    var form = document.getElementById('crossref-form');
    if (!form) return;
    var input = document.getElementById('crossref-query');
    var result = document.getElementById('crossref-result');
    var forEl = document.getElementById('crossref-for');
    var list = document.getElementById('crossref-list');
    var status = document.getElementById('crossref-status');
    var btn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      var loc = parseRef(q);
      if (!loc) { result.hidden = true; setStatus(status, t('crossref.badRef'), true); return; }
      btn.disabled = true; btn.textContent = t('crossref.busy');
      setStatus(status, t('crossref.busyStatus'), false);
      requestCached('verse-context', { book: loc.book, chapter: loc.chapter, verse: loc.verse, version: currentVersion() })
        .then(function (data) {
          list.textContent = '';
          var node = buildCrossRefsWithText((data && data.crossRefs) || []);
          forEl.textContent = t('crossref.for', { ref: loc.book + ' ' + loc.chapter + ':' + loc.verse });
          if (node) { list.appendChild(node); result.hidden = false; setStatus(status, '', false); }
          else { result.hidden = true; setStatus(status, t('crossref.none'), false); }
        })
        .catch(function (err) { result.hidden = true; setStatus(status, err.message, true); })
        .then(function () { btn.disabled = false; btn.textContent = t('crossref.submit'); });
    });
  })();

  /* Build a reference from dropdowns: testament › book › chapter › verse.
     Each choice fills the one below it; the final verse choice writes the
     reference into the lookup box (and, when a verse is picked, runs it).
     Verse numbers are exact when the chapter loads; otherwise a safe range. */
  (function wireCrossrefBuilder() {
    var tSel = document.getElementById('xref-testament');
    if (!tSel) return;
    var bSel = document.getElementById('xref-book');
    var cSel = document.getElementById('xref-chapter');
    var vSel = document.getElementById('xref-verse');
    var input = document.getElementById('crossref-query');
    var form = document.getElementById('crossref-form');

    function opt(sel, value, label, disabled) {
      var o = document.createElement('option');
      o.value = value; o.textContent = label;
      if (disabled) { o.disabled = true; o.selected = true; }
      sel.appendChild(o);
    }
    function reset(sel, placeholderKey) {
      sel.textContent = '';
      opt(sel, '', t(placeholderKey), true);
      sel.disabled = true;
    }
    function fillTestaments() {
      tSel.textContent = '';
      opt(tSel, '', t('crossref.pickTestamentPh'), true);
      BIBLE_BOOKS.forEach(function (g, i) { opt(tSel, String(i), t(g.testamentKey)); });
    }
    function fillBooks(ti) {
      bSel.textContent = '';
      opt(bSel, '', t('crossref.pickBookPh'), true);
      BIBLE_BOOKS[ti].books.forEach(function (b) { opt(bSel, b.name, b.name); });
      bSel.disabled = false;
    }
    function fillChapters(book) {
      cSel.textContent = '';
      opt(cSel, '', t('crossref.pickChapterPh'), true);
      for (var c = 1; c <= book.chapters; c++) opt(cSel, String(c), String(c));
      cSel.disabled = false;
    }
    function fillVerses(count) {
      vSel.textContent = '';
      opt(vSel, '', t('crossref.pickVersePh'), true);
      for (var v = 1; v <= count; v++) opt(vSel, String(v), String(v));
      vSel.disabled = false;
    }
    function updateInput() {
      if (!bSel.value || !cSel.value) return;
      var ref = bSel.value + ' ' + cSel.value + (vSel.value ? ':' + vSel.value : '');
      input.value = ref;
    }

    reset(bSel, 'crossref.pickBookPh');
    reset(cSel, 'crossref.pickChapterPh');
    reset(vSel, 'crossref.pickVersePh');
    fillTestaments();

    tSel.addEventListener('change', function () {
      if (tSel.value === '') return;
      fillBooks(parseInt(tSel.value, 10));
      reset(cSel, 'crossref.pickChapterPh');
      reset(vSel, 'crossref.pickVersePh');
    });
    bSel.addEventListener('change', function () {
      var found = findBook(bSel.value);
      if (!found) return;
      fillChapters(found.book);
      reset(vSel, 'crossref.pickVersePh');
      updateInput();
    });
    cSel.addEventListener('change', function () {
      if (!cSel.value) return;
      updateInput();
      fillVerses(80); // a safe range until the exact count loads
      // refine to the chapter's real verse count when it's available
      requestCached('bible-chapter', { book: bSel.value, chapter: parseInt(cSel.value, 10), version: currentVersion() })
        .then(function (data) {
          var verses = extractVerses(data);
          if (verses.length) fillVerses(verses[verses.length - 1].number || verses.length);
        })
        .catch(function () { /* keep the safe range */ });
    });
    vSel.addEventListener('change', function () {
      if (!vSel.value) return;
      updateInput();
      // a full reference is ready — run the lookup
      if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
  })();

  /* ---------- definitions ---------- */
  wireForm({
    formId: 'definitions-form',
    resultId: 'definitions-result',
    statusId: 'definitions-status',
    path: 'define-term',
    submitKey: 'definitions.submit',
    busyKey: 'definitions.busy',
    busyStatusKey: 'definitions.busyStatus',
    collect: textField('definitions-term', 'term'),
    render: function (data, result) { result.textContent = cleanAIText((data.definition || '').trim()); }
  });

  /* The A–Z browser is split into four groups the reader can pick between:
     People, Places & Maps, Historical Items, and Vocabulary. Each term still
     opens the same "define-term" lookup. Custom (admin) entries are merged into
     their chosen group. */
  /* The preloaded term catalog was cleared on 2026-08-15 so the owner can
     populate the Definitions tab entirely from the Admin view, in their own
     order. The four groups are kept as empty buckets so admin-published
     definitions still sort into People / Places / Items / Vocabulary. (The old
     ~230-term list lives in git history if it's ever wanted back.) */
  var TERM_CATEGORIES = [
    { key: 'people', labelKey: 'definitions.catPeople', terms: [] },
    { key: 'places', labelKey: 'definitions.catPlaces', terms: [] },
    { key: 'items', labelKey: 'definitions.catItems', terms: [] },
    { key: 'actions', labelKey: 'definitions.catActions', terms: [] },
    { key: 'vocab', labelKey: 'definitions.catVocab', terms: [] },
    { key: 'books', labelKey: 'definitions.catBooks', terms: [] }
  ];
  var CATEGORY_KEYS = TERM_CATEGORIES.map(function (c) { return c.key; });
  function byName(a, b) { return a.localeCompare(b); }

  /* Custom definitions the owner adds (admin panel). Stored on the device and
     merged into the A-Z list; a term with a stored definition opens instantly
     without calling the backend. */
  var CUSTOM_DEFS_KEY = 'tgp.customDefinitions';
  function loadCustomDefs() {
    try { var a = JSON.parse(window.localStorage.getItem(CUSTOM_DEFS_KEY)); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveCustomDefs(a) {
    try { window.localStorage.setItem(CUSTOM_DEFS_KEY, JSON.stringify(a)); } catch (e) { /* view-only */ }
  }
  // photos are stored as an array of image URLs; accept an array or newline text
  function normPhotos(v) {
    var arr = Array.isArray(v) ? v : String(v || '').split('\n');
    return arr.map(function (s) { return String(s).trim(); }).filter(Boolean);
  }

  // returns the full stored record (term, cat, def, pron, meaning, photos, genealogy) or null
  function customDefFor(term) {
    var key = String(term).toLowerCase();
    var found = allCustomDefs().filter(function (d) { return d.term.toLowerCase() === key; });
    return found.length ? found[found.length - 1] : null;
  }

  /* Render a structured custom/global definition into a container: an optional
     pronunciation and meaning line, the definition body, and — for People
     entries — a family & first-appearance block. */
  function renderDefinitionInto(container, rec) {
    container.textContent = '';
    if (rec.pron && rec.pron.trim()) {
      var pr = el('p', 'def-pron');
      pr.appendChild(txt('span', 'def-section-label', t('definitions.pronLabel')));
      pr.appendChild(txt('span', 'def-pron-text', cleanAIText(rec.pron.trim())));
      container.appendChild(pr);
    }
    if (rec.meaning && rec.meaning.trim()) {
      var mn = el('p', 'def-meaning');
      mn.appendChild(txt('span', 'def-section-label', t('definitions.meaningLabel')));
      mn.appendChild(txt('span', 'def-meaning-text', cleanAIText(rec.meaning.trim())));
      container.appendChild(mn);
    }
    var photos = normPhotos(rec.photos);
    if (photos.length) {
      var gal = el('div', 'def-photos');
      var grid = el('div', 'def-photos-grid');
      photos.forEach(function (src) {
        var fig = el('figure', 'def-photo');
        var img = el('img', 'def-photo-img');
        img.src = src; img.alt = rec.term || ''; img.loading = 'lazy';
        img.addEventListener('error', function () { fig.remove(); });
        fig.appendChild(img);
        grid.appendChild(fig);
      });
      gal.appendChild(grid);
      container.appendChild(gal);
    }
    if (rec.def && rec.def.trim()) {
      var body = el('div', 'def-body');
      cleanAIText(rec.def.trim()).split(/\n{2,}/).forEach(function (para) {
        var p = para.trim();
        if (p) body.appendChild(txt('p', null, p));
      });
      container.appendChild(body);
    }
    if (rec.cat === 'people') {
      // the last field of each row says whether its value names people (and so
      // should become clickable links to those people's own definitions)
      var rows = [
        ['definitions.firstAppLabel', rec.firstApp, false],
        ['definitions.fatherLabel', rec.father, true],
        ['definitions.motherLabel', rec.mother, true],
        ['definitions.siblingsLabel', rec.siblings, true],
        ['definitions.childrenLabel', rec.children, true]
      ].filter(function (r) { return r[1] && String(r[1]).trim(); });
      if (rows.length) {
        var gen = el('div', 'def-genealogy');
        gen.appendChild(txt('h4', 'def-gen-head', t('definitions.genealogyHeading')));
        var dl = el('dl', 'def-gen-list');
        rows.forEach(function (r) {
          dl.appendChild(txt('dt', 'def-gen-term', t(r[0])));
          var dd = el('dd', 'def-gen-desc');
          if (r[2]) fillPeopleLinks(dd, String(r[1]).trim());
          else dd.textContent = cleanAIText(String(r[1]).trim());
          dl.appendChild(dd);
        });
        gen.appendChild(dl);
        container.appendChild(gen);
      }
    }
    if (rec.cat === 'books' && rec.author && String(rec.author).trim()) {
      var auth = el('div', 'def-authorship');
      auth.appendChild(txt('h4', 'def-authorship-head', t('definitions.authorshipHeading')));
      var adl = el('dl', 'def-gen-list');
      adl.appendChild(txt('dt', 'def-gen-term', t('definitions.authorLabel')));
      adl.appendChild(txt('dd', 'def-gen-desc', cleanAIText(String(rec.author).trim())));
      auth.appendChild(adl);
      container.appendChild(auth);
    }
  }

  /* Family names in a People entry become buttons: tapping one opens that
     person's own definition. A value can list several people, so it's split on
     commas / semicolons / slashes / "and" / "&"; words that aren't names
     (Unknown, None, …) stay plain text. */
  var NON_NAME_WORDS = {
    'unknown': 1, 'none': 1, 'n/a': 1, 'na': 1, 'unnamed': 1,
    'not named': 1, 'various': 1, 'several': 1
  };
  function fillPeopleLinks(dd, value) {
    var clean = cleanAIText(value);
    var parts = clean.split(/\s*(?:,|;|\/|&|\band\b)\s*/i)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    if (!parts.length) { dd.textContent = clean; return; }
    parts.forEach(function (name, i) {
      if (i) dd.appendChild(document.createTextNode(', '));
      if (NON_NAME_WORDS[name.toLowerCase()]) {
        dd.appendChild(document.createTextNode(name));
        return;
      }
      // the lookup drops any parenthetical aside, e.g. "Isaac (his son)"
      var term = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim() || name;
      var link = txt('button', 'def-gen-link', name);
      link.type = 'button';
      link.title = t('definitions.lookupPerson', { name: term });
      link.addEventListener('click', function () { submitDefinition(term); });
      dd.appendChild(link);
    });
  }
  // the term list per group: built-in terms plus any custom ones the owner added
  // to that group (custom entries with an unknown/old group fall under Vocabulary)
  function categorizedTerms() {
    var byCat = {};
    TERM_CATEGORIES.forEach(function (c) { byCat[c.key] = c.terms.slice(); });
    allCustomDefs().forEach(function (d) {
      var cat = (d.cat && byCat[d.cat]) ? d.cat : 'vocab';
      var exists = byCat[cat].some(function (t0) { return t0.toLowerCase() === d.term.toLowerCase(); });
      if (!exists) byCat[cat].push(d.term);
    });
    return TERM_CATEGORIES.map(function (c) {
      return { key: c.key, label: t(c.labelKey), terms: byCat[c.key].slice().sort(byName) };
    });
  }

  function submitDefinition(term) {
    var input = document.getElementById('definitions-term');
    input.value = term;
    // a custom (owner-written) definition is shown straight away, no backend call
    var custom = customDefFor(term);
    if (custom) {
      var result = document.getElementById('definitions-result');
      var status = document.getElementById('definitions-status');
      renderDefinitionInto(result, custom);
      result.hidden = false;
      if (status) setStatus(status, '', false);
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    document.getElementById('definitions-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }

  // A-Z browser: a group dropdown (People / Places & Maps / Historical Items /
  // Vocabulary) and a letter dropdown, over per-group A-Z chip sections.
  function renderCommonTerms() {
    var wrap = document.getElementById('definitions-common');
    if (!wrap) return;
    wrap.textContent = '';
    wrap.appendChild(txt('p', 'definitions-common-label', t('definitions.commonHeading')));

    var cats = categorizedTerms();

    // two dropdowns: which group, and which letter within it
    var picker = el('div', 'definitions-picker');

    var catSel = el('select', 'definitions-select');
    catSel.setAttribute('aria-label', t('definitions.pickCategory'));
    var allCat = el('option'); allCat.value = ''; allCat.textContent = t('definitions.allCategories'); catSel.appendChild(allCat);
    cats.forEach(function (c) {
      var o = el('option'); o.value = c.key; o.textContent = c.label; catSel.appendChild(o);
    });
    picker.appendChild(catSel);

    var letterSel = el('select', 'definitions-select');
    letterSel.setAttribute('aria-label', t('definitions.pickLetter'));
    var allL = el('option'); allL.value = ''; allL.textContent = t('definitions.allLetters'); letterSel.appendChild(allL);
    var lettersSet = {};
    cats.forEach(function (c) {
      c.terms.forEach(function (term) {
        var ch = term.charAt(0).toUpperCase();
        if (!/[A-Z]/.test(ch)) ch = '#';
        lettersSet[ch] = 1;
      });
    });
    Object.keys(lettersSet).sort().forEach(function (L) {
      var o = el('option'); o.value = L; o.textContent = L; letterSel.appendChild(o);
    });
    picker.appendChild(letterSel);
    wrap.appendChild(picker);

    // one section per group, each holding A-Z letter subgroups of chips
    var groupsWrap = el('div', 'definitions-groups');
    cats.forEach(function (c) {
      var catSec = el('div', 'definitions-category');
      catSec.dataset.cat = c.key;
      catSec.appendChild(txt('h3', 'definitions-cat-head', c.label));

      var groups = {}, letters = [];
      c.terms.forEach(function (term) {
        var ch = term.charAt(0).toUpperCase();
        if (!/[A-Z]/.test(ch)) ch = '#';
        if (!groups[ch]) { groups[ch] = []; letters.push(ch); }
        groups[ch].push(term);
      });
      letters.sort();

      if (!letters.length) {
        catSec.appendChild(txt('p', 'definitions-cat-empty', t('definitions.catEmpty')));
      }
      letters.forEach(function (L) {
        var sec = el('div', 'definitions-letter-group');
        sec.dataset.letter = L;
        sec.dataset.cat = c.key;
        sec.appendChild(txt('h4', 'definitions-letter-head', L));
        var row = el('div', 'definitions-chips');
        groups[L].forEach(function (term) {
          var b = txt('button', 'definitions-chip', term);
          b.type = 'button';
          if (customDefFor(term)) b.classList.add('is-custom');
          b.addEventListener('click', function () { submitDefinition(term); });
          row.appendChild(b);
        });
        sec.appendChild(row);
        catSec.appendChild(sec);
      });
      groupsWrap.appendChild(catSec);
    });
    wrap.appendChild(groupsWrap);

    // apply both dropdowns together; hide a group entirely if nothing shows
    function applyFilter() {
      var pc = catSel.value, pl = letterSel.value;
      groupsWrap.querySelectorAll('.definitions-category').forEach(function (cs) {
        var catMatch = !pc || cs.dataset.cat === pc;
        var anyVisible = false;
        cs.querySelectorAll('.definitions-letter-group').forEach(function (g) {
          var show = catMatch && (!pl || g.dataset.letter === pl);
          g.hidden = !show;
          if (show) anyVisible = true;
        });
        cs.hidden = !catMatch || !anyVisible;
      });
    }
    catSel.addEventListener('change', applyFilter);
    letterSel.addEventListener('change', applyFilter);
    applyFilter();
  }

  // the display label for a group key (falls back to Vocabulary)
  function categoryLabel(key) {
    var c = TERM_CATEGORIES.filter(function (x) { return x.key === key; })[0];
    if (!c) c = TERM_CATEGORIES[TERM_CATEGORIES.length - 1];
    return t(c.labelKey);
  }

  /* set by wireDefAdmin so the list's Edit buttons can load a record back into
     the form for editing */
  var fillDefAdminForm = null;

  /* admin panel: add / edit / remove your own definitions */
  function renderDefAdmin() {
    var list = document.getElementById('def-admin-list');
    if (!list) return;
    var defs = loadCustomDefs();
    list.textContent = '';
    if (!defs.length) {
      list.appendChild(txt('p', 'def-admin-empty', t('definitions.adminEmpty')));
      return;
    }
    defs.slice().reverse().forEach(function (d, ri) {
      var idx = defs.length - 1 - ri; // real index in the stored array
      var card = el('div', 'def-admin-item');
      var head = el('div', 'def-admin-item-head');
      head.appendChild(txt('span', 'def-admin-term-name', d.term));
      head.appendChild(txt('span', 'def-admin-term-cat', categoryLabel((d.cat && CATEGORY_KEYS.indexOf(d.cat) >= 0) ? d.cat : 'vocab')));
      card.appendChild(head);
      if (d.meaning && d.meaning.trim()) card.appendChild(txt('p', 'def-admin-def-meaning', d.meaning));
      card.appendChild(txt('p', 'def-admin-def-text', d.def || ''));
      var nPhotos = normPhotos(d.photos).length;
      if (nPhotos) card.appendChild(txt('p', 'def-admin-def-photos', '📷 ' + nPhotos));
      var actions = el('div', 'def-admin-item-actions');
      var edit = txt('button', 'def-admin-edit', t('definitions.adminEdit'));
      edit.type = 'button';
      edit.addEventListener('click', function () { if (fillDefAdminForm) fillDefAdminForm(d); });
      actions.appendChild(edit);
      var del = txt('button', 'def-admin-del', t('definitions.adminDelete'));
      del.type = 'button';
      del.addEventListener('click', function () {
        var cur = loadCustomDefs();
        cur.splice(idx, 1);
        saveCustomDefs(cur);
        renderDefAdmin();
        renderCommonTerms(); // refresh the A-Z list
      });
      actions.appendChild(del);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  (function wireDefAdmin() {
    var form = document.getElementById('def-admin-form');
    if (!form) return;
    var term = document.getElementById('def-admin-term');
    var def = document.getElementById('def-admin-def');
    var cat = document.getElementById('def-admin-cat');
    var pron = document.getElementById('def-admin-pron');
    var meaning = document.getElementById('def-admin-meaning');
    var photos = document.getElementById('def-admin-photos');
    var people = document.getElementById('def-admin-people');
    var firstApp = document.getElementById('def-admin-firstapp');
    var father = document.getElementById('def-admin-father');
    var mother = document.getElementById('def-admin-mother');
    var siblings = document.getElementById('def-admin-siblings');
    var children = document.getElementById('def-admin-children');
    var books = document.getElementById('def-admin-books');
    var author = document.getElementById('def-admin-author');
    var status = document.getElementById('def-admin-status');
    // populate the group dropdown from the same category list the browser uses
    if (cat && !cat.dataset.built) {
      cat.dataset.built = '1';
      TERM_CATEGORIES.forEach(function (c) {
        var o = el('option'); o.value = c.key; o.textContent = t(c.labelKey);
        if (c.key === 'vocab') o.selected = true;
        cat.appendChild(o);
      });
    }
    // the family fields only make sense for People; the author field for Books
    function syncPeople() {
      if (people) people.hidden = (cat.value !== 'people');
      if (books) books.hidden = (cat.value !== 'books');
    }
    if (cat) cat.addEventListener('change', syncPeople);
    syncPeople();
    // load a stored record back into the form for editing (used by the list's Edit button)
    fillDefAdminForm = function (rec) {
      term.value = rec.term || ''; cat.value = (rec.cat && CATEGORY_KEYS.indexOf(rec.cat) >= 0) ? rec.cat : 'vocab';
      pron.value = rec.pron || ''; meaning.value = rec.meaning || ''; def.value = rec.def || '';
      photos.value = normPhotos(rec.photos).join('\n');
      firstApp.value = rec.firstApp || ''; father.value = rec.father || ''; mother.value = rec.mother || '';
      siblings.value = rec.siblings || ''; children.value = rec.children || '';
      author.value = rec.author || '';
      syncPeople();
      var det = document.getElementById('definitions-admin');
      if (det) det.open = true;
      term.focus();
      term.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var tVal = term.value.trim(), dVal = def.value.trim(), mVal = meaning.value.trim();
      var cVal = (cat && CATEGORY_KEYS.indexOf(cat.value) >= 0) ? cat.value : 'vocab';
      if (!tVal || (!dVal && !mVal)) return; // need a term and at least a meaning or definition
      var rec = { term: tVal, def: dVal, cat: cVal, pron: pron.value.trim(), meaning: mVal, photos: normPhotos(photos.value) };
      if (cVal === 'people') {
        rec.firstApp = firstApp.value.trim();
        rec.father = father.value.trim();
        rec.mother = mother.value.trim();
        rec.siblings = siblings.value.trim();
        rec.children = children.value.trim();
      }
      if (cVal === 'books') {
        rec.author = author.value.trim();
      }
      var defs = loadCustomDefs();
      // replace an existing entry with the same term, else add
      var lower = tVal.toLowerCase();
      var existing = -1;
      defs.forEach(function (d, i) { if (d.term.toLowerCase() === lower) existing = i; });
      if (existing >= 0) defs[existing] = rec;
      else defs.push(rec);
      saveCustomDefs(defs);
      [term, def, pron, meaning, photos, firstApp, father, mother, siblings, children, author].forEach(function (n) { if (n) n.value = ''; });
      setStatus(status, t('definitions.adminSaved', { term: tVal }), false);
      renderDefAdmin();
      renderCommonTerms();
    });
  })();

  /* ---------- admin view (owner-only, key-gated) ----------
     One screen to publish shared content to every visitor: definitions, maps,
     archaeology, and per-chapter questions. Everything routes through the
     admin-content workflow; writes carry the secret key entered below (kept on
     this device only). Reads elsewhere in the app are public. */
  function revealAdminNav() {
    var link = document.getElementById('nav-admin');
    if (link) link.hidden = !isAdminUnlocked();
  }

  function fieldRow(labelKey, control) {
    var wrap = el('label', 'admin-field');
    wrap.appendChild(txt('span', 'admin-field-label', t(labelKey)));
    wrap.appendChild(control);
    return wrap;
  }
  function textInput(phKey) {
    var i = el('input', 'admin-input'); i.type = 'text';
    if (phKey) i.placeholder = t(phKey);
    return i;
  }
  function areaInput(phKey, rows) {
    var a = el('textarea', 'admin-area'); a.rows = rows || 4;
    if (phKey) a.placeholder = t(phKey);
    return a;
  }

  // reuse an existing item's id for the same (type, scope) so re-publish overwrites
  function adminUpsertByScope(type, scope, fields) {
    return adminList(type, scope).then(function (items) {
      var norm = String(scope).toLowerCase().trim();
      var existing = items.filter(function (it) { return String(it.scope || '').toLowerCase().trim() === norm; })[0];
      var item = Object.assign({ type: type, scope: scope }, fields);
      if (existing && existing.id) item.id = existing.id;
      return adminWrite('upsert', item).then(function (r) { adminInvalidate(); return r; });
    });
  }

  function adminListInto(listEl, type, onPick) {
    listEl.textContent = '';
    listEl.appendChild(txt('p', 'admin-list-busy', t('admin.loading')));
    adminInvalidate();
    adminList(type).then(function (items) {
      listEl.textContent = '';
      if (!items.length) { listEl.appendChild(txt('p', 'admin-empty', t('admin.none'))); return; }
      // load a stored entry into this card's form, then bring the form into view
      function editItem(it) {
        if (!onPick) return;
        onPick(it);
        var card = listEl.closest('.admin-card');
        var target = card || listEl;
        if (target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      items.slice().reverse().forEach(function (it) {
        var row = el('div', 'admin-item');
        var main = el('button', 'admin-item-main'); main.type = 'button';
        var label = it.term || it.title || it.scope || '(untitled)';
        main.appendChild(txt('span', 'admin-item-name', label));
        var sub = [it.scope, it.group].filter(Boolean).join(' · ');
        if (it.type === 'faq' && Array.isArray(it.qa)) sub = it.scope + ' · ' + it.qa.length + ' Q&A';
        if (sub) main.appendChild(txt('span', 'admin-item-sub', sub));
        if (onPick) main.addEventListener('click', function () { editItem(it); });
        row.appendChild(main);
        if (onPick) {
          var edit = txt('button', 'admin-item-edit', t('admin.edit')); edit.type = 'button';
          edit.addEventListener('click', function () { editItem(it); });
          row.appendChild(edit);
        }
        var del = txt('button', 'admin-item-del', t('admin.delete')); del.type = 'button';
        del.addEventListener('click', function () {
          adminWrite('delete', { type: it.type, id: it.id }).then(function () {
            adminInvalidate(); adminListInto(listEl, type, onPick);
          });
        });
        row.appendChild(del);
        listEl.appendChild(row);
      });
    });
  }

  function adminCardShell(titleKey, hintKey) {
    var card = el('section', 'admin-card');
    card.appendChild(txt('h2', 'admin-card-title', t(titleKey)));
    if (hintKey) card.appendChild(txt('p', 'admin-card-hint', t(hintKey)));
    return card;
  }

  function buildDefinitionAdmin() {
    var card = adminCardShell('admin.defTitle', 'admin.defHint');
    var term = textInput('admin.defTermPh');
    var group = el('select', 'admin-input');
    TERM_CATEGORIES.forEach(function (c) {
      var o = el('option'); o.value = c.key; o.textContent = t(c.labelKey);
      if (c.key === 'vocab') o.selected = true; group.appendChild(o);
    });
    var pron = textInput('admin.defPronPh');
    var meaning = textInput('admin.defMeaningPh');
    var body = areaInput('admin.defDefPh', 5);
    var photos = areaInput('admin.defPhotosPh', 2);
    card.appendChild(fieldRow('admin.defTerm', term));
    card.appendChild(fieldRow('admin.group', group));
    card.appendChild(fieldRow('admin.defPron', pron));
    card.appendChild(fieldRow('admin.defMeaning', meaning));
    card.appendChild(fieldRow('admin.defDef', body));
    card.appendChild(fieldRow('admin.defPhotos', photos));

    // family & first-appearance fields, shown only for the People group
    var people = el('div', 'admin-people');
    people.appendChild(txt('p', 'admin-people-head', t('admin.defPeopleHeading')));
    var firstApp = textInput('admin.defFirstAppPh');
    var father = textInput('admin.defFatherPh');
    var mother = textInput('admin.defMotherPh');
    var siblings = textInput('admin.defSiblingsPh');
    var children = textInput('admin.defChildrenPh');
    people.appendChild(fieldRow('admin.defFirstApp', firstApp));
    people.appendChild(fieldRow('admin.defFather', father));
    people.appendChild(fieldRow('admin.defMother', mother));
    people.appendChild(fieldRow('admin.defSiblings', siblings));
    people.appendChild(fieldRow('admin.defChildren', children));
    card.appendChild(people);

    // authorship field, shown only for the Books of the Bible group
    var books = el('div', 'admin-people');
    books.appendChild(txt('p', 'admin-people-head', t('admin.defBooksHeading')));
    var author = textInput('admin.defAuthorPh');
    books.appendChild(fieldRow('admin.defAuthor', author));
    card.appendChild(books);

    function syncGroupFields() {
      people.hidden = (group.value !== 'people');
      books.hidden = (group.value !== 'books');
    }
    group.addEventListener('change', syncGroupFields);
    syncGroupFields();

    var status = txt('p', 'status', '');
    var list = el('div', 'admin-list');
    function loadInto(it) {
      term.value = it.term || ''; group.value = it.group || 'vocab';
      pron.value = it.pron || ''; meaning.value = it.meaning || ''; body.value = it.definition || '';
      photos.value = normPhotos(it.photos).join('\n');
      firstApp.value = it.firstApp || ''; father.value = it.father || ''; mother.value = it.mother || '';
      siblings.value = it.siblings || ''; children.value = it.children || '';
      author.value = it.author || '';
      syncGroupFields();
    }
    var save = txt('button', 'admin-save', t('admin.publish')); save.type = 'button';
    save.addEventListener('click', function () {
      var tv = term.value.trim(), dv = body.value.trim(), mv = meaning.value.trim();
      if (!tv || (!dv && !mv)) { setStatus(status, t('admin.needTermDef'), true); return; }
      setStatus(status, t('admin.saving'), false);
      var fields = { term: tv, group: group.value, definition: dv, pron: pron.value.trim(), meaning: mv, photos: normPhotos(photos.value) };
      if (group.value === 'people') {
        fields.firstApp = firstApp.value.trim();
        fields.father = father.value.trim();
        fields.mother = mother.value.trim();
        fields.siblings = siblings.value.trim();
        fields.children = children.value.trim();
      }
      if (group.value === 'books') {
        fields.author = author.value.trim();
      }
      adminUpsertByScope('definition', tv, fields).then(function (r) {
        if (r && r.ok) {
          setStatus(status, t('admin.published', { name: tv }), false);
          loadInto({}); globalDefsLoaded = false;
          adminListInto(list, 'definition', loadInto);
        } else { setStatus(status, t('admin.failed'), true); }
      });
    });
    card.appendChild(save); card.appendChild(status);
    card.appendChild(txt('p', 'admin-list-hint', t('admin.editHint')));
    card.appendChild(list);
    adminListInto(list, 'definition', loadInto);
    return card;
  }

  function buildMapAdmin() {
    var card = adminCardShell('admin.mapTitle', 'admin.mapHint');
    var scope = textInput('admin.scopePh');
    var title = textInput('admin.mapTitlePh');
    var url = textInput('admin.imgUrlPh');
    var cap = textInput('admin.mapCapPh');
    card.appendChild(fieldRow('admin.scope', scope));
    card.appendChild(fieldRow('admin.mapName', title));
    card.appendChild(fieldRow('admin.imgUrl', url));
    card.appendChild(fieldRow('admin.mapCap', cap));
    var status = txt('p', 'status', '');
    var list = el('div', 'admin-list');
    var save = txt('button', 'admin-save', t('admin.publish')); save.type = 'button';
    save.addEventListener('click', function () {
      var sv = scope.value.trim();
      if (!sv || !url.value.trim()) { setStatus(status, t('admin.needScopeImg'), true); return; }
      setStatus(status, t('admin.saving'), false);
      adminWrite('upsert', { type: 'map', scope: sv, title: title.value.trim(), imageUrl: url.value.trim(), caption: cap.value.trim() }).then(function (r) {
        if (r && r.ok) {
          setStatus(status, t('admin.published', { name: title.value.trim() || sv }), false);
          title.value = ''; url.value = ''; cap.value = ''; adminInvalidate();
          adminListInto(list, 'map', function (it) { scope.value = it.scope || ''; title.value = it.title || ''; url.value = it.imageUrl || ''; cap.value = it.caption || ''; });
        } else { setStatus(status, t('admin.failed'), true); }
      });
    });
    card.appendChild(save); card.appendChild(status); card.appendChild(list);
    adminListInto(list, 'map', function (it) { scope.value = it.scope || ''; title.value = it.title || ''; url.value = it.imageUrl || ''; cap.value = it.caption || ''; });
    return card;
  }

  function buildArchAdmin() {
    var card = adminCardShell('admin.archTitle', 'admin.archHint');
    var scope = textInput('admin.scopePh');
    var title = textInput('admin.archNamePh');
    var url = textInput('admin.imgUrlOptPh');
    var desc = areaInput('admin.archDescPh', 5);
    card.appendChild(fieldRow('admin.scope', scope));
    card.appendChild(fieldRow('admin.archName', title));
    card.appendChild(fieldRow('admin.imgUrlOpt', url));
    card.appendChild(fieldRow('admin.archDesc', desc));
    var status = txt('p', 'status', '');
    var list = el('div', 'admin-list');
    var save = txt('button', 'admin-save', t('admin.publish')); save.type = 'button';
    save.addEventListener('click', function () {
      var sv = scope.value.trim();
      if (!sv || !desc.value.trim()) { setStatus(status, t('admin.needScopeDesc'), true); return; }
      setStatus(status, t('admin.saving'), false);
      adminWrite('upsert', { type: 'archaeology', scope: sv, title: title.value.trim(), imageUrl: url.value.trim(), description: desc.value.trim() }).then(function (r) {
        if (r && r.ok) {
          setStatus(status, t('admin.published', { name: title.value.trim() || sv }), false);
          title.value = ''; url.value = ''; desc.value = ''; adminInvalidate();
          adminListInto(list, 'archaeology', function (it) { scope.value = it.scope || ''; title.value = it.title || ''; url.value = it.imageUrl || ''; desc.value = it.description || ''; });
        } else { setStatus(status, t('admin.failed'), true); }
      });
    });
    card.appendChild(save); card.appendChild(status); card.appendChild(list);
    adminListInto(list, 'archaeology', function (it) { scope.value = it.scope || ''; title.value = it.title || ''; url.value = it.imageUrl || ''; desc.value = it.description || ''; });
    return card;
  }

  function buildFaqAdmin() {
    var card = adminCardShell('admin.faqTitle', 'admin.faqHint');
    var scope = textInput('admin.faqScopePh');
    card.appendChild(fieldRow('admin.faqScope', scope));
    var rows = el('div', 'admin-faq-rows');
    function addRow(q, a, v) {
      var row = el('div', 'admin-faq-row');
      var qi = textInput('admin.faqQPh'); qi.value = q || ''; qi.classList.add('admin-faq-q');
      var ai = areaInput('admin.faqAPh', 3); ai.value = a || ''; ai.classList.add('admin-faq-a');
      var vi = textInput('admin.faqVersePh'); vi.value = v || ''; vi.classList.add('admin-faq-v');
      var rm = txt('button', 'admin-faq-rm', '✕'); rm.type = 'button';
      rm.addEventListener('click', function () { rows.removeChild(row); });
      row.appendChild(qi); row.appendChild(ai); row.appendChild(vi); row.appendChild(rm);
      rows.appendChild(row);
    }
    var addBtn = txt('button', 'admin-faq-add', t('admin.faqAdd')); addBtn.type = 'button';
    addBtn.addEventListener('click', function () { addRow('', '', ''); });
    card.appendChild(rows); card.appendChild(addBtn);
    var status = txt('p', 'status', '');
    var list = el('div', 'admin-list');
    var save = txt('button', 'admin-save', t('admin.publishFaq')); save.type = 'button';
    save.addEventListener('click', function () {
      var sv = scope.value.trim();
      var qa = [];
      rows.querySelectorAll('.admin-faq-row').forEach(function (r) {
        var q = r.querySelector('.admin-faq-q').value.trim();
        var a = r.querySelector('.admin-faq-a').value.trim();
        var v = r.querySelector('.admin-faq-v').value.trim();
        if (q && a) qa.push({ q: q, a: a, verse: v });
      });
      if (!sv || !qa.length) { setStatus(status, t('admin.needScopeQa'), true); return; }
      setStatus(status, t('admin.saving'), false);
      adminUpsertByScope('faq', sv, { qa: qa }).then(function (r) {
        if (r && r.ok) {
          setStatus(status, t('admin.publishedFaq', { scope: sv, n: qa.length }), false);
          adminListInto(list, 'faq', function (it) { loadFaqIntoForm(it); });
        } else { setStatus(status, t('admin.failed'), true); }
      });
    });
    function loadFaqIntoForm(it) {
      scope.value = it.scope || '';
      rows.textContent = '';
      (it.qa || []).forEach(function (p) { addRow(p.q || p.question, p.a || p.answer, p.verse || p.reference || p.ref || p.passage); });
      if (!rows.children.length) addRow('', '', '');
    }
    addRow('', '', '');
    card.appendChild(save); card.appendChild(status); card.appendChild(list);
    adminListInto(list, 'faq', function (it) { loadFaqIntoForm(it); });
    return card;
  }

  function buildAdminUnlock() {
    var box = el('div', 'admin-unlock');
    box.appendChild(txt('p', 'admin-unlock-lede', t('admin.unlockLede')));
    var input = el('input', 'admin-input'); input.type = 'password'; input.placeholder = t('admin.keyPh');
    input.autocomplete = 'off';
    box.appendChild(fieldRow('admin.key', input));
    var status = txt('p', 'status', '');
    var btn = txt('button', 'admin-save', t('admin.unlock')); btn.type = 'button';
    function submit() {
      var v = input.value.trim();
      if (!v) return;
      setStatus(status, t('admin.checking'), false);
      // validate by attempting a harmless keyed no-op (bad_action) — unauthorized means wrong key
      request('admin-content', { action: 'validate', key: v, item: { type: 'definition' } }).then(function (r) {
        if (r && r.error === 'unauthorized') { setStatus(status, t('admin.badKey'), true); return; }
        setAdminKeyStored(v); revealAdminNav(); renderAdminView();
      }, function () { setStatus(status, t('admin.failed'), true); });
    }
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    box.appendChild(btn); box.appendChild(status);
    return box;
  }

  function buildAdminToolbar() {
    var bar = el('div', 'admin-toolbar');
    bar.appendChild(txt('span', 'admin-unlocked', t('admin.unlocked')));
    var lock = txt('button', 'admin-lock', t('admin.lock')); lock.type = 'button';
    lock.addEventListener('click', function () { setAdminKeyStored(''); revealAdminNav(); showView('home'); });
    bar.appendChild(lock);
    return bar;
  }

  /* Message everyone who has ever reported a problem: the store fans the note
     out to every reporter's device (in-app notification) and emails the ones
     who left an address. One composer, both channels. */
  function buildBroadcastAdmin() {
    var card = adminCardShell('admin.msgTitle', 'admin.msgHint');
    var title = textInput('admin.msgSubjectPh');
    var bodyEl = areaInput('admin.msgBodyPh', 5);
    card.appendChild(fieldRow('admin.msgSubject', title));
    card.appendChild(fieldRow('admin.msgBody', bodyEl));
    var status = txt('p', 'status', '');
    var send = txt('button', 'admin-save', t('admin.msgSend')); send.type = 'button';
    send.addEventListener('click', function () {
      var msg = bodyEl.value.trim();
      if (!msg) { setStatus(status, t('admin.msgNeedBody'), true); return; }
      if (!window.confirm(t('admin.msgConfirm'))) return;
      setStatus(status, t('admin.msgSending'), false);
      request('admin-content', {
        action: 'broadcast', key: adminKey(),
        title: title.value.trim(), message: msg
      }).then(function (r) {
        if (r && r.ok) {
          setStatus(status, t('admin.msgSent', { notified: r.notified || 0, emailed: r.emailed || 0 }), false);
          bodyEl.value = ''; title.value = '';
        } else if (r && r.error === 'unauthorized') {
          setStatus(status, t('admin.badKey'), true);
        } else {
          setStatus(status, t('admin.msgFailed'), true);
        }
      }, function () { setStatus(status, t('admin.msgFailed'), true); });
    });
    card.appendChild(send);
    card.appendChild(status);
    return card;
  }

  function renderAdminView() {
    var root = document.getElementById('admin-root');
    if (!root) return;
    root.textContent = '';
    if (!isAdminUnlocked()) { root.appendChild(buildAdminUnlock()); return; }
    revealAdminNav();
    root.appendChild(buildAdminToolbar());
    root.appendChild(buildBroadcastAdmin());
    root.appendChild(buildDefinitionAdmin());
    root.appendChild(buildMapAdmin());
    root.appendChild(buildArchAdmin());
    root.appendChild(buildFaqAdmin());
  }

  /* ---------- report a problem ----------
     A visitor-facing button that posts to the shared store; the owner gets a
     daily email digest via the Report Digest workflow. */
  function reportContext() {
    var view = document.querySelector('.view.is-active');
    var page = view ? view.id.replace(/^view-/, '') : '';
    var ctx = '';
    if (page === 'bible' && bibleState.book) {
      ctx = bibleState.book.name + ' ' + bibleState.chapter;
      if (bibleState.screen === 'verse') ctx += ':' + bibleState.verse;
      if (bibleState.showOriginal) ctx += ' (original)';
    }
    return { page: page, context: ctx };
  }
  (function wireReport() {
    var modal = document.getElementById('report-modal');
    var scrim = document.getElementById('report-scrim');
    var openBtn = document.getElementById('nav-report');
    var closeBtn = document.getElementById('report-close');
    var sendBtn = document.getElementById('report-send');
    var textEl = document.getElementById('report-text');
    var statusEl = document.getElementById('report-status');
    var ctxEl = document.getElementById('report-context');
    var nameFields = document.getElementById('report-name-fields');
    var firstEl = document.getElementById('report-first-name');
    var initialEl = document.getElementById('report-last-initial');
    var signedNote = document.getElementById('report-signedin');
    var thanksEl = document.getElementById('report-thanks');
    var thanksCloseBtn = document.getElementById('report-thanks-close');
    var copyChk = document.getElementById('report-copy');
    var copyEmailEl = document.getElementById('report-copy-email');
    if (!modal || !openBtn) return;

    // "email me a copy": reveal the address field when ticked, prefilling the
    // signed-in email as a convenience. Available to anonymous reporters too —
    // the address is used only to send the copy, never stored with the report.
    function syncCopy() {
      var on = !!(copyChk && copyChk.checked);
      if (copyEmailEl) {
        copyEmailEl.hidden = !on;
        if (on && !copyEmailEl.value) copyEmailEl.value = signedInEmail() || '';
        if (on) setTimeout(function () { copyEmailEl.focus(); }, 30);
      }
    }
    if (copyChk) copyChk.addEventListener('change', syncCopy);

    // the form's own parts, hidden while the thank-you message is showing
    var formParts = [
      modal.querySelector('.report-lede'), ctxEl, textEl,
      modal.querySelector('.report-identity'),
      modal.querySelector('.report-copy'), sendBtn, statusEl
    ];
    function showForm(show) {
      formParts.forEach(function (el) {
        if (!el) return;
        // the context line manages its own hidden state; don't force it visible
        if (show && el === ctxEl) return;
        el.hidden = !show;
      });
      if (thanksEl) thanksEl.hidden = show;
    }

    function identityChoice() {
      var picked = modal.querySelector('input[name="report-identity"]:checked');
      return picked ? picked.value : 'anon';
    }
    function syncIdentity() {
      var named = identityChoice() === 'named';
      if (nameFields) nameFields.hidden = !named;
      if (signedNote) signedNote.hidden = !(named && signedInEmail());
    }
    modal.querySelectorAll('input[name="report-identity"]').forEach(function (r) {
      r.addEventListener('change', syncIdentity);
    });

    function open() {
      var c = reportContext();
      if (ctxEl) {
        if (c.context) { ctxEl.textContent = t('report.on', { where: c.context }); ctxEl.hidden = false; }
        else ctxEl.hidden = true;
      }
      // default back to anonymous each open; prefill the name from the account
      var anon = modal.querySelector('input[name="report-identity"][value="anon"]');
      if (anon) anon.checked = true;
      var who = signedInName();
      if (firstEl && !firstEl.value) firstEl.value = who.first || '';
      if (initialEl && !initialEl.value) initialEl.value = (who.last || '').charAt(0).toUpperCase();
      syncIdentity();
      if (copyChk) copyChk.checked = false;
      syncCopy();
      setStatus(statusEl, '', false);
      showForm(true);           // reset to the form in case a thank-you is still showing
      modal.hidden = false; scrim.hidden = false;
      closeSidebar();
      setTimeout(function () { textEl.focus(); }, 50);
    }
    function close() { modal.hidden = true; scrim.hidden = true; }
    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    scrim.addEventListener('click', close);
    if (thanksCloseBtn) thanksCloseBtn.addEventListener('click', close);

    sendBtn.addEventListener('click', function () {
      var msg = textEl.value.trim();
      if (!msg) { setStatus(statusEl, t('report.needText'), true); return; }
      var c = reportContext();

      // Build the reporter's chosen credit + contact. "Anonymous" attaches
      // neither a name nor an email, so the report can't be traced back; "Add
      // my name" attaches "First L." and, when signed in, the account email so
      // we can reply. The device id always rides along (non-identifying) so
      // in-app broadcasts can still reach an anonymous reporter's feed.
      var named = identityChoice() === 'named';
      var reporterName = '', email = '';
      if (named) {
        var first = (firstEl && firstEl.value.trim()) || '';
        var initial = (initialEl && initialEl.value.trim()) || '';
        if (initial) initial = initial.charAt(0).toUpperCase() + '.';
        reporterName = (first + ' ' + initial).trim();
        email = signedInEmail();
      }

      // optional copy-to address (independent of anonymity); validate if ticked
      var copyEmail = '';
      if (copyChk && copyChk.checked) {
        copyEmail = (copyEmailEl && copyEmailEl.value.trim()) || '';
        if (copyEmail.indexOf('@') < 1 || copyEmail.indexOf('.') < 0) {
          setStatus(statusEl, t('report.needEmail'), true);
          if (copyEmailEl) copyEmailEl.focus();
          return;
        }
      }

      setStatus(statusEl, t('report.sending'), false);
      adminReport({
        message: msg, context: c.context, page: c.page,
        reporterName: reporterName, email: email, copyEmail: copyEmail, deviceId: deviceId(),
        diagnostics: errorDiagnostics()
      }).then(function (r) {
        if (r && r.ok) {
          textEl.value = '';
          // swap the form out for the full thank-you message; stays open until
          // the reader closes it, so there's time to read it through.
          setStatus(statusEl, '', false);
          showForm(false);
          if (thanksEl) thanksEl.scrollTop = 0;
          // also drop it into the in-app notification feed for later reference
          notify('report', t('notif.reportAck.title'), t('notif.reportAck.body'));
        } else { setStatus(statusEl, t('report.failed'), true); }
      }, function () { setStatus(statusEl, t('report.failed'), true); });
    });
  })();

  // pull any team messages waiting for this device shortly after load (a small
  // delay lets Clerk settle so a signed-in email is matched too), then again
  // whenever the tab is refocused.
  setTimeout(syncServerNotifs, 2500);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') syncServerNotifs();
  });

  // show the Admin nav link if this device is already unlocked; the first way in
  // (when locked) is the #admin address, which opens the key prompt.
  revealAdminNav();
  (function adminHash() {
    function check() { if (location.hash === '#admin') showView('admin'); }
    window.addEventListener('hashchange', check);
    check();
  })();

  /* ---------- whole-Bible timeline (curated) ----------
     A fixed, reliable overview from creation to the new creation. Dates are
     approximate; the earliest are debated. Each event links into the reader. */
  var BIBLE_TIMELINE = [
    { era: 'Beginnings', dates: 'Before recorded history', events: [
      { title: 'Creation of the heavens and the earth', ref: 'Genesis 1' },
      { title: 'The fall of humanity', ref: 'Genesis 3' },
      { title: 'Noah and the flood', ref: 'Genesis 7' },
      { title: 'The tower of Babel', ref: 'Genesis 11' }
    ]},
    { era: 'The Patriarchs', dates: 'c. 2100–1800 BC', events: [
      { title: 'God calls Abraham', ref: 'Genesis 12' },
      { title: 'The covenant with Abraham', ref: 'Genesis 15' },
      { title: 'Isaac, Jacob, and the twelve tribes', ref: 'Genesis 28' },
      { title: 'Joseph rises in Egypt', ref: 'Genesis 41' }
    ]},
    { era: 'Exodus & Wilderness', dates: 'c. 1446 or 1250 BC', events: [
      { title: 'Moses and the burning bush', ref: 'Exodus 3' },
      { title: 'The Passover and the Exodus from Egypt', ref: 'Exodus 12' },
      { title: 'The Ten Commandments at Sinai', ref: 'Exodus 20' },
      { title: 'Forty years in the wilderness', ref: 'Numbers 14' }
    ]},
    { era: 'Conquest & Judges', dates: 'c. 1400–1050 BC', events: [
      { title: 'Joshua leads Israel into Canaan', ref: 'Joshua 1' },
      { title: 'The fall of Jericho', ref: 'Joshua 6' },
      { title: 'The era of the judges', ref: 'Judges 2' },
      { title: 'Ruth and Boaz', ref: 'Ruth 1' }
    ]},
    { era: 'The United Kingdom', dates: 'c. 1050–930 BC', events: [
      { title: 'Saul, Israel’s first king', ref: '1 Samuel 10' },
      { title: 'David anointed king', ref: '1 Samuel 16' },
      { title: 'Solomon’s wisdom and reign', ref: '1 Kings 3' },
      { title: 'The temple in Jerusalem is built', ref: '1 Kings 6' }
    ]},
    { era: 'The Divided Kingdom', dates: '930–586 BC', events: [
      { title: 'The kingdom splits: Israel and Judah', ref: '1 Kings 12' },
      { title: 'Elijah confronts the prophets of Baal', ref: '1 Kings 18' },
      { title: 'Assyria destroys the northern kingdom (722 BC)', ref: '2 Kings 17' },
      { title: 'The prophets warn and comfort', ref: 'Isaiah 1' }
    ]},
    { era: 'Exile', dates: '586–538 BC', events: [
      { title: 'Babylon destroys Jerusalem and the temple', ref: '2 Kings 25' },
      { title: 'Daniel in Babylon', ref: 'Daniel 1' },
      { title: 'Ezekiel’s visions among the exiles', ref: 'Ezekiel 1' }
    ]},
    { era: 'Return & Restoration', dates: '538–430 BC', events: [
      { title: 'Cyrus lets the exiles return', ref: 'Ezra 1' },
      { title: 'The temple is rebuilt', ref: 'Ezra 6' },
      { title: 'Nehemiah rebuilds Jerusalem’s walls', ref: 'Nehemiah 2' },
      { title: 'Esther saves her people', ref: 'Esther 4' },
      { title: 'Malachi, the last Old Testament prophet', ref: 'Malachi 1' }
    ]},
    { era: 'Between the Testaments', dates: 'c. 430–5 BC', events: [
      { title: 'Roughly 400 years with no recorded prophet' },
      { title: 'Greek then Roman rule over Judea' },
      { title: 'The Maccabean revolt and rededicated temple' }
    ]},
    { era: 'The Life of Jesus', dates: 'c. 4 BC–30 AD', events: [
      { title: 'The birth of Jesus', ref: 'Luke 2' },
      { title: 'Jesus begins his ministry', ref: 'Mark 1' },
      { title: 'The Sermon on the Mount', ref: 'Matthew 5' },
      { title: 'The crucifixion', ref: 'Luke 23' },
      { title: 'The resurrection', ref: 'Luke 24' }
    ]},
    { era: 'The Early Church', dates: 'c. 30–95 AD', events: [
      { title: 'Pentecost and the birth of the church', ref: 'Acts 2' },
      { title: 'The gospel spreads beyond Jerusalem', ref: 'Acts 8' },
      { title: 'Paul’s missionary journeys and letters', ref: 'Acts 13' },
      { title: 'The gospel reaches Rome', ref: 'Acts 28' }
    ]},
    { era: 'The Consummation', dates: 'Still to come', events: [
      { title: 'The return of Christ and the final judgment', ref: 'Revelation 20' },
      { title: 'A new heaven and a new earth', ref: 'Revelation 21' }
    ]}
  ];

  function renderBibleTimeline() {
    var wrap = document.getElementById('timeline-eras');
    if (!wrap || wrap.dataset.built) return;
    wrap.dataset.built = '1';
    BIBLE_TIMELINE.forEach(function (era) {
      var card = el('div', 'tl-era');
      var head = el('div', 'tl-era-head');
      head.appendChild(txt('span', 'tl-era-name', era.era));
      head.appendChild(txt('span', 'tl-era-dates', era.dates));
      card.appendChild(head);
      var events = el('div', 'tl-era-events');
      era.events.forEach(function (ev) {
        var row = el('div', 'tl-era-event');
        row.appendChild(txt('span', 'tl-event-dot', ''));
        row.appendChild(txt('span', 'tl-event-title', ev.title));
        var loc = ev.ref ? parseRef(ev.ref) : null;
        if (loc) {
          var b = txt('button', 'tl-event-ref', ev.ref);
          b.type = 'button';
          b.addEventListener('click', function () { openReaderAt(loc.book, loc.chapter); });
          row.appendChild(b);
        }
        events.appendChild(row);
      });
      card.appendChild(events);
      wrap.appendChild(card);
    });
  }

  /* ---------- detailed dated timeline ----------
     Major milestones with approximate BC/AD dates, grouped into the classic
     redemptive-history periods and rendered as a single vertical timeline with
     period bands. Each event links into the reader. Dates and the parallel
     `world` context follow a standard study-Bible chronology ("A Chronology of
     the Bible"); the earliest dates are debated. */
  var DETAILED_TIMELINE = [
    { era: 'Creation & the Early World', events: [
      { date: 'In the beginning', title: 'God creates the heavens and the earth', ref: 'Genesis 1' },
      { date: 'The beginning', title: 'Adam and Eve in the garden', ref: 'Genesis 2' },
      { date: 'The beginning', title: 'The fall of man', ref: 'Genesis 3' },
      { date: 'Early world', title: 'Cain and Abel', ref: 'Genesis 4' },
      { date: 'c. 2500 BC', title: 'The Great Flood and Noah’s ark', ref: 'Genesis 7', world: 'First Egyptian dynasty (c. 3100 BC); wheeled vehicles used in Mesopotamia.' },
      { date: 'After the flood', title: 'God’s covenant with Noah', ref: 'Genesis 9' },
      { date: 'Before 2100 BC', title: 'The tower of Babel', ref: 'Genesis 11', world: 'First Sumerian empire founded; Babylonians draw maps on clay tablets.' }
    ]},
    { era: 'The Patriarchs', events: [
      { date: '2166 BC', title: 'Abram is born', ref: 'Genesis 11', world: 'Ur-Nammu law code published in Ur.' },
      { date: '2091 BC', title: 'God calls Abram', ref: 'Genesis 12', world: 'Abram enters Canaan; the Bronze Age begins in Europe.' },
      { date: '2081 BC', title: 'God’s covenant with Abram', ref: 'Genesis 15' },
      { date: '2080 BC', title: 'Ishmael is born', ref: 'Genesis 16' },
      { date: '2067 BC', title: 'The covenant of circumcision', ref: 'Genesis 17' },
      { date: 'c. 2067 BC', title: 'The destruction of Sodom and Gomorrah', ref: 'Genesis 19' },
      { date: '2066 BC', title: 'Isaac is born', ref: 'Genesis 21', world: 'Wooden ships developed in Crete.' },
      { date: 'c. 2050 BC', title: 'Abraham is tested to offer Isaac', ref: 'Genesis 22' },
      { date: '2029 BC', title: 'Sarah dies', ref: 'Genesis 23' },
      { date: '2026 BC', title: 'Isaac marries Rebekah', ref: 'Genesis 24' },
      { date: '2006 BC', title: 'Jacob and Esau are born', ref: 'Genesis 25' },
      { date: '1929 BC', title: 'Jacob’s ladder at Bethel', ref: 'Genesis 28', world: 'Jacob goes to Haran.' },
      { date: '1915 BC', title: 'Joseph is born', ref: 'Genesis 30' },
      { date: '1898 BC', title: 'Joseph sold into slavery', ref: 'Genesis 37' },
      { date: '1885 BC', title: 'Joseph rises to power in Egypt', ref: 'Genesis 41', world: 'Sumerian Epic of Gilgamesh compiled.' },
      { date: '1876 BC', title: 'Jacob’s family settles in Egypt', ref: 'Genesis 46' },
      { date: '1859 BC', title: 'Jacob dies', ref: 'Genesis 49' },
      { date: '1805 BC', title: 'Joseph dies', ref: 'Genesis 50', world: 'Stonehenge constructed (c. 1800 BC).' }
    ]},
    { era: 'Egypt & the Exodus', events: [
      { date: 'c. 1730 BC', title: 'Israel enslaved in Egypt', ref: 'Exodus 1', world: 'Law Code of Hammurabi published in Babylon.' },
      { date: '1527 BC', title: 'Birth of Moses', ref: 'Exodus 2', world: 'Thutmose III rules Egypt.' },
      { date: '1500 BC', title: 'Moses flees to Midian', ref: 'Exodus 2' },
      { date: '1446 BC', title: 'Moses and the burning bush', ref: 'Exodus 3' },
      { date: '1446 BC', title: 'The plagues and the first Passover', ref: 'Exodus 12' },
      { date: '1446 BC', title: 'Crossing the Red Sea', ref: 'Exodus 14' },
      { date: '1446 BC', title: 'The Ten Commandments at Sinai', ref: 'Exodus 20', world: 'The Law is given at Mount Sinai.' },
      { date: 'c. 1445 BC', title: 'The tabernacle is built', ref: 'Exodus 40' },
      { date: '1444 BC', title: 'The twelve spies and forty years of wandering', ref: 'Numbers 14' },
      { date: '1406 BC', title: 'Moses’ final words; his death', ref: 'Deuteronomy 34' }
    ]},
    { era: 'Conquest & the Judges', events: [
      { date: '1406 BC', title: 'Israel crosses the Jordan', ref: 'Joshua 3' },
      { date: '1406 BC', title: 'The fall of Jericho', ref: 'Joshua 6', world: 'The conquest of Canaan begins.' },
      { date: '1399 BC', title: 'Canaanite power broken; the land divided', ref: 'Joshua 13' },
      { date: 'c. 1375 BC', title: 'The era of the judges begins', ref: 'Judges 2', world: 'Othniel, the first judge (1374–1334 BC).' },
      { date: 'c. 1235 BC', title: 'Oppression by Jabin and Sisera begins', ref: 'Judges 4', world: 'Philistines settle Canaan’s coasts.' },
      { date: 'c. 1216 BC', title: 'The victory of Deborah and Barak', ref: 'Judges 4' },
      { date: 'c. 1200 BC', title: 'Midianite oppression begins', ref: 'Judges 6', world: 'Iron Age begins; the Greeks destroy Troy (c. 1176 BC).' },
      { date: 'c. 1169 BC', title: 'Gideon delivers Israel', ref: 'Judges 7' },
      { date: 'c. 1120 BC', title: 'Eli serves as Israel’s high priest', ref: '1 Samuel 1' },
      { date: 'c. 1085 BC', title: 'Jephthah’s victory over the Ammonites', ref: 'Judges 11' },
      { date: 'c. 1075 BC', title: 'Samson and the Philistines', ref: 'Judges 16' },
      { date: 'c. 1100 BC', title: 'Ruth and Boaz', ref: 'Ruth 1' },
      { date: '1080 BC', title: 'The battle of Shiloh', ref: '1 Samuel 4' },
      { date: '1063 BC', title: 'Samuel comes to office', ref: '1 Samuel 3' }
    ]},
    { era: 'The United Kingdom', events: [
      { date: '1043 BC', title: 'Saul becomes Israel’s first king', ref: '1 Samuel 10' },
      { date: '1040 BC', title: 'David is born', ref: 'Ruth 4' },
      { date: '1024 BC', title: 'Samuel anoints David', ref: '1 Samuel 16' },
      { date: '1024 BC', title: 'David kills Goliath', ref: '1 Samuel 17' },
      { date: '1010 BC', title: 'Death of Saul and Jonathan; David made king of Judah', ref: '2 Samuel 2' },
      { date: '1003 BC', title: 'David becomes king of all Israel and takes Jerusalem', ref: '2 Samuel 5', world: 'Greeks adopt the Phoenician alphabet.' },
      { date: '1000 BC', title: 'The ark brought to Jerusalem', ref: '2 Samuel 6' },
      { date: 'c. 1000 BC', title: 'God’s covenant with David', ref: '2 Samuel 7' },
      { date: '970 BC', title: 'Death of David; Solomon becomes king', ref: '1 Kings 2' },
      { date: 'c. 967 BC', title: 'Solomon asks God for wisdom', ref: '1 Kings 3' },
      { date: '966 BC', title: 'Building of the temple begins', ref: '1 Kings 6' },
      { date: '959 BC', title: 'The temple is dedicated', ref: '1 Kings 8' }
    ]},
    { era: 'The Divided Kingdom', events: [
      { date: '930 BC', title: 'Solomon dies; the kingdom is divided', ref: '1 Kings 12', world: 'Rehoboam rules Judah; Jeroboam I rules Israel.' },
      { date: 'c. 863 BC', title: 'Elijah on Mount Carmel', ref: '1 Kings 18' },
      { date: 'c. 848 BC', title: 'Elijah taken up; Elisha succeeds him', ref: '2 Kings 2' },
      { date: '841 BC', title: 'Jehu becomes king of Israel', ref: '2 Kings 9' },
      { date: '766 BC', title: 'The prophet Amos', ref: 'Amos 1', world: 'First Olympic games in Greece (776 BC); Rome founded (753 BC).' },
      { date: 'c. 760 BC', title: 'Jonah sent to Nineveh', ref: 'Jonah 1' },
      { date: '739 BC', title: 'Isaiah’s vision and call', ref: 'Isaiah 6' },
      { date: '722 BC', title: 'Assyria destroys the northern kingdom', ref: '2 Kings 17', world: 'Samaria falls to Assyria; the Israelites are exiled.' },
      { date: '701 BC', title: 'Sennacherib threatens Jerusalem', ref: '2 Kings 18' },
      { date: 'c. 640 BC', title: 'Josiah’s reign and reforms', ref: '2 Kings 22' },
      { date: '627 BC', title: 'The call of Jeremiah', ref: 'Jeremiah 1' },
      { date: '612 BC', title: 'Nineveh falls', ref: 'Nahum 3', world: 'The Assyrian capital is destroyed.' },
      { date: '609 BC', title: 'The battle of Megiddo; the death of Josiah', ref: '2 Kings 23' }
    ]},
    { era: 'Exile', events: [
      { date: '605 BC', title: 'Daniel taken to Babylon', ref: 'Daniel 1', world: 'Nebuchadnezzar reigns over Babylon (605–562 BC).' },
      { date: 'c. 600 BC', title: 'The fiery furnace', ref: 'Daniel 3', world: 'Invention of coinage by the Lydians.' },
      { date: '593 BC', title: 'Ezekiel’s vision by the Chebar', ref: 'Ezekiel 1' },
      { date: '587 BC', title: 'Jerusalem falls; the temple destroyed', ref: '2 Kings 25', world: 'Judah falls to Babylon; the last Jews are exiled.' },
      { date: 'c. 550 BC', title: 'Ezekiel’s valley of dry bones', ref: 'Ezekiel 37' },
      { date: '539 BC', title: 'Daniel in the lions’ den; Babylon falls', ref: 'Daniel 6', world: 'Buddha born (563 BC); Confucius born (551 BC).' }
    ]},
    { era: 'Return & Restoration', events: [
      { date: '538 BC', title: 'The exiles return under Cyrus', ref: 'Ezra 1', world: 'Cyrus crowned in Babylon; the Jews return under Zerubbabel.' },
      { date: '536 BC', title: 'Foundations laid for the new temple', ref: 'Ezra 3' },
      { date: '516 BC', title: 'The second temple is completed', ref: 'Ezra 6' },
      { date: '478 BC', title: 'Esther becomes queen', ref: 'Esther 2', world: 'Roman Republic founded (509 BC); democracy established in Athens.' },
      { date: '457 BC', title: 'Ezra returns to Jerusalem', ref: 'Ezra 7' },
      { date: '444 BC', title: 'Nehemiah rebuilds the walls', ref: 'Nehemiah 2' },
      { date: '430 BC', title: 'Malachi, the last Old Testament prophet', ref: 'Malachi 1' }
    ]},
    { era: 'Between the Testaments', events: [
      { date: '332 BC', title: 'Alexander the Great conquers the Persian Empire', ref: null },
      { date: '250–50 BC', title: 'The Hebrew Scriptures translated into Greek (the Septuagint)', ref: null },
      { date: '167 BC', title: 'Antiochus IV desecrates the temple', ref: null },
      { date: '165 BC', title: 'The Maccabees rededicate the temple (Hanukkah)', ref: null },
      { date: '20 BC', title: 'Herod the Great rebuilds the temple in Jerusalem', ref: null, world: 'Julius Caesar had campaigned in Britain (55, 54 BC).' }
    ]},
    { era: 'The Life of Christ', events: [
      { date: '4 BC', title: 'The birth of Jesus', ref: 'Luke 2', world: 'Death of Herod the Great.' },
      { date: 'c. 4 BC', title: 'The visit of the magi', ref: 'Matthew 2' },
      { date: '8 AD', title: 'The boy Jesus at the temple', ref: 'Luke 2' },
      { date: '26 AD', title: 'The baptism of Jesus; his ministry begins', ref: 'Matthew 3', world: 'Pontius Pilate, Roman procurator (AD 26–36).' },
      { date: '26 AD', title: 'The temptation in the wilderness', ref: 'Matthew 4' },
      { date: '27 AD', title: 'The Sermon on the Mount', ref: 'Matthew 5' },
      { date: 'c. 29 AD', title: 'The death of John the Baptist', ref: 'Mark 6' },
      { date: '29 AD', title: 'Jesus feeds the five thousand', ref: 'John 6' },
      { date: '29 AD', title: 'The transfiguration', ref: 'Matthew 17' },
      { date: '30 AD', title: 'The raising of Lazarus', ref: 'John 11' },
      { date: '30 AD', title: 'The triumphal entry', ref: 'John 12' },
      { date: '30 AD', title: 'The Last Supper', ref: 'Luke 22' },
      { date: '30 AD', title: 'The crucifixion', ref: 'Luke 23' },
      { date: '30 AD', title: 'The resurrection', ref: 'Luke 24' },
      { date: '30 AD', title: 'The great commission and ascension', ref: 'Matthew 28' }
    ]},
    { era: 'The Early Church', events: [
      { date: '30 AD', title: 'The Holy Spirit comes at Pentecost', ref: 'Acts 2' },
      { date: 'c. 34 AD', title: 'Stephen, the first martyr', ref: 'Acts 7' },
      { date: '34 AD', title: 'The conversion of Saul (Paul)', ref: 'Acts 9', world: 'Paul is converted on the Damascus road.' },
      { date: '37 AD', title: 'Paul’s first visit to Jerusalem', ref: 'Acts 9' },
      { date: 'c. 40 AD', title: 'The gospel opens to the Gentiles', ref: 'Acts 10' },
      { date: '44 AD', title: 'James, the brother of John, is martyred', ref: 'Acts 12', world: 'Death of Herod Agrippa I.' },
      { date: '47–49 AD', title: 'Paul’s first missionary journey', ref: 'Acts 13' },
      { date: '50 AD', title: 'The council at Jerusalem', ref: 'Acts 15' },
      { date: '51–53 AD', title: 'Paul’s second missionary journey', ref: 'Acts 16', world: 'Gallio proconsul of Achaia.' },
      { date: '54–57 AD', title: 'Paul’s third missionary journey', ref: 'Acts 19' },
      { date: '57 AD', title: 'Paul writes to the Romans', ref: 'Romans 1' },
      { date: '58 AD', title: 'Paul arrested in Jerusalem, held in Caesarea', ref: 'Acts 21' },
      { date: '60 AD', title: 'Paul appeals to Caesar', ref: 'Acts 25' },
      { date: '62 AD', title: 'Paul preaches in Rome', ref: 'Acts 28' },
      { date: 'c. 67 AD', title: 'Paul and Peter executed in Rome', ref: '2 Timothy 4', world: 'Rome burned under Nero (AD 64).' },
      { date: '70 AD', title: 'Jerusalem falls to Rome under Titus; the temple destroyed', ref: null, world: 'Fall of Masada, the last Jewish stronghold (AD 73).' },
      { date: '90 AD', title: 'John’s Revelation on Patmos', ref: 'Revelation 1', world: 'Persecution of Christians under Domitian (AD 81–96).' },
      { date: 'c. 98 AD', title: 'John, the last apostle, dies', ref: null }
    ]}
  ];

  /* Public-domain images (Wikimedia) for key people and places, keyed by event
     title. Rendered in the horizontal timeline; hidden gracefully if one fails
     to load. */
  var TIMELINE_IMAGES = {
    'God creates the heavens and the earth': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Michelangelo_-_Creation_of_Adam_%28cropped%29.jpg/330px-Michelangelo_-_Creation_of_Adam_%28cropped%29.jpg',
    'The Great Flood and Noah’s ark': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Edward_Hicks%2C_American_-_Noah%27s_Ark_-_Google_Art_Project.jpg/330px-Edward_Hicks%2C_American_-_Noah%27s_Ark_-_Google_Art_Project.jpg',
    'God calls Abram': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Guercino_Abramo_ripudia_Agar_%28cropped_2%29.jpg/330px-Guercino_Abramo_ripudia_Agar_%28cropped_2%29.jpg',
    'Moses and the burning bush': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Rembrandt_Harmensz._van_Rijn_079.jpg/330px-Rembrandt_Harmensz._van_Rijn_079.jpg',
    'Crossing the Red Sea': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/David_Roberts-IsraelitesLeavingEgypt_1828.jpg/330px-David_Roberts-IsraelitesLeavingEgypt_1828.jpg',
    'The Ten Commandments at Sinai': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/0001_FL9694984.jpg/330px-0001_FL9694984.jpg',
    'The fall of Jericho': 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Tell_es-sultan.jpg/330px-Tell_es-sultan.jpg',
    'Samuel anoints David': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/King_David%2C_the_King_of_Israel.jpg/330px-King_David%2C_the_King_of_Israel.jpg',
    'Building of the temple begins': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Jerusalem_Modell_BW_2.JPG/330px-Jerusalem_Modell_BW_2.JPG',
    'Elijah on Mount Carmel': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Giovanni_Girolamo_Savoldo%2C_Elijah_Fed_by_the_Raven%2C_c._1510%2C_NGA_46134.jpg/330px-Giovanni_Girolamo_Savoldo%2C_Elijah_Fed_by_the_Raven%2C_c._1510%2C_NGA_46134.jpg',
    'Jerusalem falls; the temple destroyed': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Tissot_The_Flight_of_the_Prisoners.jpg/330px-Tissot_The_Flight_of_the_Prisoners.jpg',
    'Daniel in the lions’ den; Babylon falls': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/Sir_Peter_Paul_Rubens_-_Daniel_in_the_Lions%27_Den_-_Google_Art_Project.jpg/330px-Sir_Peter_Paul_Rubens_-_Daniel_in_the_Lions%27_Den_-_Google_Art_Project.jpg',
    'The exiles return under Cyrus': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Cyrus_II_%28The_Great%29_%28cropped%29.jpg/330px-Cyrus_II_%28The_Great%29_%28cropped%29.jpg',
    'The birth of Jesus': 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Adoration_of_the_sheperds_-_Matthias_Stomer.jpg/330px-Adoration_of_the_sheperds_-_Matthias_Stomer.jpg',
    'The Sermon on the Mount': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Bloch-SermonOnTheMount.jpg/330px-Bloch-SermonOnTheMount.jpg',
    'The crucifixion': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Cristo_crucificado.jpg/330px-Cristo_crucificado.jpg',
    'The resurrection': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Rafael_-_ressureicaocristo01.jpg/330px-Rafael_-_ressureicaocristo01.jpg',
    'The Holy Spirit comes at Pentecost': 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Vienna_Karlskirche_frescos4b.jpg',
    'The conversion of Saul (Paul)': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/La_conversion_de_Saint_Paul_Giordano_Nancy_3018.jpg/330px-La_conversion_de_Saint_Paul_Giordano_Nancy_3018.jpg',
    'John’s Revelation on Patmos': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Chora-of-Patmos.JPG/330px-Chora-of-Patmos.JPG'
  };

  // A horizontal, scroll-through timeline: era markers and event cards (many
  // with a public-domain image of the person or place) laid left to right.
  function renderDetailedTimeline() {
    var wrap = document.getElementById('timeline-detailed');
    if (!wrap || wrap.dataset.built) return;
    wrap.dataset.built = '1';
    var track = el('div', 'tl-horizon');
    DETAILED_TIMELINE.forEach(function (period) {
      var era = el('div', 'tl-h-era');
      era.appendChild(txt('span', 'tl-h-era-text', period.era));
      track.appendChild(era);
      period.events.forEach(function (ev) {
        var card = el('article', 'tl-h-card');
        var src = TIMELINE_IMAGES[ev.title];
        if (src) {
          var fig = el('div', 'tl-h-img');
          var im = document.createElement('img');
          im.src = src; im.alt = ev.title; im.loading = 'lazy';
          im.onerror = function () { if (fig.parentNode) fig.parentNode.removeChild(fig); };
          fig.appendChild(im);
          card.appendChild(fig);
        }
        card.appendChild(txt('span', 'tl-h-date', ev.date));
        card.appendChild(txt('span', 'tl-h-title', ev.title));
        var loc = ev.ref ? parseRef(ev.ref) : null;
        if (loc) {
          var b = txt('button', 'tl-h-ref', ev.ref);
          b.type = 'button';
          b.addEventListener('click', function () { openReaderAt(loc.book, loc.chapter); });
          card.appendChild(b);
        }
        // parallel world history from the study-Bible chronology
        if (ev.world) card.appendChild(txt('span', 'tl-h-world', ev.world));
        track.appendChild(card);
      });
    });
    wrap.appendChild(track);
  }

  /* ---------- messianic prophecy ----------
     A curated set of Old Testament prophecies and their New Testament
     fulfillment in Jesus, grouped by the stage of his life where they came
     true. Every reference links into the reader. */
  var MESSIANIC_STAGES = [
    { label: 'Ancestry & lineage', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/King_David%2C_the_King_of_Israel.jpg/330px-King_David%2C_the_King_of_Israel.jpg', items: [
      { desc: 'The offspring of the woman, who would crush the serpent', ot: 'Genesis 3:15', nt: 'Galatians 4:4' },
      { desc: 'A descendant of Abraham, blessing all nations', ot: 'Genesis 22:18', nt: 'Matthew 1:1' },
      { desc: 'A descendant of Isaac', ot: 'Genesis 21:12', nt: 'Luke 3:34' },
      { desc: 'A descendant of Jacob — a star out of Jacob', ot: 'Numbers 24:17', nt: 'Luke 3:34' },
      { desc: 'From the tribe of Judah', ot: 'Genesis 49:10', nt: 'Hebrews 7:14' },
      { desc: 'From the family line of Jesse', ot: 'Isaiah 11:1', nt: 'Luke 3:32' },
      { desc: 'Heir to the throne of David', ot: '2 Samuel 7:12', nt: 'Luke 1:32' },
      { desc: 'The Son of David', ot: 'Jeremiah 23:5', nt: 'Romans 1:3' }
    ]},
    { label: 'Birth & childhood', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Adoration_of_the_sheperds_-_Matthias_Stomer.jpg/330px-Adoration_of_the_sheperds_-_Matthias_Stomer.jpg', items: [
      { desc: 'Born of a virgin', ot: 'Isaiah 7:14', nt: 'Matthew 1:23' },
      { desc: 'Born in Bethlehem', ot: 'Micah 5:2', nt: 'Matthew 2:1' },
      { desc: 'Would come at the appointed time', ot: 'Daniel 9:25', nt: 'Galatians 4:4' },
      { desc: 'Kings would bring him gifts and bow before him', ot: 'Psalms 72:10', nt: 'Matthew 2:11' },
      { desc: 'The children of Bethlehem killed in an attempt to destroy him', ot: 'Jeremiah 31:15', nt: 'Matthew 2:16' },
      { desc: 'Called out of Egypt', ot: 'Hosea 11:1', nt: 'Matthew 2:15' }
    ]},
    { label: 'His nature & mission', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/The_Baptism_of_Christ_%28Verrocchio_and_Leonardo%29.jpg/330px-The_Baptism_of_Christ_%28Verrocchio_and_Leonardo%29.jpg', items: [
      { desc: '“Immanuel” — God with us', ot: 'Isaiah 7:14', nt: 'Matthew 1:23' },
      { desc: 'Called Mighty God, Everlasting Father, Prince of Peace', ot: 'Isaiah 9:6', nt: 'John 1:1' },
      { desc: 'Eternal — from ancient days', ot: 'Micah 5:2', nt: 'John 1:1' },
      { desc: 'Declared the Son of God', ot: 'Psalms 2:7', nt: 'Matthew 3:17' },
      { desc: 'David would call him “Lord”', ot: 'Psalms 110:1', nt: 'Matthew 22:44' },
      { desc: 'Anointed by the Spirit of the Lord', ot: 'Isaiah 11:2', nt: 'Matthew 3:16' },
      { desc: 'A messenger — an “Elijah” — sent before him', ot: 'Malachi 4:5', nt: 'Matthew 11:14' },
      { desc: 'A voice crying in the wilderness to prepare his way', ot: 'Isaiah 40:3', nt: 'Matthew 3:3' },
      { desc: 'A prophet like Moses', ot: 'Deuteronomy 18:15', nt: 'Acts 3:22' },
      { desc: 'A priest forever, in the order of Melchizedek', ot: 'Psalms 110:4', nt: 'Hebrews 5:6' },
      { desc: 'The Branch — the righteous King', ot: 'Jeremiah 23:5', nt: 'Luke 1:32' },
      { desc: 'God’s chosen servant', ot: 'Isaiah 42:1', nt: 'Matthew 12:18' },
      { desc: 'A light for the Gentiles, salvation to the ends of the earth', ot: 'Isaiah 49:6', nt: 'Luke 2:32' }
    ]},
    { label: 'Ministry & teaching', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Bloch-SermonOnTheMount.jpg/330px-Bloch-SermonOnTheMount.jpg', items: [
      { desc: 'His ministry would begin in Galilee', ot: 'Isaiah 9:1', nt: 'Matthew 4:13' },
      { desc: 'The Spirit of the Lord upon him to preach good news', ot: 'Isaiah 61:1', nt: 'Luke 4:18' },
      { desc: 'He would heal the blind, deaf, lame, and mute', ot: 'Isaiah 35:5', nt: 'Matthew 11:5' },
      { desc: 'He would carry our sicknesses', ot: 'Isaiah 53:4', nt: 'Matthew 8:17' },
      { desc: 'A shepherd who gathers his flock', ot: 'Isaiah 40:11', nt: 'John 10:11' },
      { desc: 'He would teach in parables', ot: 'Psalms 78:2', nt: 'Matthew 13:35' },
      { desc: 'Consumed with zeal for God’s house', ot: 'Psalms 69:9', nt: 'John 2:17' },
      { desc: 'The Lord would come to his temple', ot: 'Malachi 3:1', nt: 'Mark 11:15' },
      { desc: 'He would bring a new covenant', ot: 'Jeremiah 31:31', nt: 'Hebrews 8:6' }
    ]},
    { label: 'Rejection & the coming King', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Assisi-frescoes-entry-into-jerusalem-pietro_lorenzetti.jpg/330px-Assisi-frescoes-entry-into-jerusalem-pietro_lorenzetti.jpg', items: [
      { desc: 'Despised and rejected by his own people', ot: 'Isaiah 53:3', nt: 'John 1:11' },
      { desc: 'The stone the builders rejected', ot: 'Psalms 118:22', nt: 'Matthew 21:42' },
      { desc: 'A stone of stumbling for Israel', ot: 'Isaiah 8:14', nt: 'Romans 9:32' },
      { desc: 'Hated without a cause', ot: 'Psalms 69:4', nt: 'John 15:25' },
      { desc: 'His miracles met with unbelief', ot: 'Isaiah 53:1', nt: 'John 12:37' },
      { desc: 'Entering Jerusalem, humble, on a donkey', ot: 'Zechariah 9:9', nt: 'Matthew 21:5' },
      { desc: 'Praised even by children', ot: 'Psalms 8:2', nt: 'Matthew 21:16' },
      { desc: '“Blessed is he who comes in the name of the Lord”', ot: 'Psalms 118:26', nt: 'Matthew 21:9' }
    ]},
    { label: 'Betrayal & arrest', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Giotto_-_Scrovegni_-_-31-_-_Kiss_of_Judas.jpg/330px-Giotto_-_Scrovegni_-_-31-_-_Kiss_of_Judas.jpg', items: [
      { desc: 'Betrayed by a close friend who shared his bread', ot: 'Psalms 41:9', nt: 'John 13:18' },
      { desc: 'Sold for thirty pieces of silver', ot: 'Zechariah 11:12', nt: 'Matthew 26:15' },
      { desc: 'The silver thrown down and used for a potter’s field', ot: 'Zechariah 11:13', nt: 'Matthew 27:7' },
      { desc: 'His betrayer’s place would be taken by another', ot: 'Psalms 109:8', nt: 'Acts 1:20' },
      { desc: 'The shepherd struck, and the disciples scattered', ot: 'Zechariah 13:7', nt: 'Matthew 26:31' }
    ]},
    { label: 'Trial & suffering', items: [
      { desc: 'Accused by false witnesses', ot: 'Psalms 35:11', nt: 'Matthew 26:60' },
      { desc: 'Silent before his accusers', ot: 'Isaiah 53:7', nt: 'Matthew 27:12' },
      { desc: 'Struck on the cheek', ot: 'Micah 5:1', nt: 'Matthew 27:30' },
      { desc: 'Beaten and spat upon; his beard torn out', ot: 'Isaiah 50:6', nt: 'Matthew 26:67' },
      { desc: 'His appearance marred beyond that of any man', ot: 'Isaiah 52:14', nt: 'John 19:1' },
      { desc: 'Wounded for our transgressions, bruised for our iniquities', ot: 'Isaiah 53:5', nt: '1 Peter 2:24' },
      { desc: 'He would bear the sin of many and intercede for transgressors', ot: 'Isaiah 53:12', nt: 'Luke 23:34' }
    ]},
    { label: 'Crucifixion', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Cristo_crucificado.jpg/330px-Cristo_crucificado.jpg', items: [
      { desc: 'His hands and feet pierced', ot: 'Psalms 22:16', nt: 'John 20:27' },
      { desc: 'Numbered with the transgressors', ot: 'Isaiah 53:12', nt: 'Mark 15:27' },
      { desc: 'Mocked and insulted — “He trusts in God, let God rescue him”', ot: 'Psalms 22:7', nt: 'Matthew 27:39' },
      { desc: 'Given vinegar and gall to drink', ot: 'Psalms 69:21', nt: 'Matthew 27:34' },
      { desc: 'Soldiers cast lots for his clothing', ot: 'Psalms 22:18', nt: 'John 19:24' },
      { desc: 'The cry: “My God, my God, why have you forsaken me?”', ot: 'Psalms 22:1', nt: 'Matthew 27:46' },
      { desc: 'Forsaken and poured out unto death', ot: 'Psalms 22:14', nt: 'John 19:34' },
      { desc: 'He would commit his spirit to God', ot: 'Psalms 31:5', nt: 'Luke 23:46' },
      { desc: 'Darkness would fall over the land', ot: 'Amos 8:9', nt: 'Matthew 27:45' },
      { desc: 'Not one of his bones would be broken', ot: 'Psalms 34:20', nt: 'John 19:33' },
      { desc: 'His side pierced — “they will look on him whom they pierced”', ot: 'Zechariah 12:10', nt: 'John 19:34' },
      { desc: 'He would suffer outside the city gate', ot: 'Leviticus 16:27', nt: 'Hebrews 13:12' }
    ]},
    { label: 'His death & burial', items: [
      { desc: 'The Messiah would be “cut off,” but not for himself', ot: 'Daniel 9:26', nt: 'Romans 5:6' },
      { desc: 'A substitute pierced for our sins, bearing our punishment', ot: 'Isaiah 53:8', nt: '2 Corinthians 5:21' },
      { desc: 'His soul made an offering for the sin of many', ot: 'Isaiah 53:10', nt: 'Hebrews 9:28' },
      { desc: 'Assigned a grave with the wicked, yet buried with the rich', ot: 'Isaiah 53:9', nt: 'Matthew 27:60' },
      { desc: 'His body would not see decay', ot: 'Psalms 16:10', nt: 'Acts 2:31' }
    ]},
    { label: 'Resurrection & exaltation', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Rafael_-_ressureicaocristo01.jpg/330px-Rafael_-_ressureicaocristo01.jpg', items: [
      { desc: 'Raised to life — he would see the light of life and prolong his days', ot: 'Isaiah 53:11', nt: 'Luke 24:6' },
      { desc: 'Not abandoned to the realm of the dead', ot: 'Psalms 16:10', nt: 'Acts 2:32' },
      { desc: 'Ascended on high, leading captives', ot: 'Psalms 68:18', nt: 'Ephesians 4:8' },
      { desc: 'Seated at the right hand of God', ot: 'Psalms 110:1', nt: 'Hebrews 1:3' },
      { desc: 'The chosen cornerstone, rejected then exalted', ot: 'Isaiah 28:16', nt: '1 Peter 2:6' },
      { desc: 'He would pour out his Spirit on all people', ot: 'Joel 2:28', nt: 'Acts 2:17' },
      { desc: 'Every knee would bow before him', ot: 'Isaiah 45:23', nt: 'Philippians 2:10' },
      { desc: 'Given everlasting dominion over all peoples', ot: 'Daniel 7:14', nt: 'Revelation 1:7' }
    ]}
  ];
  function messianicCount() {
    var n = 0;
    MESSIANIC_STAGES.forEach(function (s) { n += s.items.length; });
    return n;
  }

  /* The classic illustrative probabilities (popularised by Peter Stoner in
     "Science Speaks") for one person fulfilling N prophecies by chance. These
     convey scale, not a rigorous calculation. */
  var MESSIANIC_ODDS = [
    { n: 8, power: '10¹⁷', words: '1 in 100 quadrillion',
      illus: 'the odds of covering all of Texas two feet deep in silver dollars, marking a single coin, and a blindfolded person finding it on the first try.',
      punch: 'And that’s just eight of them.' },
    { n: 16, power: '10⁴⁵', words: '1 in a hundred quattuordecillion',
      illus: 'far more than the grains of sand on every beach on earth — like blindly pulling one specific atom out of a mountain.',
      punch: 'You’d sooner win the lottery every week for a decade.' },
    { n: 48, power: '10¹⁵⁷', words: '1 in 10 followed by 157 zeros',
      illus: 'a number with more zeros than there are atoms in the entire observable universe (about 10⁸⁰).',
      punch: 'You’d have better odds of splitting an atom with your bare hands. For one man to fulfill them by chance is, for all practical purposes, impossible.' }
  ];

  function messianicRefButton(ref, cls) {
    var loc = parseRef(ref);
    var b = txt('button', cls, ref);
    b.type = 'button';
    if (loc) b.addEventListener('click', function () { openReaderAt(loc.book, loc.chapter); });
    else b.disabled = true;
    return b;
  }

  function renderMessianicOdds() {
    var wrap = document.getElementById('messianic-odds');
    if (!wrap) return;
    wrap.textContent = '';
    var stops = MESSIANIC_ODDS;

    var big = el('div', 'mo-figure');
    var count = txt('div', 'mo-count', '');
    var odds = txt('div', 'mo-odds', '');
    var words = txt('div', 'mo-words', '');
    big.appendChild(count); big.appendChild(odds); big.appendChild(words);

    var illus = txt('p', 'mo-illus', '');
    var punch = txt('p', 'mo-punch', '');

    var slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = String(stops.length - 1);
    slider.step = '1'; slider.value = '0'; slider.className = 'mo-slider';
    slider.setAttribute('aria-label', t('messianic.oddsHeading'));

    var ticks = el('div', 'mo-ticks');
    stops.forEach(function (s, i) {
      var tk = txt('button', 'mo-tick', s.n + ' ' + t('messianic.prophecies'));
      tk.type = 'button';
      tk.addEventListener('click', function () { slider.value = String(i); update(); });
      ticks.appendChild(tk);
    });

    function update() {
      var s = stops[parseInt(slider.value, 10)];
      count.textContent = t('messianic.oddsCount', { n: s.n });
      odds.textContent = t('messianic.oddsOne') + ' ' + s.power;
      words.textContent = s.words;
      illus.textContent = t('messianic.oddsThatsLike') + ' ' + s.illus;
      punch.textContent = s.punch;
      ticks.querySelectorAll('.mo-tick').forEach(function (tk, i) {
        tk.classList.toggle('is-active', i === parseInt(slider.value, 10));
      });
    }
    slider.addEventListener('input', update);

    wrap.appendChild(big);
    wrap.appendChild(slider);
    wrap.appendChild(ticks);
    wrap.appendChild(illus);
    wrap.appendChild(punch);
    wrap.appendChild(txt('p', 'mo-caveat', t('messianic.oddsCaveat')));
    update();
  }

  function renderMessianicTimeline() {
    var wrap = document.getElementById('messianic-timeline');
    if (!wrap) return;
    wrap.textContent = '';
    var track = el('div', 'tl-horizon');
    MESSIANIC_STAGES.forEach(function (stage) {
      var era = el('div', 'tl-h-era mess-h-era');
      era.appendChild(txt('span', 'tl-h-era-text', stage.label));
      track.appendChild(era);
      stage.items.forEach(function (it, i) {
        var card = el('article', 'tl-h-card mess-card');
        if (i === 0 && stage.img) {
          var fig = el('div', 'tl-h-img');
          var im = document.createElement('img');
          im.src = stage.img; im.alt = stage.label; im.loading = 'lazy';
          im.onerror = function () { if (fig.parentNode) fig.parentNode.removeChild(fig); };
          fig.appendChild(im);
          card.appendChild(fig);
        }
        card.appendChild(txt('span', 'mess-card-desc', it.desc));
        var refs = el('div', 'mess-card-refs');
        refs.appendChild(messianicRefButton(it.ot, 'mess-ref mess-ref-ot'));
        refs.appendChild(txt('span', 'mess-ref-arrow', '→'));
        refs.appendChild(messianicRefButton(it.nt, 'mess-ref mess-ref-nt'));
        card.appendChild(refs);
        track.appendChild(card);
      });
    });
    wrap.appendChild(track);
  }

  function renderMessianicList() {
    var wrap = document.getElementById('messianic-list');
    if (!wrap) return;
    wrap.textContent = '';
    // count + legend
    wrap.appendChild(txt('p', 'mess-count', t('messianic.listCount', { n: messianicCount() })));
    var legend = el('div', 'mess-legend');
    legend.appendChild(txt('span', 'mess-legend-item mess-legend-ot', t('messianic.legendOt')));
    legend.appendChild(txt('span', 'mess-legend-item mess-legend-nt', t('messianic.legendNt')));
    wrap.appendChild(legend);

    MESSIANIC_STAGES.forEach(function (stage) {
      wrap.appendChild(txt('h3', 'mess-list-stage', stage.label));
      var table = el('div', 'mess-table');
      stage.items.forEach(function (it) {
        var row = el('div', 'mess-row');
        row.appendChild(txt('span', 'mess-row-desc', it.desc));
        var pair = el('span', 'mess-row-refs');
        pair.appendChild(messianicRefButton(it.ot, 'mess-ref mess-ref-ot'));
        pair.appendChild(txt('span', 'mess-ref-arrow', '→'));
        pair.appendChild(messianicRefButton(it.nt, 'mess-ref mess-ref-nt'));
        row.appendChild(pair);
        table.appendChild(row);
      });
      wrap.appendChild(table);
    });
  }

  var messianicBuilt = false;
  function renderMessianic() {
    if (messianicBuilt) return;
    messianicBuilt = true;
    renderMessianicOdds();
    renderMessianicTimeline();
    renderMessianicList();
  }

  /* ---------- investigate Christianity (in the Road) ----------
     Curated lines of inquiry; each lazy-loads a full, fair case from the
     existing evangelism-prep endpoint. */
  var INVESTIGATE_TOPICS = [
    'Is there good evidence that God exists?',
    'Did Jesus of Nazareth really exist as a historical figure?',
    'What is the historical evidence for the resurrection of Jesus?',
    'Can the New Testament documents be trusted as history?',
    'Did Jesus actually claim to be God?',
    'Does the fine-tuning of the universe point to a designer?',
    'Where does objective morality come from?',
    'How reliable are the eyewitness sources behind the Gospels?',
    'What do non-Christian sources say about Jesus?',
    'Do the Messianic prophecies carry real evidential weight?',
    'How did the universe begin, and what does that imply?',
    'If God is real and good, why is there so much suffering?'
  ];
  function renderInvestigate() {
    var list = document.getElementById('investigate-list');
    if (!list || list.dataset.built) return;
    list.dataset.built = '1';
    INVESTIGATE_TOPICS.forEach(function (q) {
      var row = el('details', 'apolo-objection');
      var head = el('summary', 'apolo-objection-head');
      head.appendChild(txt('span', 'apolo-objection-q', q));
      row.appendChild(head);
      var body = el('div', 'apolo-objection-body');
      row.appendChild(body);
      var loaded = false;
      row.addEventListener('toggle', function () {
        if (row.open && !loaded) {
          loaded = true;
          body.appendChild(txt('p', 'verse-panel-note', t('apologetics.preparing')));
          requestCached('evangelism-prep', { scenario: q })
            .then(function (data) {
              body.textContent = '';
              body.appendChild(txt('div', 'road-station-answer prose', cleanAIText(((data && data.prep) || '').trim())));
            })
            .catch(function (err) {
              body.textContent = '';
              body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
            });
        }
      });
      warmOnIntent(row, function () { requestCached('evangelism-prep', { scenario: q }); });
      list.appendChild(row);
    });
  }
  renderInvestigate();

  /* ---------- cross-reference arc diagram ----------
     Recreates the classic "Visualizing the Bible" arc chart: all 1,189 chapters
     along the bottom, and an arc for every strong chapter-to-chapter cross
     reference. Data (js/xref-data.js) is loaded on first open. Rendered to a
     canvas: all arcs are drawn once to an offscreen base; hovering/selecting a
     chapter re-blits the base and overlays that chapter's arcs brightly. */
  var xrefViz = (function () {
    var built = false, data = null, dmax = 1, N = 0;
    var canvas, ctx, base, viz, hoverEl, captionEl, selectedEl, loadingEl;
    var chapters = [], bookStart = [];
    var W = 0, H = 0, dpr = 1, padX = 10, baseY = 0, maxBar = 0, span = 0;
    var xs = null, arcs = null, degree = null;
    var hovered = -1, selected = -1, rafPending = false;

    var fsBtn = null;
    function grab() {
      viz = document.getElementById('xref-viz');
      canvas = document.getElementById('xref-canvas');
      hoverEl = document.getElementById('xref-hover');
      captionEl = document.getElementById('xref-caption');
      selectedEl = document.getElementById('xref-selected');
      loadingEl = document.getElementById('xref-loading');
      fsBtn = document.getElementById('xref-fullscreen');
    }

    function buildChapterIndex() {
      chapters = []; bookStart = [];
      BIBLE_BOOKS.forEach(function (g) {
        g.books.forEach(function (b) {
          bookStart.push(chapters.length);
          for (var c = 1; c <= b.chapters; c++) chapters.push({ book: b.name, chapter: c });
        });
      });
      N = chapters.length;
    }

    function decode() {
      var s = data.pairs, n = s.length / 4;
      arcs = new Int16Array(n * 2);
      for (var i = 0; i < n; i++) {
        arcs[i * 2] = parseInt(s.substr(i * 4, 2), 36);
        arcs[i * 2 + 1] = parseInt(s.substr(i * 4 + 2, 2), 36);
      }
      degree = data.degree;
      dmax = 1;
      for (var d = 0; d < degree.length; d++) if (degree[d] > dmax) dmax = degree[d];
    }

    function layout() {
      var rect = viz.getBoundingClientRect();
      W = Math.max(320, Math.floor(rect.width));
      if (viz.classList.contains('is-fullscreen')) {
        H = Math.max(320, Math.floor(rect.height) - 70);   // leave room for the caption/close
      } else {
        H = Math.round(Math.min(440, Math.max(260, W * 0.46)));
      }
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx = canvas.getContext('2d');
      baseY = Math.round(H * 0.72);
      maxBar = H - baseY - 6;
      span = W - padX * 2;
      xs = new Float32Array(N);
      for (var i = 0; i < N; i++) xs[i] = padX + (N > 1 ? (i / (N - 1)) * span : 0);
    }

    function arc(c, a, z, alpha, width, hue) {
      var x1 = xs[a], x2 = xs[z], mid = (x1 + x2) / 2, dist = Math.abs(x2 - x1);
      c.beginPath();
      c.moveTo(x1, baseY);
      c.quadraticCurveTo(mid, baseY - dist, x2, baseY);
      c.strokeStyle = 'hsla(' + hue + ',72%,62%,' + alpha + ')';
      c.lineWidth = width;
      c.stroke();
    }

    function hueFor(a, z) { return Math.round(360 * ((a + z) / 2) / N); }

    function drawBars(c) {
      for (var i = 0; i < N; i++) {
        var h = (degree[i] / dmax) * maxBar;
        c.fillStyle = 'rgba(150,155,180,0.55)';
        c.fillRect(xs[i] - 0.35, baseY + 1, 0.8, h);
      }
    }

    function renderBase() {
      base = document.createElement('canvas');
      base.width = canvas.width; base.height = canvas.height;
      var b = base.getContext('2d');
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.clearRect(0, 0, W, H);
      var n = arcs.length / 2;
      for (var i = 0; i < n; i++) {
        var a = arcs[i * 2], z = arcs[i * 2 + 1];
        arc(b, a, z, 0.05, 0.5, hueFor(a, z));
      }
      // the horizontal baseline
      b.strokeStyle = 'rgba(255,255,255,0.55)';
      b.lineWidth = 1;
      b.beginPath(); b.moveTo(padX, baseY + 0.5); b.lineTo(W - padX, baseY + 0.5); b.stroke();
      drawBars(b);
      // OT | NT divider
      var ntStart = xs[bookStart[39]];
      b.strokeStyle = 'rgba(255,255,255,0.25)';
      b.setLineDash([3, 4]);
      b.beginPath(); b.moveTo(ntStart, 8); b.lineTo(ntStart, baseY); b.stroke();
      b.setLineDash([]);
    }

    // draw the base, then overlay the highlighted chapter's arcs
    function paint(hi) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (hi < 0) return;
      var n = arcs.length / 2, count = 0;
      for (var i = 0; i < n; i++) {
        var a = arcs[i * 2], z = arcs[i * 2 + 1];
        if (a === hi || z === hi) { arc(ctx, a, z, 0.85, 1.1, hueFor(a, z)); count++; }
      }
      // a marker on the chosen chapter
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(xs[hi], baseY, 3, 0, Math.PI * 2); ctx.fill();
      return count;
    }

    function chapterAt(clientX) {
      var rect = canvas.getBoundingClientRect();
      var x = clientX - rect.left;
      var i = Math.round((x - padX) / span * (N - 1));
      return Math.max(0, Math.min(N - 1, i));
    }

    function connections(hi) {
      var set = {}, n = arcs.length / 2;
      for (var i = 0; i < n; i++) {
        var a = arcs[i * 2], z = arcs[i * 2 + 1];
        if (a === hi) set[z] = true; else if (z === hi) set[a] = true;
      }
      return Object.keys(set).map(Number).sort(function (p, q) { return p - q; });
    }

    function label(i) { return chapters[i].book + ' ' + chapters[i].chapter; }

    // the y of the arc between chapters a and z at a given canvas x (the control
    // point sits at the midpoint, so x is linear in the bezier parameter t)
    function arcYAt(a, z, x) {
      var x1 = xs[a], x2 = xs[z];
      if (x1 === x2) return null;
      var lo = Math.min(x1, x2), hi = Math.max(x1, x2);
      if (x < lo || x > hi) return null;
      var t = (x - x1) / (x2 - x1);
      if (t < 0 || t > 1) return null;
      var cy = baseY - Math.abs(x2 - x1);
      return (1 - t) * (1 - t) * baseY + 2 * (1 - t) * t * cy + t * t * baseY;
    }
    // the chapter whose arc (from `hi`) passes closest under the cursor, or -1
    function nearestArc(hi, x, y) {
      var conns = connections(hi), best = -1, bestD = 7;
      for (var k = 0; k < conns.length; k++) {
        var yy = arcYAt(hi, conns[k], x);
        if (yy == null) continue;
        var d = Math.abs(yy - y);
        if (d < bestD) { bestD = d; best = conns[k]; }
      }
      return best;
    }

    function showHover(i, clientX, partner) {
      if (!hoverEl) return;
      hoverEl.hidden = false;
      // over an arc line → name both chapters it joins; otherwise the chapter + count
      hoverEl.textContent = (partner >= 0)
        ? label(i) + ' ↔ ' + label(partner)
        : label(i) + ' · ' + t('crossref.refCount', { n: degree[i] });
      var rect = viz.getBoundingClientRect();
      var x = clientX - rect.left;
      hoverEl.style.left = Math.max(8, Math.min(rect.width - 8, x)) + 'px';
    }

    function renderSelected(hi) {
      if (!selectedEl) return;
      var conns = connections(hi);
      selectedEl.textContent = '';
      selectedEl.hidden = false;
      var head = el('div', 'xref-sel-head');
      head.appendChild(txt('span', 'xref-sel-title', label(hi)));
      head.appendChild(txt('span', 'xref-sel-count', t('crossref.connCount', { n: conns.length })));
      var open = txt('button', 'xref-sel-open', t('crossref.openChapter'));
      open.type = 'button';
      open.addEventListener('click', function () { openReaderAt(chapters[hi].book, chapters[hi].chapter); });
      head.appendChild(open);
      selectedEl.appendChild(head);
      var list = el('div', 'xref-sel-list');
      conns.forEach(function (c) {
        var b = txt('button', 'xref-sel-chip', label(c));
        b.type = 'button';
        b.addEventListener('click', function () { openReaderAt(chapters[c].book, chapters[c].chapter); });
        list.appendChild(b);
      });
      selectedEl.appendChild(list);
    }

    function wire() {
      canvas.addEventListener('pointermove', function (e) {
        var rect = canvas.getBoundingClientRect();
        var cy = e.clientY - rect.top;
        var i = chapterAt(e.clientX);
        var partner = nearestArc(i, e.clientX - rect.left, cy);
        showHover(i, e.clientX, partner);
        if (i === hovered) return;
        hovered = i;
        if (!rafPending) {
          rafPending = true;
          window.requestAnimationFrame(function () { rafPending = false; paint(hovered >= 0 ? hovered : selected); });
        }
      });
      canvas.addEventListener('pointerleave', function () {
        hovered = -1;
        if (hoverEl) hoverEl.hidden = true;
        paint(selected);
      });
      canvas.addEventListener('click', function (e) {
        selected = chapterAt(e.clientX);
        paint(selected);
        renderSelected(selected);
      });
      if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && viz.classList.contains('is-fullscreen')) toggleFullscreen();
      });
      var t0 = null;
      window.addEventListener('resize', function () {
        if (!built || document.getElementById('view-crossref').classList.contains('is-active') === false) return;
        clearTimeout(t0);
        t0 = setTimeout(function () { layout(); renderBase(); paint(selected); }, 200);
      });
    }

    function toggleFullscreen() {
      var on = viz.classList.toggle('is-fullscreen');
      document.body.classList.toggle('xref-fs-open', on);
      if (fsBtn) fsBtn.textContent = on ? '✕' : '⛶';
      // let the layout settle to its new size before re-measuring
      window.requestAnimationFrame(function () { layout(); renderBase(); paint(selected); });
    }

    function build() {
      buildChapterIndex();
      decode();
      layout();
      renderBase();
      paint(-1);
      wire();
      built = true;
      if (loadingEl) loadingEl.hidden = true;
    }

    function ensureData(cb) {
      if (window.TGP_XREF) { data = window.TGP_XREF; cb(); return; }
      var sc = document.createElement('script');
      sc.src = 'js/xref-data.js';
      sc.onload = function () { data = window.TGP_XREF; cb(); };
      sc.onerror = function () { if (loadingEl) loadingEl.textContent = t('crossref.vizError'); };
      document.head.appendChild(sc);
    }

    return {
      open: function () {
        grab();
        if (!canvas) return;
        if (built) { return; }
        if (loadingEl) { loadingEl.hidden = false; }
        ensureData(function () { build(); });
      }
    };
  })();

  /* ---------- start ---------- */

  applyTheme(currentTheme());   // the <head> set the attribute; this syncs the toggle + storage
  resetBibleBrowser();
  renderVersionOptions();
  wireSettings();
  bibleAudio.wire();
  (function wireNotesSave() {
    var btn = document.getElementById('bible-save-notes');
    if (btn) btn.addEventListener('click', flushPendingNotes);
    updateNotesSaveBtn();
  })();
  initPush();
  // register the service worker for offline caching, independent of push
  // support (iOS Safari withholds push until the app is installed)
  if ('serviceWorker' in navigator) registerSW();
  applyReadingPrefs();

  /* A saved non-English choice needs its table fetched before the first paint,
     so translate once with what's bundled and again once the table lands. */
  applyTranslations();
  if (currentLang !== DEFAULT_LANG) {
    TGPi18n.load(currentLang).then(function () {
      renderVersionOptions();
      applyTranslations();
    });
  }
})();
