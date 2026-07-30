(function () {
  'use strict';

  var loadingScreen = document.getElementById('loading-screen');
  var appShell = document.getElementById('app-shell');
  var enterBtn = document.getElementById('enter-app');
  var cta = enterBtn.closest('.brand-cta');

  /* ---------- loading screen ---------- */

  // the button is only offered once its fade-up has finished playing
  cta.addEventListener('animationend', function () {
    enterBtn.disabled = false;
  });

  enterBtn.addEventListener('click', function () {
    loadingScreen.hidden = true;
    appShell.hidden = false;
    loadDailyVerse();
  });

  /* ---------- view routing ---------- */

  function showView(name) {
    document.querySelectorAll('.view').forEach(function (section) {
      section.classList.toggle('is-active', section.id === 'view-' + name);
    });
    document.querySelectorAll('.nav-link').forEach(function (link) {
      link.classList.toggle('is-active', link.dataset.view === name);
    });
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('.nav-link, .feature-card').forEach(function (el) {
    el.addEventListener('click', function () {
      showView(el.dataset.view);
    });
  });

  /* ---------- backend ---------- */

  function endpoint(path) {
    return N8N_BASE_URL.replace(/\/+$/, '') + '/' + path;
  }

  function request(path, body) {
    var options = body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      : { method: 'GET' };

    return fetch(endpoint(path), options).then(
      function (res) {
        if (!res.ok) throw new Error("Couldn't reach the server (" + res.status + '). Please try again.');
        return res.json();
      },
      function () {
        throw new Error("Couldn't reach the server. Check your connection and try again.");
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
      quote.textContent = "Today's verse isn't available right now.";
    }

    document.getElementById('verse-ref').textContent = reference || '';
  }

  function loadDailyVerse() {
    request('daily-verse')
      .then(function (data) {
        renderVerse(data.text, data.reference);
      })
      .catch(function () {
        renderVerse('', '');
      });
  }

  /* ---------- tool forms ---------- */

  function wireForm(options) {
    var form = document.getElementById(options.formId);
    var input = document.getElementById(options.inputId);
    var result = document.getElementById(options.resultId);
    var status = document.getElementById(options.statusId);
    var button = form.querySelector('button');
    var idleLabel = button.textContent;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (!value) return;

      button.disabled = true;
      button.textContent = options.busyLabel;
      setStatus(status, options.busyStatus, false);

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
          button.disabled = false;
          button.textContent = idleLabel;
        });
    });
  }

  wireForm({
    formId: 'search-form',
    inputId: 'search-query',
    resultId: 'search-result',
    statusId: 'search-status',
    path: 'search-scripture',
    field: 'query',
    busyLabel: 'Searching…',
    busyStatus: 'Looking up that passage…',
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
    busyLabel: 'Writing…',
    busyStatus: 'Writing your devotional…',
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
    busyLabel: 'Preparing…',
    busyStatus: 'Preparing your talking points…',
    render: function (data, result) {
      result.textContent = (data.prep || '').trim();
    }
  });
})();
