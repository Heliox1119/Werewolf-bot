/**
 * Werewolf Bot — Main client-side app
 * Socket.IO connection, navbar toggle, WS status
 */
(function() {
  'use strict';
  const t = (k) => (window.webI18n ? window.webI18n.t(k) : k);

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
      el.innerHTML = '<span class="ws-dot"></span> ' + t('ws.connected');
    } else {
      el.className = 'ws-indicator ws-disconnected';
      el.innerHTML = '<span class="ws-dot"></span> ' + t('ws.disconnected');
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
  }

  // Sidebar settings gear popup
  const settingsBtn = document.getElementById('sidebar-settings-btn');
  const settingsPopup = document.getElementById('sidebar-settings-popup');
  if (settingsBtn && settingsPopup) {
    // Move popup to body so it escapes overflow/backdrop-filter clipping
    document.body.appendChild(settingsPopup);

    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = settingsPopup.classList.toggle('open');
      if (isOpen) {
        const rect = settingsBtn.getBoundingClientRect();
        settingsPopup.style.top = (rect.bottom + 6) + 'px';
        settingsPopup.style.left = rect.left + 'px';
      }
    });
    document.addEventListener('click', (e) => {
      if (!settingsBtn.contains(e.target) && !settingsPopup.contains(e.target)) {
        settingsPopup.classList.remove('open');
      }
    });
    // Lang button inside the popup
    const sidebarLangBtn = document.getElementById('sidebar-lang-toggle');
    if (sidebarLangBtn) {
      sidebarLangBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof getLang === 'function' && typeof setLang === 'function') {
          const current = getLang();
          setLang(current === 'fr' ? 'en' : 'fr');
        }
        settingsPopup.classList.remove('open');
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

  // ── PJAX Navigation System (persistent header) ──
  (function initPjaxNavigation() {
    const loader = document.getElementById('page-loader');
    const appMain = document.getElementById('app-main');
    if (!appMain) return;

    let navigating = false;

    function shouldIntercept(el) {
      if (!el || !el.href) return false;
      if (el.target === '_blank') return false;
      if (el.hasAttribute('download')) return false;
      if (el.origin !== location.origin) return false;
      if (el.pathname === location.pathname && el.search === location.search) return false;
      if (el.pathname === location.pathname && el.hash) return false;
      if (el.pathname.startsWith('/auth/')) return false;
      return true;
    }

    function showLoader() {
      if (loader) {
        loader.classList.remove('done');
        loader.style.animation = 'none';
        loader.offsetHeight; // reset animation
        loader.style.animation = '';
        loader.classList.add('active');
      }
    }
    function hideLoader() {
      if (loader) {
        loader.classList.remove('active');
        loader.classList.add('done');
        setTimeout(() => {
          loader.classList.remove('done');
          loader.style.width = '';
        }, 500);
      }
    }

    // Update nav-tab active states
    function updateNavTabs(pathname) {
      document.querySelectorAll('.nav-tab').forEach(tab => {
        const href = tab.getAttribute('href');
        if (!href) return;
        tab.classList.toggle('active', href === pathname || (href !== '/' && pathname.startsWith(href)));
      });
      // Special case: '/' is only active on exact match
      const homeTab = document.querySelector('.nav-tab[href="/"]');
      if (homeTab) homeTab.classList.toggle('active', pathname === '/');
    }

    // Core pjax navigation
    async function pjaxNavigate(href, pushState) {
      if (navigating) return;
      navigating = true;

      const main = appMain.querySelector('.main-content');
      showLoader();

      // Exit animation on current content
      if (main) {
        main.classList.add('page-exit');
        await new Promise(r => setTimeout(r, 250));
      }

      try {
        const resp = await fetch(href, { headers: { 'X-Requested-With': 'pjax' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        // If the server redirected (e.g. guild without bot → invite), use the final URL
        const finalUrl = resp.redirected ? resp.url : href;

        const html = await resp.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Extract new page elements
        const newAppMain = doc.getElementById('app-main');
        const newTitle = doc.querySelector('title');
        const newBody = doc.body;

        if (!newAppMain) throw new Error('No app-main in response');

        // Update document title
        if (newTitle) document.title = newTitle.textContent;

        // Update body data-page attribute
        document.body.setAttribute('data-page', newBody.getAttribute('data-page') || 'full');

        // Update guild sidebar if it changed
        const oldGuildSidebar = document.getElementById('guild-sidebar');
        const newGuildSidebar = doc.getElementById('guild-sidebar');
        if (newGuildSidebar && !oldGuildSidebar) {
          // Insert guild sidebar before app-main
          appMain.insertAdjacentElement('beforebegin', newGuildSidebar);
        } else if (!newGuildSidebar && oldGuildSidebar) {
          oldGuildSidebar.remove();
        } else if (newGuildSidebar && oldGuildSidebar) {
          oldGuildSidebar.outerHTML = newGuildSidebar.outerHTML;
        }

        // Update guild panel if it changed
        const oldGuildPanel = document.getElementById('guild-panel');
        const newGuildPanel = doc.getElementById('guild-panel');
        if (newGuildPanel && !oldGuildPanel) {
          appMain.insertAdjacentElement('beforebegin', newGuildPanel);
        } else if (!newGuildPanel && oldGuildPanel) {
          oldGuildPanel.remove();
        } else if (newGuildPanel && oldGuildPanel) {
          oldGuildPanel.outerHTML = newGuildPanel.outerHTML;
        }

        // Hide i18n elements until translations are re-applied (prevent French flash)
        document.documentElement.removeAttribute('data-i18n-ready');

        // Swap app-main content and class
        appMain.className = newAppMain.className;
        appMain.innerHTML = newAppMain.innerHTML;

        // Update nav active states
        const url = new URL(finalUrl, location.origin);
        updateNavTabs(url.pathname);

        // Push to browser history (use final URL after any redirect)
        if (pushState !== false) {
          history.pushState({ pjax: true }, document.title, finalUrl);
        }

        // Remove old page-specific scripts from body (cleanup)
        document.querySelectorAll('script[data-pjax]').forEach(s => s.remove());

        // Load new page-specific scripts
        // Mark them so we can clean up on next navigation
        const newScripts = doc.querySelectorAll('script');
        const commonScripts = ['/static/js/app.js', '/static/js/webI18n.js', 'socket.io'];
        newScripts.forEach(s => {
          if (s.src && commonScripts.some(c => s.src.includes(c))) return;
          const ns = document.createElement('script');
          ns.setAttribute('data-pjax', 'true');
          if (s.src) {
            ns.src = s.src;
          } else if (s.textContent.trim()) {
            ns.textContent = s.textContent;
          } else {
            return;
          }
          document.body.appendChild(ns);
        });

        // Re-apply i18n translations synchronously, then reveal
        if (typeof applyTranslations === 'function') {
          applyTranslations();
        }
        document.documentElement.setAttribute('data-i18n-ready', '');

        // Re-sync WS status indicator on new footer element
        updateWsStatus(socket && socket.connected);

        // Trigger enter animation on new content
        const newMain = appMain.querySelector('.main-content');
        if (newMain) {
          newMain.style.animation = 'none';
          newMain.offsetHeight; // force reflow
          newMain.style.animation = '';
        }

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'instant' });

      } catch (err) {
        console.warn('[PJAX] Navigation failed, falling back:', err);
        window.location.href = href;
        return;
      } finally {
        hideLoader();
        navigating = false;
      }
    }

    // Intercept link clicks
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (!link || !shouldIntercept(link)) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (navigating) { e.preventDefault(); return; }

      e.preventDefault();
      pjaxNavigate(link.href, true);
    });

    // Handle browser back/forward
    window.addEventListener('popstate', (e) => {
      if (navigating) return;
      pjaxNavigate(location.href, false);
    });

    // Store initial state for back navigation
    history.replaceState({ pjax: true }, document.title, location.href);
  })();

  // Utilities
  window.werewolfUtils = {
    formatNumber(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + t('unit.million');
      if (n >= 1000) return (n / 1000).toFixed(1) + t('unit.thousand');
      return n.toString();
    },
    timeAgo(date) {
      const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
      if (seconds < 60) return t('time.just_now');
      if (seconds < 3600) return Math.floor(seconds / 60) + t('time.m_ago');
      if (seconds < 86400) return Math.floor(seconds / 3600) + t('time.h_ago');
      return Math.floor(seconds / 86400) + t('time.d_ago');
    }
  };
})();
