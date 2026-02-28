/**
 * Web Interface — Client-side i18n engine
 * Loads translations from /static/locales/{lang}.json
 * Uses data-i18n attributes and localStorage for persistence.
 */
(function() {
  'use strict';

  // -- Internal state --
  // Flat key->value map for the currently loaded language
  var _translations = {};
  var _loadedLang = null;
  var _loading = null; // current fetch promise (dedup)

  // -- Flatten nested JSON into dot-notation keys --
  function _flatten(obj, prefix) {
    var flat = {};
    for (var k in obj) {
      if (!obj.hasOwnProperty(k)) continue;
      var key = prefix ? prefix + '.' + k : k;
      if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
        var sub = _flatten(obj[k], key);
        for (var s in sub) { if (sub.hasOwnProperty(s)) flat[s] = sub[s]; }
      } else {
        flat[key] = obj[k];
      }
    }
    return flat;
  }

  // -- Load JSON for a given language --
  function loadTranslations(lang) {
    if (_loadedLang === lang && Object.keys(_translations).length > 0) {
      return Promise.resolve(_translations);
    }
    if (_loading && _loading._lang === lang) return _loading;

    var url = '/static/locales/' + lang + '.json';
    var promise = fetch(url)
      .then(function(res) {
        if (!res.ok) throw new Error('Failed to load ' + url + ' (' + res.status + ')');
        return res.json();
      })
      .then(function(json) {
        _translations = _flatten(json, '');
        _loadedLang = lang;
        _loading = null;
        return _translations;
      })
      .catch(function(err) {
        console.error('[webI18n] ' + err.message);
        _translations = {};
        _loadedLang = null;
        _loading = null;
        return _translations;
      });
    promise._lang = lang;
    _loading = promise;
    return promise;
  }

  // -- Get / Set language --
  function getLang() {
    return localStorage.getItem('werewolf-lang') || 'fr';
  }

  function setLang(lang) {
    localStorage.setItem('werewolf-lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.setAttribute('data-lang', lang);
    updateLangButton(lang);
    document.documentElement.removeAttribute('data-i18n-ready');
    loadTranslations(lang).then(function() {
      applyTranslations(lang);
      document.documentElement.setAttribute('data-i18n-ready', '');
    });
  }

  // -- Translation lookup --
  function t(key) {
    if (_translations.hasOwnProperty(key)) return _translations[key];
    return '[' + key + ']';
  }

  // -- Apply translations to the DOM --
  function applyTranslations(lang) {
    if (!lang) lang = getLang();

    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      var val = _translations[key];
      if (val !== undefined) el.textContent = val;
    });

    document.querySelectorAll('[data-i18n-html]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-html');
      var val = _translations[key];
      if (val !== undefined) el.innerHTML = val;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-placeholder');
      var val = _translations[key];
      if (val !== undefined) el.placeholder = val;
    });

    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-title');
      var val = _translations[key];
      if (val !== undefined) el.title = val;
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-aria-label');
      var val = _translations[key];
      if (val !== undefined) el.setAttribute('aria-label', val);
    });

    document.querySelectorAll('[data-i18n-content]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-content');
      var val = _translations[key];
      if (val !== undefined) el.setAttribute('content', val);
    });

    document.querySelectorAll('[data-i18n-alt]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-alt');
      var val = _translations[key];
      if (val !== undefined) el.alt = val;
    });

    // Re-format dates with the correct locale
    var locale = lang === 'en' ? 'en-GB' : 'fr-FR';
    var DATE_FORMATS = {
      'month-year': { month: 'long', year: 'numeric' },
      'full': { day: 'numeric', month: 'long', year: 'numeric' },
      'day-month': { day: 'numeric', month: 'short' },
      'day-month-year': { day: 'numeric', month: 'short', year: 'numeric' }
    };
    var TIME_FORMAT = lang === 'en'
      ? { hour: 'numeric', minute: '2-digit', hour12: true }
      : { hour: '2-digit', minute: '2-digit', hour12: false };
    var TIME_SEC_FORMAT = lang === 'en'
      ? { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }
      : { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    var DATETIME_FORMAT = lang === 'en'
      ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }
      : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
    document.querySelectorAll('.pp-date[data-date-format]').forEach(function(el) {
      var tsS = el.getAttribute('data-timestamp');
      var tsMs = el.getAttribute('data-timestamp-ms');
      var ms = tsS ? Number(tsS) * 1000 : (tsMs ? Number(tsMs) : 0);
      if (!ms) return;
      var fmtKey = el.getAttribute('data-date-format');
      if (fmtKey === 'time') {
        el.textContent = new Date(ms).toLocaleTimeString(locale, TIME_FORMAT);
      } else if (fmtKey === 'time-sec') {
        el.textContent = new Date(ms).toLocaleTimeString(locale, TIME_SEC_FORMAT);
      } else if (fmtKey === 'datetime') {
        el.textContent = new Date(ms).toLocaleString(locale, DATETIME_FORMAT);
      } else {
        el.textContent = new Date(ms).toLocaleDateString(locale, DATE_FORMATS[fmtKey] || {});
      }
    });
  }

  // -- Update language toggle button state --
  function updateLangButton(lang) {
    var toggle = document.getElementById('header-lang-toggle');
    if (toggle) {
      toggle.setAttribute('data-lang', lang);
      var frEl = document.getElementById('header-lang-fr');
      var enEl = document.getElementById('header-lang-en');
      if (frEl) frEl.classList.toggle('active', lang === 'fr');
      if (enEl) enEl.classList.toggle('active', lang === 'en');
    }
    var flag = document.getElementById('lang-flag') || document.getElementById('user-menu-lang-flag');
    var label = document.getElementById('lang-label');
    var sidebarFlag = document.getElementById('sidebar-lang-flag');
    if (flag) flag.textContent = lang === 'fr' ? '\uD83C\uDDEB\uD83C\uDDF7' : '\uD83C\uDDEC\uD83C\uDDE7';
    if (label) label.textContent = lang === 'fr' ? 'FR' : 'EN';
    if (sidebarFlag) sidebarFlag.textContent = lang === 'fr' ? '\uD83C\uDDEB\uD83C\uDDF7' : '\uD83C\uDDEC\uD83C\uDDE7';
  }

  // -- Initialization --
  function init() {
    var lang = getLang();
    document.documentElement.lang = lang;
    document.documentElement.setAttribute('data-lang', lang);
    updateLangButton(lang);

    loadTranslations(lang).then(function() {
      applyTranslations(lang);
      document.documentElement.setAttribute('data-i18n-ready', '');
    });

    document.addEventListener('click', function(e) {
      if (e.target.id === 'header-lang-toggle' || e.target.closest('#header-lang-toggle')
        || e.target.id === 'lang-toggle' || e.target.closest('#lang-toggle')
        || e.target.id === 'sidebar-lang-toggle' || e.target.closest('#sidebar-lang-toggle')
        || e.target.id === 'user-menu-lang' || e.target.closest('#user-menu-lang')) {
        var current = getLang();
        setLang(current === 'fr' ? 'en' : 'fr');
      }
    });
  }

  // -- Export for other scripts --
  window.getLang = getLang;
  window.setLang = setLang;
  window.applyTranslations = applyTranslations;
  window.updateLangButton = updateLangButton;
  window.webI18n = {
    t: t,
    getLang: getLang,
    setLang: setLang,
    applyTranslations: applyTranslations,
    updateLangButton: updateLangButton,
    loadTranslations: loadTranslations
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
