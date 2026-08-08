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
    var text = (typeof val === 'string' ? val : '').trim();
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

    request('chapter-insight', { book: bibleState.book.name, chapter: bibleState.chapter })
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

    request('book-insight', { book: bibleState.book.name })
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
    request('verse-context', {
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
    request('chapter-insight', { book: bibleState.book.name, chapter: bibleState.chapter })
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
    request('book-insight', { book: bibleState.book.name })
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

  function renderApologetics() {
    var road = document.getElementById('apologetics-road');
    if (!road || typeof APOLO_THEMES === 'undefined') return;
    road.textContent = '';
    updateApoloHero();
    var set = apoloDoneSet();
    APOLO_THEMES.forEach(function (th, ti) {
      road.appendChild(buildApoloTheme(th, ti, set));
    });
  }

  function themeDoneCount(th, ti, set) {
    var n = 0;
    th.questions.forEach(function (q, qi) { if (set[apoloId(ti, qi)]) n++; });
    return n;
  }

  function buildApoloTheme(th, ti, set) {
    var done = themeDoneCount(th, ti, set);
    var full = done === th.questions.length;
    var chapter = el('details', 'apolo-theme' + (full ? ' is-complete' : ''));

    var head = el('summary', 'apolo-theme-head');
    head.appendChild(txt('span', 'apolo-theme-icon', th.icon || '☩'));
    var titles = el('span', 'apolo-theme-titles');
    titles.appendChild(txt('span', 'apolo-theme-name', th.theme));
    titles.appendChild(txt('span', 'apolo-theme-count', done + ' / ' + th.questions.length));
    head.appendChild(titles);
    chapter.appendChild(head);

    var body = el('div', 'apolo-theme-body');
    th.questions.forEach(function (q, qi) {
      body.appendChild(buildApoloTopic(apoloId(ti, qi), q, !!set[apoloId(ti, qi)]));
    });
    chapter.appendChild(body);
    return chapter;
  }

  function buildApoloTopic(id, q, prepared) {
    var topic = el('details', 'apolo-topic' + (prepared ? ' is-prepared' : ''));
    var head = el('summary', 'apolo-topic-head');
    head.appendChild(txt('span', 'apolo-topic-badge', prepared ? '🏅' : '🔒'));
    head.appendChild(txt('span', 'apolo-topic-q', q));
    topic.appendChild(head);

    var body = el('div', 'apolo-topic-body');
    topic.appendChild(body);

    var loaded = false;
    topic.addEventListener('toggle', function () {
      if (topic.open && !loaded) { loaded = true; loadApoloAnswer(body, id, q, topic); }
    });
    return topic;
  }

  function loadApoloAnswer(body, id, q, topic) {
    body.textContent = '';
    body.appendChild(txt('p', 'verse-panel-note', t('apologetics.preparing')));
    request('evangelism-prep', { scenario: q })
      .then(function (data) {
        body.textContent = '';
        body.appendChild(txt('div', 'road-station-answer prose', ((data && data.prep) || '').trim()));
        // preparing the answer earns this question's badge (once)
        if (apoloDoneSet()[id]) return;
        markApoloDone(id);
        topic.classList.add('is-prepared');
        var icon = topic.querySelector('.apolo-topic-badge');
        if (icon) icon.textContent = '🏅';
        // reflect the new count on the chapter header and the hero
        var chapter = topic.closest ? topic.closest('.apolo-theme') : null;
        if (chapter) {
          var ti = parseInt(id.slice(1).split('q')[0], 10);
          var th = APOLO_THEMES[ti];
          var set = apoloDoneSet();
          var td = themeDoneCount(th, ti, set);
          var cnt = chapter.querySelector('.apolo-theme-count');
          if (cnt) cnt.textContent = td + ' / ' + th.questions.length;
          if (td === th.questions.length) chapter.classList.add('is-complete');
        }
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
    var days = document.getElementById('dash-days');
    if (days) days.textContent = String(p.daysActive);
    var chapters = document.getElementById('dash-chapters');
    if (chapters) chapters.textContent = String(chapterCount(p));

    var wrap = document.getElementById('badge-grid');
    if (!wrap) return;
    wrap.textContent = '';

    var earned = GENERAL_BADGES.filter(function (b) { return p.badges[b.id]; }).length;
    var summary = document.getElementById('badge-summary');
    if (summary) summary.textContent = t('dash.badgesEarned', { done: earned, total: GENERAL_BADGES.length });

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
