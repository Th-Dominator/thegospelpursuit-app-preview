/* Clerk-backed sign in.

   Everything Clerk needs is public: the publishable key in config.js identifies
   the instance, and the SDK is fetched from that instance's own host. No secret
   ever reaches the browser, which is what makes this safe on a static site. */

var TGPAuth = (function () {
  'use strict';

  /* Since clerk-js v6 the prebuilt components live in their own bundle, which has
     to be in place before the core script loads. Localizations v4 is the line that
     pairs with clerk-js v6. */
  var CLERK_UI_SRC = '/npm/@clerk/ui@1/dist/ui.browser.js';
  var CLERK_JS_SRC = '/npm/@clerk/clerk-js@6/dist/clerk.browser.js';
  var LOCALIZATIONS_URL = 'https://cdn.jsdelivr.net/npm/@clerk/localizations@4/+esm';

  /* our language codes -> the locale bundle Clerk publishes for each one.
     English is Clerk's default, so it isn't listed. */
  var CLERK_LOCALES = {
    es: 'esES',
    fr: 'frFR',
    de: 'deDE',
    it: 'itIT',
    pt: 'ptBR',
    ko: 'koKR',
    zh: 'zhCN'
  };

  /* Clerk draws the form; the card around it is already ours, so most of this
     is switching off the chrome we'd otherwise be showing twice. */
  var APPEARANCE = {
    variables: {
      colorPrimary: '#7C5C34',
      colorText: '#232B36',
      colorTextSecondary: '#5B6472',
      colorBackground: 'transparent',
      colorInputBackground: '#FFFFFF',
      colorInputText: '#232B36',
      colorDanger: '#A3352A',
      borderRadius: '10px',
      fontFamily: "'Inter', sans-serif",
      fontSize: '15px'
    },
    elements: {
      rootBox: { width: '100%' },
      cardBox: { width: '100%', boxShadow: 'none', border: 'none' },
      card: { background: 'transparent', boxShadow: 'none', border: 'none', padding: '0' },
      header: { display: 'none' },
      footer: { background: 'transparent', marginTop: '4px' },
      footerAction: { justifyContent: 'center' },
      formFieldInput: { borderColor: '#E3DDCE' },
      dividerLine: { background: '#E3DDCE' },
      socialButtonsBlockButton: { borderColor: '#E3DDCE' },
      formButtonPrimary: {
        background: '#232B36',
        fontFamily: "'Inter', sans-serif",
        fontSize: '14px',
        fontWeight: '600',
        textTransform: 'none',
        letterSpacing: '0',
        boxShadow: 'none',
        '&:hover': { background: '#7C5C34' },
        '&:focus': { background: '#7C5C34' }
      }
    }
  };

  var clerk = null;
  var ready = null;
  var mountedOn = null;
  var listeners = [];

  function publishableKey() {
    var key = (typeof CLERK_PUBLISHABLE_KEY === 'string') ? CLERK_PUBLISHABLE_KEY : '';
    return key.trim();
  }

  function isConfigured() {
    return /^pk_(test|live)_./.test(publishableKey());
  }

  /* A publishable key is base64 of "<frontend-api-host>$", so the host serving a
     version-matched SDK is carried inside the key itself — nothing else to configure. */
  function frontendApi(key) {
    var decoded = window.atob(key.replace(/^pk_(test|live)_/, ''));
    return decoded.replace(/\$+$/, '');
  }

  function loadScript(src, attributes) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.crossOrigin = 'anonymous';
      Object.keys(attributes || {}).forEach(function (name) {
        script.setAttribute(name, attributes[name]);
      });
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(script);
    });
  }

  // sequential, not parallel: the core script expects the component bundle to exist
  function loadSdk(key) {
    var origin = 'https://' + frontendApi(key);
    return loadScript(origin + CLERK_UI_SRC).then(function () {
      return loadScript(origin + CLERK_JS_SRC, { 'data-clerk-publishable-key': key });
    });
  }

  /* A locale that won't download just leaves the form in English, which is a
     far better outcome than no sign-in at all. */
  function loadLocalization(language) {
    var name = CLERK_LOCALES[language];
    if (!name) return Promise.resolve(undefined);
    return import(LOCALIZATIONS_URL).then(
      function (bundle) { return bundle[name]; },
      function () { return undefined; }
    );
  }

  // OAuth and email links leave the page and come back; send them back here
  function pageUrl() {
    return window.location.origin + window.location.pathname;
  }

  function emit() {
    var current = user();
    listeners.forEach(function (fn) { fn(current); });
  }

  /* Safe to call repeatedly — the first call owns the load, later ones await it. */
  function init(options) {
    if (ready) return ready;
    if (!isConfigured()) {
      ready = Promise.reject(new Error('Clerk publishable key is not set in js/config.js'));
      return ready;
    }

    var key = publishableKey();
    ready = loadSdk(key)
      .then(function () {
        return loadLocalization(options && options.language);
      })
      .then(function (localization) {
        clerk = window.Clerk;
        if (!clerk) throw new Error('Clerk SDK loaded but did not initialise');

        var settings = { localization: localization, appearance: APPEARANCE };
        // how the core script is handed the separately-bundled components
        if (window.__internal_ClerkUICtor) {
          settings.ui = { ClerkUI: window.__internal_ClerkUICtor };
        }
        return clerk.load(settings);
      })
      .then(function () {
        clerk.addListener(emit);
        return clerk;
      });

    return ready;
  }

  function user() {
    if (!clerk || !clerk.user) return null;
    var account = clerk.user;
    var primary = account.primaryEmailAddress ||
      (account.emailAddresses && account.emailAddresses[0]);
    return {
      id: account.id,
      email: (primary && primary.emailAddress) || '',
      firstName: account.firstName || ''
    };
  }

  function mountSignIn(el) {
    if (!clerk || !el) return;
    unmountSignIn();
    clerk.mountSignIn(el, {
      // virtual routing keeps every step on this page: a static host has no
      // /sign-in/* paths to serve, so URL-based routing would 404 mid-flow
      routing: 'virtual',
      appearance: APPEARANCE,
      fallbackRedirectUrl: pageUrl(),
      signUpFallbackRedirectUrl: pageUrl()
    });
    mountedOn = el;
  }

  function unmountSignIn() {
    if (clerk && mountedOn) {
      clerk.unmountSignIn(mountedOn);
      mountedOn = null;
    }
  }

  function signOut() {
    if (!clerk) return Promise.resolve();
    return clerk.signOut();
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  return {
    isConfigured: isConfigured,
    init: init,
    user: user,
    mountSignIn: mountSignIn,
    unmountSignIn: unmountSignIn,
    signOut: signOut,
    onChange: onChange
  };
})();
