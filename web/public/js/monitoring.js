/**
 * Monitoring page — Fetches metrics from /api/monitoring and updates the UI
 */
(function() {
  'use strict';

  const REFRESH_INTERVAL = 30000; // 30 seconds
  let refreshTimer = null;

  // WS status names
  const WS_STATUS_MAP = {
    0: 'READY', 1: 'CONNECTING', 2: 'RECONNECTING',
    3: 'IDLE', 4: 'NEARLY', 5: 'DISCONNECTED',
    6: 'WAITING_FOR_GUILDS', 7: 'IDENTIFYING', 8: 'RESUMING'
  };

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
      document.getElementById('mon-health-status').textContent = '❌ Error';
    }
  }

  function updateUI(d) {
    const m = d.metrics;
    const health = d.health;
    const history = d.history;

    // === Health card ===
    const healthEl = document.getElementById('mon-health-status');
    const healthCard = document.getElementById('mon-health-card');
    const healthIcon = document.getElementById('mon-health-icon');
    if (health.status === 'HEALTHY') {
      healthEl.textContent = '✅ HEALTHY';
      healthCard.className = 'stat-card stat-success';
      healthIcon.textContent = '✅';
    } else if (health.status === 'DEGRADED') {
      healthEl.textContent = '⚠️ DEGRADED';
      healthCard.className = 'stat-card stat-warning';
      healthIcon.textContent = '⚠️';
    } else {
      healthEl.textContent = '❌ UNHEALTHY';
      healthCard.className = 'stat-card stat-danger';
      healthIcon.textContent = '❌';
    }

    // === Top stats ===
    document.getElementById('mon-uptime').textContent = d.uptime || '—';
    document.getElementById('mon-memory').textContent = m.system.memory.rss + ' MB';
    document.getElementById('mon-latency').textContent = m.discord.latency + ' ms';

    // === System panel ===
    document.getElementById('mon-sys-rss').textContent = m.system.memory.rss + ' MB';
    document.getElementById('mon-sys-heap').textContent = m.system.memory.heapUsed + ' / ' + m.system.memory.heapTotal + ' MB';
    document.getElementById('mon-sys-cpu').textContent = m.system.cpu.usage + '%';
    document.getElementById('mon-sys-ram-free').textContent = m.system.memory.systemFree + ' MB';
    document.getElementById('mon-sys-ram-total').textContent = m.system.memory.systemTotal + ' MB';
    document.getElementById('mon-sys-uptime').textContent = d.uptime || '—';

    // Memory bar (% of system)
    const memPct = m.system.memory.percentage || 0;
    const memBar = document.getElementById('mon-mem-bar');
    memBar.style.width = Math.min(memPct, 100) + '%';
    memBar.className = 'mon-bar' + (memPct > 80 ? ' mon-bar-danger' : memPct > 50 ? ' mon-bar-warning' : '');

    // === Discord panel ===
    document.getElementById('mon-dc-guilds').textContent = m.discord.guilds;
    document.getElementById('mon-dc-users').textContent = m.discord.users;
    document.getElementById('mon-dc-channels').textContent = m.discord.channels;
    const wsNum = m.discord.wsStatus;
    document.getElementById('mon-dc-ws-status').textContent = WS_STATUS_MAP[wsNum] || String(wsNum);
    document.getElementById('mon-dc-latency').textContent = m.discord.latency + ' ms';

    // Latency bar (0-500ms scale)
    const latPct = Math.min((m.discord.latency / 500) * 100, 100);
    const latBar = document.getElementById('mon-latency-bar');
    latBar.style.width = latPct + '%';
    latBar.className = 'mon-bar mon-bar-latency' + (m.discord.latency > 300 ? ' mon-bar-danger' : m.discord.latency > 150 ? ' mon-bar-warning' : '');

    // === Game panel ===
    document.getElementById('mon-gm-active').textContent = m.game.activeGames;
    document.getElementById('mon-gm-players').textContent = m.game.totalPlayers;
    document.getElementById('mon-gm-created24').textContent = m.game.gamesCreated24h;
    document.getElementById('mon-gm-completed24').textContent = m.game.gamesCompleted24h;

    // === Commands panel ===
    document.getElementById('mon-cmd-total').textContent = m.commands.total.toLocaleString();
    document.getElementById('mon-cmd-errors').textContent = m.commands.errors;
    document.getElementById('mon-cmd-rl').textContent = m.commands.rateLimited;
    document.getElementById('mon-cmd-avg').textContent = m.commands.avgResponseTime + ' ms';

    // === Errors panel ===
    document.getElementById('mon-err-total').textContent = m.errors.total;
    document.getElementById('mon-err-critical').textContent = m.errors.critical;
    document.getElementById('mon-err-warnings').textContent = m.errors.warnings;
    document.getElementById('mon-err-24h').textContent = m.errors.last24h;

    // === History mini charts ===
    renderMiniChart('mon-chart-mem-bars', history.memory, 100, 'var(--accent-primary)');
    renderMiniChart('mon-chart-lat-bars', history.latency, 500, 'var(--color-info)');

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
