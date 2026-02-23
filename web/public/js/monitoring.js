/**
 * Monitoring page — Fetches metrics from /api/monitoring and updates the UI
 * Handles partial data based on access level (owner/admin/member/public)
 */
(function() {
  'use strict';

  const REFRESH_INTERVAL = 30000; // 30 seconds
  let refreshTimer = null;
  const level = window.__accessLevel || 'public';

  // WS status names
  const WS_STATUS_MAP = {
    0: 'READY', 1: 'CONNECTING', 2: 'RECONNECTING',
    3: 'IDLE', 4: 'NEARLY', 5: 'DISCONNECTED',
    6: 'WAITING_FOR_GUILDS', 7: 'IDENTIFYING', 8: 'RESUMING'
  };

  // Safe element setter — skips if element doesn't exist (hidden by access level)
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setStyle(id, prop, val) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = val;
  }

  function setClass(id, cls) {
    const el = document.getElementById(id);
    if (el) el.className = cls;
  }

  async function fetchMetrics() {
    try {
      const res = await fetch('/api/monitoring', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        updateUI(data.data);
      }
    } catch (e) {
      console.error('[MON] Fetch error:', e);
      setText('mon-health-status', '❌ Error');
    }
  }

  function updateUI(d) {
    const m = d.metrics;
    const health = d.health;
    const history = d.history;

    // === Health card (always visible) ===
    const healthEl = document.getElementById('mon-health-status');
    const healthCard = document.getElementById('mon-health-card');
    const healthIcon = document.getElementById('mon-health-icon');
    if (health && health.status === 'HEALTHY') {
      if (healthEl) healthEl.textContent = '✅ HEALTHY';
      if (healthCard) healthCard.className = 'stat-card stat-success';
      if (healthIcon) healthIcon.textContent = '✅';
    } else if (health && health.status === 'DEGRADED') {
      if (healthEl) healthEl.textContent = '⚠️ DEGRADED';
      if (healthCard) healthCard.className = 'stat-card stat-warning';
      if (healthIcon) healthIcon.textContent = '⚠️';
    } else {
      if (healthEl) healthEl.textContent = '❌ UNHEALTHY';
      if (healthCard) healthCard.className = 'stat-card stat-danger';
      if (healthIcon) healthIcon.textContent = '❌';
    }

    // === Top stats ===
    setText('mon-uptime', d.uptime || '—');
    if (m.system && m.system.memory) {
      setText('mon-memory', m.system.memory.rss + ' MB');
    }
    if (m.discord && m.discord.latency !== undefined) {
      setText('mon-latency', m.discord.latency + ' ms');
    }

    // === System panel (owner only) ===
    if (m.system && m.system.memory) {
      setText('mon-sys-rss', m.system.memory.rss + ' MB');
      if (m.system.memory.heapUsed !== undefined) {
        setText('mon-sys-heap', m.system.memory.heapUsed + ' / ' + m.system.memory.heapTotal + ' MB');
      }
      if (m.system.memory.systemFree !== undefined) {
        setText('mon-sys-ram-free', m.system.memory.systemFree + ' MB');
        setText('mon-sys-ram-total', m.system.memory.systemTotal + ' MB');
      }
    }
    if (m.system && m.system.cpu) {
      setText('mon-sys-cpu', m.system.cpu.usage + '%');
    }
    setText('mon-sys-uptime', d.uptime || '—');

    // Memory bar
    if (m.system && m.system.memory && m.system.memory.percentage !== undefined) {
      const memPct = m.system.memory.percentage || 0;
      setStyle('mon-mem-bar', 'width', Math.min(memPct, 100) + '%');
      setClass('mon-mem-bar', 'mon-bar' + (memPct > 80 ? ' mon-bar-danger' : memPct > 50 ? ' mon-bar-warning' : ''));
    }

    // === Discord panel (admin+) ===
    if (m.discord) {
      if (m.discord.guilds !== undefined) setText('mon-dc-guilds', m.discord.guilds);
      if (m.discord.users !== undefined) setText('mon-dc-users', m.discord.users);
      if (m.discord.channels !== undefined) setText('mon-dc-channels', m.discord.channels);
      if (m.discord.wsStatus !== undefined) {
        const wsNum = m.discord.wsStatus;
        setText('mon-dc-ws-status', WS_STATUS_MAP[wsNum] || String(wsNum));
      }
      if (m.discord.latency !== undefined) {
        setText('mon-dc-latency', m.discord.latency + ' ms');
        // Latency bar
        const latPct = Math.min((m.discord.latency / 500) * 100, 100);
        setStyle('mon-latency-bar', 'width', latPct + '%');
        setClass('mon-latency-bar', 'mon-bar mon-bar-latency' + (m.discord.latency > 300 ? ' mon-bar-danger' : m.discord.latency > 150 ? ' mon-bar-warning' : ''));
      }
    }

    // === Game panel (all levels, partial data) ===
    if (m.game) {
      setText('mon-gm-active', m.game.activeGames);
      setText('mon-gm-players', m.game.totalPlayers);
      if (m.game.gamesCreated24h !== undefined) setText('mon-gm-created24', m.game.gamesCreated24h);
      if (m.game.gamesCompleted24h !== undefined) setText('mon-gm-completed24', m.game.gamesCompleted24h);
    }

    // === Commands panel (owner only) ===
    if (m.commands) {
      if (m.commands.total !== undefined) setText('mon-cmd-total', m.commands.total.toLocaleString());
      if (m.commands.errors !== undefined) setText('mon-cmd-errors', m.commands.errors);
      if (m.commands.rateLimited !== undefined) setText('mon-cmd-rl', m.commands.rateLimited);
      if (m.commands.avgResponseTime !== undefined) setText('mon-cmd-avg', m.commands.avgResponseTime + ' ms');
    }

    // === Errors panel (owner only) ===
    if (m.errors) {
      if (m.errors.total !== undefined) setText('mon-err-total', m.errors.total);
      if (m.errors.critical !== undefined) setText('mon-err-critical', m.errors.critical);
      if (m.errors.warnings !== undefined) setText('mon-err-warnings', m.errors.warnings);
      if (m.errors.last24h !== undefined) setText('mon-err-24h', m.errors.last24h);
    }

    // === History mini charts (owner only) ===
    if (history && history.memory && history.memory.length > 0) {
      renderMiniChart('mon-chart-mem-bars', history.memory, 100, 'var(--accent-primary)');
    }
    if (history && history.latency && history.latency.length > 0) {
      renderMiniChart('mon-chart-lat-bars', history.latency, 500, 'var(--color-info)');
    }

    // Apply i18n after dynamic content
    if (window.webI18n) window.webI18n.applyTranslations(window.webI18n.getLang());
  }

  function renderMiniChart(containerId, dataPoints, maxVal, color) {
    const container = document.getElementById(containerId);
    if (!container || !dataPoints || dataPoints.length === 0) return;

    container.innerHTML = '';
    const max = Math.max(maxVal, ...dataPoints);
    dataPoints.forEach((val, i) => {
      const bar = document.createElement('div');
      bar.className = 'mon-mini-bar';
      const h = max > 0 ? Math.max(2, (val / max) * 100) : 2;
      bar.style.height = h + '%';
      bar.style.backgroundColor = color;
      bar.title = `${val}`;
      container.appendChild(bar);
    });
  }

  // === Event delegation ===
  document.addEventListener('click', (e) => {
    if (e.target.id === 'mon-refresh-btn' || e.target.closest('#mon-refresh-btn')) {
      fetchMetrics();
    }
  });

  // Auto-refresh
  fetchMetrics();
  refreshTimer = setInterval(fetchMetrics, REFRESH_INTERVAL);

  // Cleanup on page leave
  window.addEventListener('beforeunload', () => {
    if (refreshTimer) clearInterval(refreshTimer);
  });
})();
