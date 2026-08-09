(function () {
  'use strict';

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
    'setting-bible-sources': { name: 'bibleSources', fallback: false }
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
    loadDailyVerse();
    renderProgressUI();
    renderNotifUI();
  }

  /* ---------- view routing ---------- */

  function showView(name) {
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
    if (name === 'timeline') renderBibleTimeline();
    if (name === 'definitions') renderCommonTerms();
    // keep the fixed progress bar from lingering over other views
    applyReadingPrefs();
    closeSidebar();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('.nav-link, .feature-card, .explore-card, .dash-badges-link').forEach(function (el) {
    el.addEventListener('click', function () {
      showView(el.dataset.view);
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
  function requestCached(path, body) {
    var key = genKey(path, body);
    if (genCache[key]) return genCache[key];
    var p = request(path, body).catch(function (err) {
      delete genCache[key];   // let the next open try again
      throw err;
    });
    genCache[key] = p;
    return p;
  }

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
  function verseKey(v) { return (v.reference || v.text || '').trim(); }
  function isVerseSaved(v) {
    var key = verseKey(v);
    return !!key && loadSaved().some(function (s) { return verseKey(s) === key; });
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
    var key = verseKey(currentVerse);
    var at = -1;
    for (var i = 0; i < list.length; i++) { if (verseKey(list[i]) === key) { at = i; break; } }
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
    verse: 1, chapterVerses: [], focusAfterLoad: null
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

  function currentVersion() {
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
    list.textContent = '';
    verses.forEach(function (verse) {
      list.appendChild(buildVerseCard(verse));
    });
    populateVersePicker(verses);
    applyReadingPrefs();
    bibleAudio.reset();               // a fresh chapter starts fresh audio
    bibleAudio.show(verses.length > 0);
    // let the new cards lay out before the progress bar measures them
    if (window.requestAnimationFrame) window.requestAnimationFrame(updateReadingProgress);
  }

  /* ---------- listen: read the chapter aloud (Web Speech API) ----------
     Reads each verse in turn using the browser's own voices — no network, no
     backend. Highlights the verse being spoken, follows the language setting,
     and degrades to a quiet note where speech synthesis isn't available. */
  var bibleAudio = (function () {
    var synth = window.speechSynthesis;
    var supported = !!synth && typeof window.SpeechSynthesisUtterance === 'function';
    var bar, playBtn, playIcon, playLabel, stopBtn, rateSel, note;
    var order = [], idx = 0, playing = false, paused = false;

    function els() {
      if (bar) return;
      bar = document.getElementById('bible-audio');
      playBtn = document.getElementById('bible-listen');
      playIcon = playBtn && playBtn.querySelector('.bible-audio-icon');
      playLabel = document.getElementById('bible-listen-label');
      stopBtn = document.getElementById('bible-listen-stop');
      rateSel = document.getElementById('bible-audio-rate');
      note = document.getElementById('bible-audio-note');
    }

    function langTag() {
      var c = currentLang;
      return c === 'en' ? 'en-US' : (c === 'zh' ? 'zh-CN' : (c === 'zh-TW' ? 'zh-TW' : c));
    }
    function pickVoice(tag) {
      var voices = synth.getVoices() || [];
      var base = tag.split('-')[0];
      var exact = voices.filter(function (v) { return v.lang && v.lang.toLowerCase() === tag.toLowerCase(); })[0];
      return exact || voices.filter(function (v) { return v.lang && v.lang.toLowerCase().indexOf(base) === 0; })[0] || null;
    }

    function markVerse(on, n) {
      var cards = document.querySelectorAll('#bible-verses .verse-card');
      for (var i = 0; i < cards.length; i++) cards[i].classList.remove('is-speaking');
      if (on && typeof n === 'number' && cards[n]) {
        cards[n].classList.add('is-speaking');
        cards[n].scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    function setPlayingUI(state) {
      els();
      if (playIcon) playIcon.textContent = state ? '⏸' : '▶';
      if (playLabel) playLabel.textContent = state ? t('bible.pause') : (paused ? t('bible.resume') : t('bible.listen'));
      if (stopBtn) stopBtn.hidden = !(state || paused);
    }

    function speakFrom(i) {
      if (i >= order.length) { finish(); return; }
      idx = i;
      var u = new window.SpeechSynthesisUtterance(order[i].text);
      var tag = langTag();
      u.lang = tag;
      var v = pickVoice(tag);
      if (v) u.voice = v;
      u.rate = parseFloat(rateSel && rateSel.value) || 1;
      u.onstart = function () { markVerse(true, order[i].cardIndex); };
      u.onend = function () {
        if (!playing) return;         // cancelled
        speakFrom(i + 1);
      };
      synth.speak(u);
    }

    function finish() {
      playing = false; paused = false;
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
        if (text) order.push({ text: text, cardIndex: i });
      }
    }

    function start() {
      build();
      if (!order.length) return;
      synth.cancel();
      playing = true; paused = false;
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
          if (note) note.hidden = false;
          return;
        }
        playBtn.addEventListener('click', function () {
          if (!playing && !paused) { start(); return; }
          if (playing && !paused) { synth.pause(); paused = true; playing = false; setPlayingUI(false); return; }
          if (paused) { synth.resume(); paused = false; playing = true; setPlayingUI(true); }
        });
        stopBtn.addEventListener('click', function () { synth.cancel(); finish(); });
        rateSel.addEventListener('change', function () {
          // apply the new speed by restarting from the current verse
          if (playing || paused) { synth.cancel(); playing = true; paused = false; setPlayingUI(true); speakFrom(idx); }
        });
        // some browsers load voices asynchronously
        if (typeof synth.onvoiceschanged !== 'undefined') synth.onvoiceschanged = function () {};
      },
      show: function (on) { els(); if (bar) bar.hidden = !on; },
      reset: function () { if (supported) window.speechSynthesis.cancel(); playing = false; paused = false; idx = 0; setPlayingUI(false); markVerse(false); }
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

    card.appendChild(actions);
    card.appendChild(panel);
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
    { key: 'summary', label: 'chap.summary', type: 'prose' },
    { key: 'previously', label: 'chap.previously', type: 'prose' },
    { key: 'placement', label: 'chap.placement', type: 'prose' },
    { key: 'outline', label: 'chap.outline', type: 'list' },
    { key: 'events', label: 'chap.events', type: 'list' },
    { key: 'people', label: 'chap.people', type: 'named' },
    { key: 'locations', label: 'chap.locations', type: 'named' },
    { key: 'historical', label: 'chap.historical', type: 'prose' },
    { key: 'structure', label: 'chap.structure', type: 'prose' },
    { key: 'themes', label: 'chap.themes', type: 'list' },
    { key: 'keyVerses', label: 'chap.keyVerses', type: 'refs' },
    { key: 'difficult', label: 'chap.difficult', type: 'refs' },
    { key: 'theology', label: 'chap.theology', type: 'prose' },
    { key: 'connections', label: 'chap.connections', type: 'refs' },
    { key: 'christ', label: 'chap.christ', type: 'prose' },
    { key: 'apologetics', label: 'chap.apologetics', type: 'prose' },
    { key: 'archaeology', label: 'chap.archaeology', type: 'archaeology' },
    { key: 'places', label: 'chap.places', type: 'geography' },
    { key: 'timeline', label: 'chap.timeline', type: 'timeline' },
    { key: 'next', label: 'chap.next', type: 'prose' },
    { key: 'commonQuestions', label: 'chap.faq', type: 'faq' },
    { key: 'quiz', label: 'chap.quiz', type: 'quiz' },
    { key: 'sources', label: 'chap.sources', type: 'list' }
  ];

  /* The whole-book study, shown when a book is selected and in the verse
     study view. Same accordion machinery as the chapter overview. */
  var BOOK_SECTIONS = [
    { key: 'name', label: 'book.name', type: 'prose' },
    { key: 'nameMeaning', label: 'book.nameMeaning', type: 'prose' },
    { key: 'testament', label: 'book.testament', type: 'prose' },
    { key: 'category', label: 'book.category', type: 'prose' },
    { key: 'author', label: 'book.author', type: 'prose' },
    { key: 'authorship', label: 'book.authorship', type: 'prose' },
    { key: 'date', label: 'book.date', type: 'prose' },
    { key: 'dating', label: 'book.dating', type: 'prose' },
    { key: 'audience', label: 'book.audience', type: 'prose' },
    { key: 'historical', label: 'book.historical', type: 'prose' },
    { key: 'political', label: 'book.political', type: 'prose' },
    { key: 'cultural', label: 'book.cultural', type: 'prose' },
    { key: 'geography', label: 'book.geography', type: 'prose' },
    { key: 'genre', label: 'book.genre', type: 'prose' },
    { key: 'purpose', label: 'book.purpose', type: 'prose' },
    { key: 'summary', label: 'book.summary', type: 'prose' },
    { key: 'outline', label: 'book.outline', type: 'list' },
    { key: 'people', label: 'book.people', type: 'named' },
    { key: 'locations', label: 'book.locations', type: 'named' },
    { key: 'events', label: 'book.events', type: 'list' },
    { key: 'themes', label: 'book.themes', type: 'list' },
    { key: 'doctrines', label: 'book.doctrines', type: 'named' },
    { key: 'keyVerses', label: 'book.keyVerses', type: 'refs' },
    { key: 'keyChapters', label: 'book.keyChapters', type: 'refs' },
    { key: 'covenants', label: 'book.covenants', type: 'named' },
    { key: 'neighbors', label: 'book.neighbors', type: 'prose' },
    { key: 'storyline', label: 'book.storyline', type: 'prose' },
    { key: 'christ', label: 'book.christ', type: 'prose' },
    { key: 'connections', label: 'book.connections', type: 'refs' },
    { key: 'controversies', label: 'book.controversies', type: 'named' },
    { key: 'archaeology', label: 'book.archaeology', type: 'archaeology' },
    { key: 'places', label: 'book.places', type: 'geography' },
    { key: 'timeline', label: 'book.timeline', type: 'timeline' },
    { key: 'manuscripts', label: 'book.manuscripts', type: 'prose' },
    { key: 'reception', label: 'book.reception', type: 'prose' },
    { key: 'sources', label: 'book.sources', type: 'list' }
  ];

  function renderChapterOverview(data) {
    return renderSectionedStudy(data, CHAPTER_SECTIONS,
      { book: bibleState.book.name, chapter: bibleState.chapter });
  }

  function renderBookOverview(data) {
    return renderSectionedStudy(data, BOOK_SECTIONS, { book: bibleState.book.name });
  }

  /* Shared accordion for the chapter and book studies: each configured
     section becomes a collapsible panel, the first non-empty one open.
     Returns null when none of the rich keys are present, so callers can
     fall back to an older, simpler reply shape. */
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
    var openFirst = true;
    sections.forEach(function (d) {
      if (d.type === 'archaeology') {
        if (archScope) wrap.appendChild(buildArchaeologyPanel(d, archScope));
        return;
      }
      if (d.type === 'geography') {
        if (archScope) wrap.appendChild(buildGeographyPanel(d, archScope));
        return;
      }
      if (d.type === 'timeline') {
        if (archScope) wrap.appendChild(buildTimelinePanel(d, archScope));
        return;
      }
      var content = buildStudySection(d, data[d.key]);
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
     row so the section stays scannable; the answer may hold a few paragraphs. */
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
      det.appendChild(body);
      wrap.appendChild(det);
    });
    return wrap.children.length ? wrap : null;
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
        body.textContent = '';
        var rich = renderChapterOverview(data);
        if (rich) { body.appendChild(rich); return; }
        // fall back to the older overview / points-to-Christ / background layout
        renderInsight(body, [
          { key: 'bible.overview', text: data && data.overview },
          { key: 'bible.pointsToChrist', text: data && data.christ },
          { key: 'bible.background', text: data && data.history }
        ], 'bible.guideUnavailable');
      })
      .catch(function (err) {
        chapterGuideKey = null; // allow a retry on the next open
        body.textContent = '';
        body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

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

    body.textContent = '';
    body.appendChild(txt('p', 'verse-panel-note', t('bible.bookBusy')));

    requestCached('book-insight', { book: bibleState.book.name })
      .then(function (data) {
        if (bookGuideKey !== key) return;
        body.textContent = '';
        var rich = renderBookOverview(data);
        if (rich) { body.appendChild(rich); return; }
        renderInsight(body, [
          { key: 'bible.bookAbout', text: data && data.overview },
          { key: 'bible.pointsToChrist', text: data && data.christ },
          { key: 'bible.bookBackground', text: data && data.history }
        ], 'bible.bookUnavailable');
      })
      .catch(function (err) {
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
  var focusKeys = { context: null, chapter: null, book: null };

  function resetFocusDetails() {
    ['verse-focus-context', 'verse-focus-chapter', 'verse-focus-book'].forEach(function (id) {
      var d = document.getElementById(id);
      if (d) d.open = false;
    });
    ['verse-focus-context-body', 'verse-focus-chapter-body', 'verse-focus-book-body'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.textContent = '';
    });
    focusKeys = { context: null, chapter: null, book: null };
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
        body.appendChild(node || txt('p', 'verse-panel-note', t('bible.sectionUnavailable')));
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
        if (rich) { body.textContent = ''; body.appendChild(rich); return; }
        renderInsight(body, [
          { key: 'bible.overview', text: data && data.overview },
          { key: 'bible.pointsToChrist', text: data && data.christ },
          { key: 'bible.background', text: data && data.history }
        ], 'bible.guideUnavailable');
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
    body.textContent = '';
    body.appendChild(txt('p', 'verse-panel-note', t('bible.bookBusy')));
    requestCached('book-insight', { book: bibleState.book.name })
      .then(function (data) {
        if (focusKeys.book !== key) return;
        var rich = renderBookOverview(data);
        if (rich) { body.textContent = ''; body.appendChild(rich); return; }
        renderInsight(body, [
          { key: 'bible.bookAbout', text: data && data.overview },
          { key: 'bible.pointsToChrist', text: data && data.christ },
          { key: 'bible.bookBackground', text: data && data.history }
        ], 'bible.bookUnavailable');
      })
      .catch(function (err) {
        if (focusKeys.book !== key) return;
        focusKeys.book = null;
        body.textContent = '';
        body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

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

  var PLANS = [
    { id: 'newbeliever', labelKey: 'plans.newBeliever', hintKey: 'plans.newBelieverHint',
      build: function () { return NEW_BELIEVER_READINGS.map(function (r) { return [{ book: r[0], chapter: r[1] }]; }); } },
    { id: 'year', labelKey: 'plans.year', hintKey: 'plans.yearHint',
      build: function () { return chunkInto(canonList(), 365); } },
    { id: 'chrono', labelKey: 'plans.chrono', hintKey: 'plans.chronoHint',
      build: function () { return chunkInto(orderedList(CHRONO_ORDER), 365); } },
    { id: 'book', labelKey: 'plans.book', hintKey: 'plans.bookHint', book: true }
  ];

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
  }

  function renderPlans() {
    var grid = document.getElementById('plans-grid');
    if (!grid) return;
    grid.textContent = '';

    PLANS.forEach(function (plan) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'feature-card';
      card.appendChild(txt('span', 'feature-label', t(plan.labelKey)));

      var hint = t(plan.hintKey);
      if (!plan.book) hint += ' · ' + t('plans.dayCount', { n: plan.build().length });
      card.appendChild(txt('span', 'feature-hint', hint));

      card.addEventListener('click', function () { openPlan(plan); });
      grid.appendChild(card);
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
    document.getElementById('plan-detail-title').textContent = t(plan.labelKey);
    // the new-believer plan carries a note on which translation to start with
    var note = document.getElementById('plan-note');
    if (note) {
      if (plan.id === 'newbeliever') { note.textContent = t('plans.newBelieverNote'); note.hidden = false; }
      else { note.hidden = true; note.textContent = ''; }
    }
    document.getElementById('plan-book-field').hidden = !plan.book;
    if (plan.book) fillPlanBookSelect();
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
    warmOnIntent(level, function () { requestCached('evangelism-prep', { scenario: q }); });
    return level;
  }

  function loadApoloAnswer(body, id, q, level) {
    body.textContent = '';
    body.appendChild(txt('p', 'verse-panel-note', t('apologetics.preparing')));
    requestCached('evangelism-prep', { scenario: q })
      .then(function (data) {
        body.textContent = '';
        body.appendChild(txt('div', 'road-station-answer prose', cleanAIText(((data && data.prep) || '').trim())));
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
    for (var i = 1; i <= 5; i++) dots.appendChild(el('span', 'apologist-dot' + (i <= lvl ? ' is-on' : '')));
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

  var TIP_IDS = ['t1', 'trans', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];

  function renderTips() {
    var list = document.getElementById('tips-list');
    if (!list) return;
    list.textContent = '';
    TIP_IDS.forEach(function (id, i) {
      var card = el('article', 'tip-card');
      card.appendChild(txt('span', 'tip-num', String(i + 1)));
      var body = el('div', 'tip-body');
      body.appendChild(txt('h3', 'tip-title', t('tips.' + id + '.title')));
      body.appendChild(txt('p', 'tip-text', t('tips.' + id + '.body')));
      card.appendChild(body);
      list.appendChild(card);
    });
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

  /* 100 general badges, generated so the how-to text stays in step with the data:
     one per Bible book (66) plus reading, streak, testament and plan milestones. */
  function buildGeneralBadges() {
    var list = [];
    BIBLE_BOOKS.forEach(function (g) {
      g.books.forEach(function (b) {
        (function (book) {
          list.push({
            id: 'book:' + book.name, cat: 'Books', icon: '📗',
            title: 'Finished ' + book.name,
            desc: 'Read all ' + book.chapters + ' chapter' + (book.chapters > 1 ? 's' : '') + ' of ' + book.name,
            test: function (p) {
              for (var c = 1; c <= book.chapters; c++) { if (!p.chapters[book.name + '|' + c]) return false; }
              return true;
            }
          });
        })(b);
      });
    });
    [1, 5, 10, 25, 50, 100, 150, 250, 400, 600, 900, 1189].forEach(function (n) {
      list.push({
        id: 'chap:' + n, cat: 'Reading', icon: '📖',
        title: n === 1 ? 'First chapter' : ('Read ' + n + ' chapters'),
        desc: 'Read a total of ' + n + ' chapter' + (n > 1 ? 's' : ''),
        test: (function (need) { return function (p) { return chapterCount(p) >= need; }; })(n)
      });
    });
    [2, 3, 7, 14, 30, 50, 100, 200, 365].forEach(function (n) {
      list.push({
        id: 'streak:' + n, cat: 'Streaks', icon: '🔥',
        title: n + '-day streak', desc: 'Read on ' + n + ' days in a row',
        test: (function (need) { return function (p) { return p.longest >= need; }; })(n)
      });
    });
    [10, 30, 100, 365].forEach(function (n) {
      list.push({
        id: 'days:' + n, cat: 'Streaks', icon: '📅',
        title: n + ' days in the Word', desc: 'Read on ' + n + ' separate days',
        test: (function (need) { return function (p) { return p.daysActive >= need; }; })(n)
      });
    });
    list.push({ id: 'ot', cat: 'Milestones', icon: '📜', title: 'Old Testament complete', desc: 'Read every chapter of all 39 Old Testament books', test: function (p) { return testamentComplete(p, 0); } });
    list.push({ id: 'nt', cat: 'Milestones', icon: '✝', title: 'New Testament complete', desc: 'Read every chapter of all 27 New Testament books', test: function (p) { return testamentComplete(p, 1); } });
    list.push({ id: 'whole', cat: 'Milestones', icon: '👑', title: 'The whole Bible', desc: 'Read every chapter of all 66 books', test: function (p) { return testamentComplete(p, 0) && testamentComplete(p, 1); } });
    list.push({ id: 'planday1', cat: 'Plans', icon: '🧭', title: 'On the path', desc: 'Mark your first reading-plan day complete', test: function () { return totalPlanDays() >= 1; } });
    list.push({ id: 'planday7', cat: 'Plans', icon: '🗺️', title: 'One week in', desc: 'Complete 7 reading-plan days', test: function () { return totalPlanDays() >= 7; } });
    list.push({ id: 'planday30', cat: 'Plans', icon: '⛰️', title: 'A month of days', desc: 'Complete 30 reading-plan days', test: function () { return totalPlanDays() >= 30; } });
    list.push({ id: 'planday100', cat: 'Plans', icon: '🏔️', title: 'Centurion', desc: 'Complete 100 reading-plan days', test: function () { return totalPlanDays() >= 100; } });
    list.push({ id: 'bookplan', cat: 'Plans', icon: '🎓', title: 'Book finisher', desc: 'Complete a One-Book-at-a-Time plan', test: function () { return anyBookPlanComplete(); } });
    list.push({ id: 'yearplan', cat: 'Plans', icon: '🏆', title: 'The long road', desc: 'Complete the Bible-in-a-Year plan', test: function () { return planComplete('year', 365); } });
    return list;
  }

  var GENERAL_BADGES = buildGeneralBadges();

  function checkBadges() {
    var p = loadProgress();
    var fresh = [];
    GENERAL_BADGES.forEach(function (b) {
      if (!p.badges[b.id] && b.test(p)) { p.badges[b.id] = todayStr(); fresh.push(b); }
    });
    if (fresh.length) {
      saveProgress(p);
      fresh.forEach(function (b) {
        notify('badge', t('notif.badge.title'), t('notif.badge.body', { name: b.title }));
      });
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
  }

  function showToast(type, title, body) {
    var stack = document.getElementById('toast-stack');
    if (!stack) return;
    var toast = el('div', 'toast toast-' + type);
    toast.appendChild(txt('span', 'toast-icon', type === 'badge' ? '🏅' : '🔥'));
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
      item.appendChild(txt('span', 'notif-item-icon', n.type === 'badge' ? '🏅' : '🔥'));
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

  function renderProgressUI() {
    var p = loadProgress();
    document.querySelectorAll('.js-streak-count').forEach(function (n) { n.textContent = String(p.streak); });
    renderWalkWeek();
    renderWalkEncourage();
    renderExploreApoloTag();
    var days = document.getElementById('dash-days');
    if (days) days.textContent = String(p.daysActive);
    var chapters = document.getElementById('dash-chapters');
    if (chapters) chapters.textContent = String(chapterCount(p));

    var wrap = document.getElementById('badge-grid');
    if (!wrap) return;
    wrap.textContent = '';

    var earned = GENERAL_BADGES.filter(function (b) { return p.badges[b.id]; }).length;
    // the summary appears both as a home teaser and atop the Badges tab
    document.querySelectorAll('.js-badge-summary').forEach(function (summary) {
      summary.textContent = t('dash.badgesEarned', { done: earned, total: GENERAL_BADGES.length });
    });

    // group by category, keeping the order categories first appear
    var cats = [], byCat = {};
    GENERAL_BADGES.forEach(function (b) {
      if (!byCat[b.cat]) { byCat[b.cat] = []; cats.push(b.cat); }
      byCat[b.cat].push(b);
    });

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
      wrap.appendChild(group);
    });
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
      result.textContent = cleanAIText((data.devotional || '').trim());
    }
  });

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
          var node = buildCrossRefs((data && data.crossRefs) || []);
          forEl.textContent = t('crossref.for', { ref: loc.book + ' ' + loc.chapter + ':' + loc.verse });
          if (node) { list.appendChild(node); result.hidden = false; setStatus(status, '', false); }
          else { result.hidden = true; setStatus(status, t('crossref.none'), false); }
        })
        .catch(function (err) { result.hidden = true; setStatus(status, err.message, true); })
        .then(function () { btn.disabled = false; btn.textContent = t('crossref.submit'); });
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

  var COMMON_TERMS = [
    'Grace', 'Faith', 'Gospel', 'Covenant', 'Justification', 'Sanctification',
    'Atonement', 'Redemption', 'Repentance', 'Salvation', 'Trinity', 'Incarnation',
    'Righteousness', 'Mercy', 'Holiness', 'Resurrection', 'Kingdom of God', 'Messiah'
  ];
  function renderCommonTerms() {
    var wrap = document.getElementById('definitions-common');
    if (!wrap || wrap.dataset.built) return;
    wrap.dataset.built = '1';
    wrap.appendChild(txt('p', 'definitions-common-label', t('definitions.commonHeading')));
    var row = el('div', 'definitions-chips');
    COMMON_TERMS.forEach(function (term) {
      var b = txt('button', 'definitions-chip', term);
      b.type = 'button';
      b.addEventListener('click', function () {
        var input = document.getElementById('definitions-term');
        input.value = term;
        document.getElementById('definitions-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      });
      row.appendChild(b);
    });
    wrap.appendChild(row);
  }

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
    { era: 'The Life of Jesus', dates: 'c. 5 BC–30 AD', events: [
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

  /* ---------- start ---------- */

  applyTheme(currentTheme());   // the <head> set the attribute; this syncs the toggle + storage
  resetBibleBrowser();
  renderVersionOptions();
  wireSettings();
  bibleAudio.wire();
  initPush();
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
