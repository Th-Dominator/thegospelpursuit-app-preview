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
    'setting-apologetics-tone': { name: 'apologeticsTone', fallback: 'gentle' }
  };

  // on/off preferences (boolean-valued)
  var TOGGLE_FIELDS = {
    'setting-red-letters': { name: 'redLetters', fallback: false },
    'setting-verse-picker': { name: 'showVersePicker', fallback: true },
    'setting-progress-bar': { name: 'showProgressBar', fallback: true }
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
    if (name === 'version') {
      renderVersionOptions();
      if (bibleState.screen === 'reader') loadChapter();
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
    // entering Bible plans always starts at the plan chooser
    if (name === 'plans') showPlansScreen('grid');
    // keep the fixed progress bar from lingering over other views
    applyReadingPrefs();
    closeSidebar();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('.nav-link, .feature-card').forEach(function (el) {
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

  /* ---------- verse of the day ---------- */

  function renderVerse(text, reference) {
    var quote = document.getElementById('verse-quote');
    var trimmed = (text || '').trim();
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

  /* Which screen of the browser is showing, and the path taken to it. */
  var bibleState = { screen: 'testaments', testament: 0, book: null, chapter: 1 };

  var bibleScreens = {
    testaments: document.getElementById('bible-screen-testaments'),
    books: document.getElementById('bible-screen-books'),
    chapters: document.getElementById('bible-screen-chapters'),
    reader: document.getElementById('bible-screen-reader')
  };

  function showBibleScreen(name) {
    bibleState.screen = name;
    Object.keys(bibleScreens).forEach(function (key) {
      bibleScreens[key].hidden = key !== name;
    });
    // the testaments screen is the root, so it carries no back button
    document.getElementById('bible-crumbs').hidden = name === 'testaments';
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
    if (bibleState.screen === 'reader') {
      parts.push(t('bible.chapter') + ' ' + bibleState.chapter);
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
    var grid = bibleScreens.chapters;
    grid.textContent = '';
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
        } else {
          // an empty 200 means the reader endpoint isn't wired yet
          setStatus(status, t('bible.unavailable'), false);
        }
      })
      .catch(function (err) {
        list.textContent = '';
        setStatus(status, err.message, true);
      });
  }

  function renderVerses(verses) {
    var list = document.getElementById('bible-verses');
    list.textContent = '';
    verses.forEach(function (verse) {
      list.appendChild(buildVerseCard(verse));
    });
    populateVersePicker(verses);
    applyReadingPrefs();
    // let the new cards lay out before the progress bar measures them
    if (window.requestAnimationFrame) window.requestAnimationFrame(updateReadingProgress);
  }

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
    head.appendChild(txt('span', 'verse-num', verse.number));
    head.appendChild(txt('p', 'verse-body', verse.text));
    card.appendChild(head);

    var actions = el('div', 'verse-actions');
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

  // --- context & resources: generated per verse by the backend ---
  function fillContextPanel(panel, verse) {
    fetchInto(panel, 'verse-context', verse, {}, function (data) {
      var text = ((data && (data.context || data.text)) || '').trim();
      return text ? txt('p', 'verse-prose', text) : null;
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

    request(path, body)
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
    if (bibleState.screen === 'reader') {
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

  // rebuilt on a language change so the labels and breadcrumb follow the UI
  function renderBibleBrowser() {
    renderTestamentCards();
    renderVersionOptions();
    if (bibleState.screen === 'books') renderBookGrid();
    else if (bibleState.screen === 'chapters') renderChapterGrid();
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

    request('chapter-insight', { book: bibleState.book.name, chapter: bibleState.chapter })
      .then(function (data) {
        // a late reply for a chapter we've since left shouldn't overwrite the new one
        if (chapterGuideKey !== key) return;
        body.textContent = '';
        var sections = [
          { key: 'bible.overview', text: data && data.overview },
          { key: 'bible.pointsToChrist', text: data && data.christ },
          { key: 'bible.background', text: data && data.history }
        ];
        var any = false;
        sections.forEach(function (s) {
          var text = (s.text || '').trim();
          if (!text) return;
          any = true;
          body.appendChild(txt('h4', 'chapter-guide-heading', t(s.key)));
          body.appendChild(txt('p', 'chapter-guide-text', text));
        });
        if (!any) body.appendChild(txt('p', 'verse-panel-note', t('bible.guideUnavailable')));
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

  var PLANS = [
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

  /* ---------- the road to apologetics (a journey) ---------- */

  /* Ten stations, roughly in the order a seeker meets them. The visible title is
     a key so it translates; the question sent to the backend stays in English —
     Claude still answers in the user's language, which rides along on every call. */
  var APOLO_STATIONS = [
    { id: 'exist', title: 'apologetics.st1.title', q: 'Does God exist? Give the strongest reasons to believe God is real.' },
    { id: 'bible', title: 'apologetics.st2.title', q: 'Can I trust the Bible? Is it historically reliable and has it been changed over time?' },
    { id: 'jesus', title: 'apologetics.st3.title', q: 'Who is Jesus, really? Was he only a good teacher, or the Son of God?' },
    { id: 'resurrection', title: 'apologetics.st4.title', q: 'Did Jesus really rise from the dead? What is the historical evidence?' },
    { id: 'suffering', title: 'apologetics.st5.title', q: 'If God is good and all-powerful, why is there so much suffering and evil in the world?' },
    { id: 'faith', title: 'apologetics.st6.title', q: 'Isn’t faith just blind belief with no evidence?' },
    { id: 'religions', title: 'apologetics.st7.title', q: 'Aren’t all religions basically the same and equally valid paths to God?' },
    { id: 'science', title: 'apologetics.st8.title', q: 'Doesn’t science, especially evolution, disprove God and the Bible?' },
    { id: 'onlyway', title: 'apologetics.st9.title', q: 'Why do Christians claim Jesus is the only way to God? Isn’t that arrogant and exclusive?' },
    { id: 'share', title: 'apologetics.st10.title', q: 'How do I share my faith with a friend in a natural, loving, non-pushy way?' }
  ];

  var APOLO_RANKS = ['apologetics.rankSeeker', 'apologetics.rankStudent', 'apologetics.rankDefender', 'apologetics.rankApologist', 'apologetics.rankAmbassador'];
  var APOLO_KEY = 'tgp.apologetics';

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
  function markStationDone(id) {
    var s = loadApolo();
    if (s.done.indexOf(id) === -1) s.done.push(id);
    saveApolo(s);
  }

  function renderApologetics() {
    var road = document.getElementById('apologetics-road');
    if (!road) return;
    road.textContent = '';

    var doneSet = apoloDoneSet();
    var total = APOLO_STATIONS.length;
    var doneCount = APOLO_STATIONS.filter(function (s) { return doneSet[s.id]; }).length;
    var rankIdx = doneCount <= 1 ? 0 : doneCount <= 3 ? 1 : doneCount <= 5 ? 2 : doneCount <= 8 ? 3 : 4;

    document.getElementById('road-rank').textContent = t(APOLO_RANKS[rankIdx]);
    document.getElementById('road-level').textContent = t('apologetics.levelLabel', { n: doneCount });
    document.getElementById('road-xp').textContent = t('apologetics.xpLabel', { n: doneCount * 100 });
    document.getElementById('road-progress-fill').style.width = (doneCount / total * 100).toFixed(0) + '%';
    document.getElementById('road-stations').textContent = (doneCount === total)
      ? t('apologetics.complete')
      : t('apologetics.stationsDone', { done: doneCount, total: total });

    APOLO_STATIONS.forEach(function (station, index) {
      var done = !!doneSet[station.id];
      var unlocked = index === 0 || !!doneSet[APOLO_STATIONS[index - 1].id];
      road.appendChild(buildStation(station, index, done, unlocked));
    });
  }

  function buildStation(station, index, done, unlocked) {
    var card = el('article', 'road-station' +
      (done ? ' is-done' : '') +
      (!unlocked ? ' is-locked' : '') +
      (unlocked && !done ? ' is-current' : ''));

    var head = el('div', 'road-station-head');
    head.appendChild(txt('span', 'road-station-num', done ? '✓' : (unlocked ? String(index + 1) : '🔒')));

    var titles = el('div', 'road-station-titles');
    titles.appendChild(txt('p', 'road-station-title', t(station.title)));
    var status = done ? t('apologetics.stageDone')
                      : unlocked ? (index === 0 ? t('apologetics.startHere') : '')
                                 : t('apologetics.locked');
    if (status) titles.appendChild(txt('p', 'road-station-status', status));
    head.appendChild(titles);
    card.appendChild(head);

    if (!unlocked) {
      card.appendChild(txt('p', 'road-station-lockhint', t('apologetics.lockedHint')));
      return card;
    }

    var details = el('details', 'road-station-details');
    var summary = el('summary', 'road-station-toggle');
    summary.textContent = t('apologetics.prepare');
    details.appendChild(summary);
    var body = el('div', 'road-station-body');
    details.appendChild(body);

    var loaded = false;
    details.addEventListener('toggle', function () {
      if (details.open && !loaded) { loaded = true; loadStationAnswer(body, station); }
    });

    card.appendChild(details);
    return card;
  }

  function loadStationAnswer(body, station) {
    body.textContent = '';
    body.appendChild(txt('p', 'verse-panel-note', t('apologetics.preparing')));
    request('evangelism-prep', { scenario: station.q })
      .then(function (data) {
        body.textContent = '';
        body.appendChild(txt('div', 'road-station-answer prose', ((data && data.prep) || '').trim()));
        if (apoloDoneSet()[station.id]) return;
        var btn = txt('button', 'verse-panel-btn', t('apologetics.markComplete'));
        btn.type = 'button';
        btn.addEventListener('click', function () {
          markStationDone(station.id);
          renderApologetics();
          // clearing a stage counts toward the streak and can unlock badges
          recordActivity();
          checkBadges();
          renderProgressUI();
        });
        body.appendChild(btn);
      })
      .catch(function (err) {
        body.textContent = '';
        body.appendChild(txt('p', 'verse-panel-note is-error', err.message));
      });
  }

  document.getElementById('apologetics-reset').addEventListener('click', function () {
    if (!window.confirm(t('apologetics.resetConfirm'))) return;
    saveApolo({ done: [] });
    renderApologetics();
  });

  /* ---------- tips for new believers ---------- */

  var TIP_IDS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];

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
  function anyBookComplete(p) {
    var done = false;
    BIBLE_BOOKS.forEach(function (g) {
      g.books.forEach(function (b) {
        var all = true;
        for (var c = 1; c <= b.chapters; c++) { if (!p.chapters[b.name + '|' + c]) { all = false; break; } }
        if (all) done = true;
      });
    });
    return done;
  }
  function anyPlanDayDone() {
    var prog = loadPlanProgress();
    for (var k in prog) {
      if (k === 'bookPlan') continue;
      var d = prog[k] && prog[k].done;
      for (var i in (d || {})) { if (d[i]) return true; }
    }
    return false;
  }

  var BADGES = [
    { id: 'firstChapter', icon: '📖', test: function (p) { return chapterCount(p) >= 1; } },
    { id: 'chapters10', icon: '📚', test: function (p) { return chapterCount(p) >= 10; } },
    { id: 'chapters50', icon: '🏛️', test: function (p) { return chapterCount(p) >= 50; } },
    { id: 'streak3', icon: '✨', test: function (p) { return p.longest >= 3; } },
    { id: 'streak7', icon: '🔥', test: function (p) { return p.longest >= 7; } },
    { id: 'streak30', icon: '👑', test: function (p) { return p.longest >= 30; } },
    { id: 'bookDone', icon: '🎓', test: function (p) { return anyBookComplete(p); } },
    { id: 'planDay', icon: '🧭', test: function () { return anyPlanDayDone(); } },
    { id: 'apolo1', icon: '🛡️', test: function () { return loadApolo().done.length >= 1; } },
    { id: 'apoloAll', icon: '☩', test: function () { return loadApolo().done.length >= APOLO_STATIONS.length; } }
  ];

  function checkBadges() {
    var p = loadProgress();
    var fresh = [];
    BADGES.forEach(function (b) {
      if (!p.badges[b.id] && b.test(p)) { p.badges[b.id] = todayStr(); fresh.push(b); }
    });
    if (fresh.length) {
      saveProgress(p);
      fresh.forEach(function (b) {
        notify('badge', t('notif.badge.title'), t('notif.badge.body', { name: t('badge.' + b.id + '.title') }));
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
    var days = document.getElementById('dash-days');
    if (days) days.textContent = String(p.daysActive);
    var chapters = document.getElementById('dash-chapters');
    if (chapters) chapters.textContent = String(chapterCount(p));

    var grid = document.getElementById('badge-grid');
    if (grid) {
      grid.textContent = '';
      BADGES.forEach(function (b) {
        var earned = !!p.badges[b.id];
        var tile = el('div', 'badge' + (earned ? ' is-earned' : ' is-locked'));
        tile.appendChild(txt('span', 'badge-icon', earned ? b.icon : '🔒'));
        tile.appendChild(txt('span', 'badge-name', t('badge.' + b.id + '.title')));
        tile.appendChild(txt('span', 'badge-desc', earned ? t('badge.' + b.id + '.desc') : t('badge.locked')));
        grid.appendChild(tile);
      });
    }
  }

  // wire the bell + streak chips (there's one pair in the sidebar, one in the topbar)
  document.querySelectorAll('.js-notif-open').forEach(function (btn) {
    btn.addEventListener('click', openNotif);
  });
  document.querySelectorAll('.js-streak-open').forEach(function (btn) {
    btn.addEventListener('click', function () { showView('home'); });
  });
  document.getElementById('notif-close').addEventListener('click', closeNotif);
  document.getElementById('notif-scrim').addEventListener('click', closeNotif);
  document.getElementById('notif-clear').addEventListener('click', function () {
    var p = loadProgress();
    p.notifs = [];
    saveProgress(p);
    renderNotifList();
    renderNotifUI();
  });

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

  wireForm({
    formId: 'devotional-form',
    resultId: 'devotional-result',
    statusId: 'devotional-status',
    path: 'generate-devotional',
    submitKey: 'devotional.submit',
    busyKey: 'devotional.busy',
    busyStatusKey: 'devotional.busyStatus',
    collect: textField('devotional-topic', 'topic'),
    render: function (data, result) {
      result.textContent = (data.devotional || '').trim();
    }
  });

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
      result.textContent = (data.prep || '').trim();
    }
  });

  /* ---------- start ---------- */

  resetBibleBrowser();
  renderVersionOptions();
  wireSettings();
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
