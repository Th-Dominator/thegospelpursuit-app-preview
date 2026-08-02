(function () {
  'use strict';

  var rays = document.getElementById('rays');
  var loadingScreen = document.getElementById('loading-screen');
  var authScreen = document.getElementById('auth-screen');
  var appShell = document.getElementById('app-shell');
  var enterBtn = document.getElementById('enter-app');
  var cta = enterBtn.closest('.brand-cta');

  /* ---------- language ---------- */

  var LANG_KEY = 'tgp.language';
  var DEFAULT_LANG = 'en';
  // resolved up front: sign-in loads before the app shell exists, and Clerk
  // needs to know which locale to fetch
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

  // a saved choice wins; otherwise fall back to the browser's own preference
  function initialLanguage() {
    try {
      var saved = window.localStorage.getItem(LANG_KEY);
      if (saved && isSupported(saved)) return saved;
    } catch (err) {
      /* storage blocked — carry on with the browser hint */
    }
    var hints = (navigator.languages || [navigator.language || '']);
    for (var i = 0; i < hints.length; i++) {
      var base = String(hints[i]).toLowerCase().split('-')[0];
      if (isSupported(base)) return base;
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
    document.documentElement.lang = currentLang;
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
    if (!isSupported(code)) return;
    var changed = code !== currentLang;
    currentLang = code;

    try {
      window.localStorage.setItem(LANG_KEY, code);
    } catch (err) {
      /* the choice still holds for this page view */
    }

    applyTranslations();

    if (announce) {
      setStatus(document.getElementById('language-status'), t('language.saved', { name: languageMeta(code).native }), false);
    }
    // results already on screen are in the old language; ask for them again
    if (changed && !appShell.hidden) {
      clearResults();
      loadDailyVerse();
    }
  }

  function clearResults() {
    ['search-result', 'devotional-result', 'evangelism-result'].forEach(function (id) {
      document.getElementById(id).hidden = true;
    });
    ['search-status', 'devotional-status', 'evangelism-status'].forEach(function (id) {
      setStatus(document.getElementById(id), '', false);
    });
  }

  /* ---------- loading screen ---------- */

  // the button is only offered once its fade-up has finished playing
  cta.addEventListener('animationend', function () {
    enterBtn.disabled = false;
  });

  enterBtn.addEventListener('click', function () {
    loadingScreen.hidden = true;
    // a session Clerk already restored skips the form entirely
    if (TGPAuth.user()) openApp();
    else showAuthScreen();
  });

  /* ---------- sign in ---------- */

  var authStatus = document.getElementById('auth-status');
  var clerkMount = document.getElementById('clerk-signin');

  /* Started during the intro animation so Clerk has finished loading by the time
     anyone reaches for Get Started. The locale is fixed here because the language
     picker lives behind sign-in — nobody can change it from this screen. */
  var authReady = TGPAuth.init({ language: currentLang });
  authReady.catch(function (err) {
    if (window.console) window.console.error('[auth]', err.message);
  });

  function showAuthScreen(message) {
    rays.hidden = false;
    authScreen.hidden = false;
    setStatus(authStatus, message || t('auth.loading'), false);

    authReady.then(
      function () {
        if (TGPAuth.user()) {
          openApp();
          return;
        }
        setStatus(authStatus, message || '', false);
        clerkMount.classList.remove('is-empty');
        TGPAuth.mountSignIn(clerkMount);
      },
      function () {
        clerkMount.classList.add('is-empty');
        setStatus(
          authStatus,
          TGPAuth.isConfigured() ? t('auth.unavailable') : t('auth.notConfigured'),
          true
        );
      }
    );
  }

  /* ---------- entering and leaving the app ---------- */

  var appOpen = false;

  function openApp() {
    var account = TGPAuth.user();
    document.getElementById('account-email').textContent = account ? account.email : '';
    if (appOpen) return;

    appOpen = true;
    TGPAuth.unmountSignIn();
    authScreen.hidden = true;
    rays.hidden = true;
    appShell.hidden = false;
    loadDailyVerse();
  }

  function closeApp() {
    if (!appOpen) return;
    appOpen = false;
    closeSidebar();
    clearResults();
    appShell.hidden = true;
    showAuthScreen(t('auth.signedOut'));
  }

  /* Clerk signs people in out of band too — an OAuth or email-link round trip
     lands back here with a live session and no form submission to react to. */
  TGPAuth.onChange(function (account) {
    if (account && !authScreen.hidden) openApp();
    else if (!account) closeApp();
  });

  document.getElementById('sign-out').addEventListener('click', function () {
    TGPAuth.signOut().then(closeApp, closeApp);
  });

  /* ---------- view routing ---------- */

  function showView(name) {
    document.querySelectorAll('.view').forEach(function (section) {
      section.classList.toggle('is-active', section.id === 'view-' + name);
    });
    document.querySelectorAll('.nav-link').forEach(function (link) {
      link.classList.toggle('is-active', link.dataset.view === name);
    });
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

  // every call carries the chosen language so the backend answers in it
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

  /* ---------- tool forms ---------- */

  // kept so a language change can relabel buttons that aren't mid-request
  var wiredForms = [];

  function wireForm(options) {
    var form = document.getElementById(options.formId);
    var input = document.getElementById(options.inputId);
    var result = document.getElementById(options.resultId);
    var status = document.getElementById(options.statusId);
    var button = form.querySelector('button');
    var busy = false;

    wiredForms.push({
      relabel: function () {
        if (!busy) button.textContent = t(options.submitKey);
      }
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (!value) return;

      busy = true;
      button.disabled = true;
      button.textContent = t(options.busyKey);
      setStatus(status, t(options.busyStatusKey), false);

      var payload = {};
      payload[options.field] = value;

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

  function retranslateForms() {
    wiredForms.forEach(function (entry) {
      entry.relabel();
    });
  }

  wireForm({
    formId: 'search-form',
    inputId: 'search-query',
    resultId: 'search-result',
    statusId: 'search-status',
    path: 'search-scripture',
    field: 'query',
    submitKey: 'search.submit',
    busyKey: 'search.busy',
    busyStatusKey: 'search.busyStatus',
    render: function (data) {
      document.getElementById('search-text').textContent = (data.text || '').trim();
      document.getElementById('search-ref').textContent = data.reference || '';
    }
  });

  wireForm({
    formId: 'devotional-form',
    inputId: 'devotional-topic',
    resultId: 'devotional-result',
    statusId: 'devotional-status',
    path: 'generate-devotional',
    field: 'topic',
    submitKey: 'devotional.submit',
    busyKey: 'devotional.busy',
    busyStatusKey: 'devotional.busyStatus',
    render: function (data, result) {
      result.textContent = (data.devotional || '').trim();
    }
  });

  wireForm({
    formId: 'evangelism-form',
    inputId: 'evangelism-scenario',
    resultId: 'evangelism-result',
    statusId: 'evangelism-status',
    path: 'evangelism-prep',
    field: 'scenario',
    submitKey: 'evangelism.submit',
    busyKey: 'evangelism.busy',
    busyStatusKey: 'evangelism.busyStatus',
    render: function (data, result) {
      result.textContent = (data.prep || '').trim();
    }
  });

  /* ---------- start ---------- */

  // runs last so applyTranslations() can reach every wired form and control
  applyTranslations();
})();
