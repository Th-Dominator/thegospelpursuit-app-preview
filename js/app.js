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

  /* ---------- bible plans ---------- */

  /* Also a placeholder: GET /plans will serve these with real day counts, and
     progress needs the account behind it, so nothing is clickable yet. */
  var PLANS = [
    { id: 'gospels', label: 'The Gospels', hint: '40 days' },
    { id: 'psalms', label: 'Psalms and Proverbs', hint: '60 days' },
    { id: 'nt', label: 'The New Testament', hint: '90 days' },
    { id: 'year', label: 'The Whole Bible', hint: '365 days' }
  ];

  function renderPlans() {
    var grid = document.getElementById('plans-grid');
    grid.textContent = '';

    PLANS.forEach(function (plan) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'feature-card';
      card.disabled = true;

      var label = document.createElement('span');
      label.className = 'feature-label';
      label.textContent = plan.label;
      card.appendChild(label);

      var hint = document.createElement('span');
      hint.className = 'feature-hint';
      hint.textContent = plan.hint + ' · ' + t('home.comingSoon');
      card.appendChild(hint);

      grid.appendChild(card);
    });

    setStatus(document.getElementById('plans-status'), t('plans.unavailable'), false);
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
