/**
 * Werewolf Bot — Main client-side app
 * Socket.IO connection, navbar toggle, WS status
 */
(function() {
  'use strict';

  let socket = null;

  function connectSocket() {
    try {
      socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionAttempts: 20
      });

      socket.on('connect', () => {
        updateWsStatus(true);
        console.log('[WS] Connected:', socket.id);
      });

      socket.on('disconnect', () => {
        updateWsStatus(false);
        console.log('[WS] Disconnected');
      });

      socket.on('connect_error', () => {
        updateWsStatus(false);
      });

      window.werewolfSocket = socket;
      window.dispatchEvent(new CustomEvent('werewolf:socket-ready', { detail: { socket } }));
    } catch (e) {
      console.warn('[WS] Socket.IO not available:', e.message);
    }
  }

  function updateWsStatus(connected) {
    const el = document.getElementById('ws-status');
    if (!el) return;
    if (connected) {
      el.className = 'ws-indicator ws-connected';
      el.innerHTML = '<span class="ws-dot"></span> Connected';
    } else {
      el.className = 'ws-indicator ws-disconnected';
      el.innerHTML = '<span class="ws-dot"></span> Disconnected';
    }
  }

  // Navbar mobile toggle (hamburger for nav tabs)
  const navToggle = document.getElementById('nav-toggle');
  const navTabs = document.getElementById('nav-tabs');
  if (navToggle && navTabs) {
    navToggle.addEventListener('click', () => {
      navTabs.classList.toggle('open');
    });
    // Close mobile menu when clicking a link
    navTabs.addEventListener('click', (e) => {
      if (e.target.classList.contains('nav-tab')) {
        navTabs.classList.remove('open');
      }
    });
  }

  // User dropdown toggle
  const userBtn = document.getElementById('nav-user-btn');
  const userMenu = document.getElementById('nav-user-menu');
  if (userBtn && userMenu) {
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = userMenu.classList.toggle('open');
      userBtn.classList.toggle('open', isOpen);
    });
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!userBtn.contains(e.target) && !userMenu.contains(e.target)) {
        userMenu.classList.remove('open');
        userBtn.classList.remove('open');
      }
    });
    // Language switch inside dropdown
    const langBtn = document.getElementById('user-menu-lang');
    if (langBtn) {
      langBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Toggle language (uses webI18n functions)
        if (typeof getLang === 'function' && typeof setLang === 'function') {
          const current = getLang();
          const next = current === 'fr' ? 'en' : 'fr';
          setLang(next);
          if (typeof applyTranslations === 'function') applyTranslations();
          if (typeof updateLangButton === 'function') updateLangButton();
          // Also update the dropdown flag
          const flag = document.getElementById('user-menu-lang-flag');
          if (flag) flag.textContent = next === 'fr' ? '🇫🇷' : '🇬🇧';
        }
        // Close dropdown after switching
        userMenu.classList.remove('open');
        userBtn.classList.remove('open');
      });
    }
  }

  // Guild sidebar mobile overlay
  const guildSidebar = document.getElementById('guild-sidebar');
  if (guildSidebar) {
    // Create overlay element for guild sidebar on mobile
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      document.body.appendChild(overlay);
    }
    // Close guild sidebar when clicking overlay
    overlay.addEventListener('click', () => {
      guildSidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  }

  // Init
  if (typeof io !== 'undefined') {
    connectSocket();
  } else {
    updateWsStatus(false);
  }

  // Utilities
  window.werewolfUtils = {
    formatNumber(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return n.toString();
    },
    timeAgo(date) {
      const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
      if (seconds < 60) return 'just now';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      return Math.floor(seconds / 86400) + 'd ago';
    }
  };
})();
