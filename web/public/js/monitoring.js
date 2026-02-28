/**
 * Status / Monitoring page — v3 (st-* redesign + interactive charts)
 * Fetches /api/monitoring, fills KPI / panels / canvas charts
 */
(function() {
  'use strict';
  const t = (k) => (window.webI18n ? window.webI18n.t(k) : k);

  const REFRESH = 30000;
  let timer = null;
  const level = window.__accessLevel || 'public';

  const WS_MAP = {
    0: t('mon.ws_ready'), 1: t('mon.ws_connecting'), 2: t('mon.ws_reconnecting'), 3: t('mon.ws_idle'),
    4: t('mon.ws_nearly'), 5: t('mon.ws_disconnected'), 6: t('mon.ws_wait_guilds'), 7: t('mon.ws_identifying'), 8: t('mon.ws_resuming')
  };

  /* ── helpers ── */
  function $(id) { return document.getElementById(id); }
  function txt(id, v) { const e = $(id); if (e) e.textContent = v; }
  function css(id, p, v) { const e = $(id); if (e) e.style[p] = v; }

  /* ── SVG gradient (inject once) ── */
  (function addSvgDefs() {
    const ring = $('st-uptime-ring');
    if (!ring) return;
    const svg = ring.closest('svg');
    if (!svg || svg.querySelector('#st-ring-gradient')) return;
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML =
      '<linearGradient id="st-ring-gradient" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#10b981"/>' +
      '<stop offset="100%" stop-color="#06b6d4"/>' +
      '</linearGradient>';
    svg.insertBefore(defs, svg.firstChild);
  })();

  /* ── Chart metadata store (for tooltip interaction) ── */
  const chartMeta = {};

  /* ── canvas chart renderer with axes ── */
  function drawAreaChart(canvasId, data, timestamps, maxCeil, colorStart, colorEnd, unit) {
    const canvas = $(canvasId);
    if (!canvas || !data || data.length < 2) return;

    // Skip if canvas is hidden (collapsed panel)
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;

    const pad = { t: 14, r: 12, b: 28, l: 48 };
    const cW = W - pad.l - pad.r;
    const cH = H - pad.t - pad.b;

    /* ── Y-axis: simple 0 → max+30% ── */
    const dMax = Math.max(...data) || maxCeil;
    const yMin = 0;
    const yMax = Math.ceil(dMax * 1.3) || 10;
    const yTicks = 4;
    const step = cW / (data.length - 1);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.font = '10px Inter, system-ui, sans-serif';
    for (let i = 0; i <= yTicks; i++) {
      const val = yMax - (i / yTicks) * yMax;
      const y = pad.t + (cH / yTicks) * i;
      // Grid line
      ctx.strokeStyle = 'rgba(255,255,255,.05)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(W - pad.r, y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Label
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fillText(val >= 10 ? Math.round(val) : val.toFixed(1), pad.l - 8, y);
    }

    /* ── X-axis time labels ── */
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    const xLabelCount = Math.min(data.length, 6);
    for (let i = 0; i < xLabelCount; i++) {
      const idx = Math.round((i / (xLabelCount - 1)) * (data.length - 1));
      const x = pad.l + idx * step;
      let label;
      if (timestamps && timestamps[idx]) {
        const d = new Date(timestamps[idx]);
        label = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      } else {
        const hoursAgo = Math.round(((data.length - 1 - idx) / (data.length - 1)) * 24);
        label = hoursAgo === 0 ? t('mon.chart_now') : hoursAgo + t('mon.unit_h');
      }
      ctx.fillText(label, x, H - pad.b + 8);
    }

    /* ── Axis lines ── */
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, H - pad.b);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pad.l, H - pad.b);
    ctx.lineTo(W - pad.r, H - pad.b);
    ctx.stroke();

    // Build path points — 0 is bottom, yMax is top
    const pts = data.map((v, i) => ({
      x: pad.l + i * step,
      y: pad.t + ((yMax - v) / yMax) * cH
    }));

    // Store metadata for tooltip
    chartMeta[canvasId] = { pts, data, timestamps, pad, W, H, cW, cH, step, yMin, yMax, yRange: yMax, unit, colorStart, colorEnd };

    /* ── Clip to chart area ── */
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, cW, cH);
    ctx.clip();

    /* ── Area fill gradient ── */
    const minPtY = Math.min(...pts.map(p => p.y));
    const grad = ctx.createLinearGradient(0, minPtY, 0, H - pad.b);
    grad.addColorStop(0, colorStart.replace(')', ',.25)').replace('rgb', 'rgba'));
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1], cur = pts[i];
      const cpx = (prev.x + cur.x) / 2;
      ctx.bezierCurveTo(cpx, prev.y, cpx, cur.y, cur.x, cur.y);
    }
    ctx.lineTo(pts[pts.length - 1].x, H - pad.b);
    ctx.lineTo(pts[0].x, H - pad.b);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    /* ── Stroke line ── */
    const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
    lineGrad.addColorStop(0, colorStart);
    lineGrad.addColorStop(1, colorEnd);

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1], cur = pts[i];
      const cpx = (prev.x + cur.x) / 2;
      ctx.bezierCurveTo(cpx, prev.y, cpx, cur.y, cur.x, cur.y);
    }
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2;
    ctx.stroke();

    /* ── Glow ── */
    ctx.save();
    ctx.shadowColor = colorStart;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1], cur = pts[i];
      const cpx = (prev.x + cur.x) / 2;
      ctx.bezierCurveTo(cpx, prev.y, cpx, cur.y, cur.x, cur.y);
    }
    ctx.strokeStyle = colorStart.replace(')', ',.25)').replace('rgb', 'rgba');
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    /* ── Data point dots ── */
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const t = i / (pts.length - 1);
      // Interpolate color
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.fill();
    }
    // Last point — highlighted
    const last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = colorEnd;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = colorEnd.replace(')', ',.3)').replace('rgb', 'rgba');
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore(); // release clip
  }

  /* ── fetch & update ── */
  async function fetchMetrics() {
    try {
      const res = await fetch('/api/monitoring', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data.success) updateUI(data.data);
    } catch (e) {
      console.error('[MON] Fetch error:', e);
      txt('st-health-text', t('mon.health_error'));
      const icon = $('st-health-icon');
      if (icon) icon.textContent = '❌';
    }
  }

  function updateUI(d) {
    const m = d.metrics;
    const health = d.health;
    const history = d.history;

    /* ── Health ring ── */
    const ringEl = $('st-uptime-ring');
    const CIRC = 326.7;
    if (health) {
      const hIcon = $('st-health-icon');
      const hText = $('st-health-text');
      const hRing = $('st-health-ring');
      if (health.status === 'HEALTHY') {
        if (hIcon) hIcon.textContent = '✅';
        if (hText) hText.textContent = t('mon.health_healthy');
        if (ringEl) ringEl.style.strokeDashoffset = '0'; // full ring
        if (hRing) hRing.style.filter = '';
      } else if (health.status === 'DEGRADED') {
        if (hIcon) hIcon.textContent = '⚠️';
        if (hText) hText.textContent = t('mon.health_degraded');
        if (ringEl) ringEl.style.strokeDashoffset = String(CIRC * 0.3);
        if (hRing) hRing.style.filter = 'hue-rotate(40deg)';
      } else {
        if (hIcon) hIcon.textContent = '❌';
        if (hText) hText.textContent = t('mon.health_unhealthy');
        if (ringEl) ringEl.style.strokeDashoffset = String(CIRC * 0.75);
        if (hRing) hRing.style.filter = 'hue-rotate(100deg)';
      }
    }

    /* ── KPI strip ── */
    txt('mon-uptime', d.uptime || '—');
    if (m.discord && m.discord.latency !== undefined) {
      txt('mon-latency', m.discord.latency + t('mon.unit_ms'));
    }
    if (m.game) {
      txt('mon-gm-active', m.game.activeGames);
      txt('mon-gm-players', m.game.totalPlayers);
      txt('mon-gm-active2', m.game.activeGames);
      txt('mon-gm-players2', m.game.totalPlayers);
      if (m.game.gamesCreated24h !== undefined) txt('mon-gm-created24', m.game.gamesCreated24h);
      if (m.game.gamesCompleted24h !== undefined) txt('mon-gm-completed24', m.game.gamesCompleted24h);
    }
    if (m.system && m.system.memory) {
      txt('mon-memory', m.system.memory.rss + t('mon.unit_mb'));
    }

    /* ── System panel (owner) ── */
    if (m.system && m.system.memory) {
      txt('mon-sys-rss', m.system.memory.rss + t('mon.unit_mb'));
      if (m.system.memory.heapUsed !== undefined)
        txt('mon-sys-heap', m.system.memory.heapUsed + ' / ' + m.system.memory.heapTotal + t('mon.unit_mb'));
      if (m.system.memory.systemFree !== undefined) {
        txt('mon-sys-ram-free', m.system.memory.systemFree + t('mon.unit_mb'));
        txt('mon-sys-ram-total', m.system.memory.systemTotal + t('mon.unit_mb'));
      }
      if (m.system.memory.percentage !== undefined) {
        const pct = Math.min(m.system.memory.percentage, 100);
        css('mon-mem-bar', 'width', pct + '%');
        txt('st-mem-pct', Math.round(pct) + '%');
        const barEl = $('mon-mem-bar');
        if (barEl) {
          barEl.className = 'st-bar-fill' + (pct > 80 ? ' st-bar--danger' : pct > 50 ? ' st-bar--warn' : '');
        }
      }
    }
    if (m.system && m.system.cpu) txt('mon-sys-cpu', m.system.cpu.usage + '%');
    txt('mon-sys-uptime', d.uptime || '—');

    /* ── Discord panel (admin+) ── */
    if (m.discord) {
      if (m.discord.guilds !== undefined) txt('mon-dc-guilds', m.discord.guilds);
      if (m.discord.users !== undefined) txt('mon-dc-users', m.discord.users);
      if (m.discord.channels !== undefined) txt('mon-dc-channels', m.discord.channels);
      if (m.discord.wsStatus !== undefined)
        txt('mon-dc-ws-status', WS_MAP[m.discord.wsStatus] || String(m.discord.wsStatus));
      if (m.discord.latency !== undefined) {
        txt('mon-dc-latency', m.discord.latency + t('mon.unit_ms'));
        const pct = Math.min((m.discord.latency / 500) * 100, 100);
        css('mon-latency-bar', 'width', pct + '%');
        txt('st-lat-pct', m.discord.latency + t('mon.unit_ms'));
        const bEl = $('mon-latency-bar');
        if (bEl) bEl.className = 'st-bar-fill st-bar--blue' + (m.discord.latency > 300 ? ' st-bar--danger' : m.discord.latency > 150 ? ' st-bar--warn' : '');
      }
    }

    /* ── Commands (owner) ── */
    if (m.commands) {
      if (m.commands.total !== undefined) txt('mon-cmd-total', m.commands.total.toLocaleString());
      if (m.commands.errors !== undefined) txt('mon-cmd-errors', m.commands.errors);
      if (m.commands.rateLimited !== undefined) txt('mon-cmd-rl', m.commands.rateLimited);
      if (m.commands.avgResponseTime !== undefined) txt('mon-cmd-avg', m.commands.avgResponseTime + t('mon.unit_ms'));
    }

    /* ── Errors (owner) ── */
    if (m.errors) {
      if (m.errors.total !== undefined) txt('mon-err-total', m.errors.total);
      if (m.errors.critical !== undefined) txt('mon-err-critical', m.errors.critical);
      if (m.errors.warnings !== undefined) txt('mon-err-warnings', m.errors.warnings);
      if (m.errors.last24h !== undefined) txt('mon-err-24h', m.errors.last24h);
    }

    /* ── Canvas charts (owner) — only draw if panel is expanded ── */
    if (history) {
      lastHistory = history;
      if (history.latency && history.latency.length > 1) {
        const panel = $('st-chart-latency') && $('st-chart-latency').closest('.st-panel--chart');
        if (!panel || !panel.classList.contains('st-panel--collapsed')) {
          drawAreaChart('st-chart-latency', history.latency, history.timestamps, 500,
            'rgb(6,182,212)', 'rgb(59,130,246)', 'ms');
        }
        const avg = Math.round(history.latency.reduce((a, b) => a + b, 0) / history.latency.length);
        txt('st-lat-avg', avg + t('mon.avg_ms'));
      }
      if (history.memory && history.memory.length > 1) {
        const panel = $('st-chart-memory') && $('st-chart-memory').closest('.st-panel--chart');
        if (!panel || !panel.classList.contains('st-panel--collapsed')) {
          drawAreaChart('st-chart-memory', history.memory, history.timestamps, 100,
            'rgb(139,92,246)', 'rgb(16,185,129)', '%');
        }
        const avg = Math.round(history.memory.reduce((a, b) => a + b, 0) / history.memory.length);
        txt('st-mem-avg', avg + t('mon.avg_pct'));
      }
    }

    /* ── i18n re-apply ── */
    if (window.webI18n) window.webI18n.applyTranslations(window.webI18n.getLang());
  }

  /* ── stored chart data for redraw ── */
  let lastHistory = null;

  /* ── Event bindings (prevent PJAX stacking) ── */
  function handleMonClick(e) {
    if (e.target.id === 'mon-refresh-btn' || e.target.closest('#mon-refresh-btn')) {
      fetchMetrics();
    }
    /* Chart expand / collapse toggle — click header or toggle button */
    const toggleBtn = e.target.closest('.st-chart-toggle');
    const panelHead = e.target.closest('.st-panel--chart .st-panel-head');
    const trigger = toggleBtn || panelHead;
    if (trigger) {
      const panel = trigger.closest('.st-panel--chart');
      if (!panel) return;
      const wasCollapsed = panel.classList.contains('st-panel--collapsed');
      panel.classList.toggle('st-panel--collapsed');
      const tog = panel.querySelector('.st-chart-toggle');
      if (tog) {
        tog.setAttribute('title', wasCollapsed ? t('mon.collapse') : t('mon.expand'));
        tog.setAttribute('aria-label', wasCollapsed ? t('mon.collapse_chart') : t('mon.expand_chart'));
      }
      /* Redraw canvas after expand transition completes */
      if (wasCollapsed && lastHistory) {
        setTimeout(() => {
          const canvas = panel.querySelector('canvas');
          if (!canvas) return;
          if (canvas.id === 'st-chart-latency' && lastHistory.latency && lastHistory.latency.length > 1) {
            drawAreaChart('st-chart-latency', lastHistory.latency, lastHistory.timestamps, 500,
              'rgb(6,182,212)', 'rgb(59,130,246)', 'ms');
          }
          if (canvas.id === 'st-chart-memory' && lastHistory.memory && lastHistory.memory.length > 1) {
            drawAreaChart('st-chart-memory', lastHistory.memory, lastHistory.timestamps, 100,
              'rgb(139,92,246)', 'rgb(16,185,129)', '%');
          }
        }, 420);
      }
    }
  }

  function handleMonMouseMove(e) {
    const wrap = e.target.closest('.st-chart-wrap');
    if (!wrap) return;
    const canvas = wrap.querySelector('canvas');
    if (!canvas) return;
    const meta = chartMeta[canvas.id];
    if (!meta || !meta.pts || meta.pts.length < 2) return;

    const crosshair = wrap.querySelector('.st-chart-crosshair');
    const tooltip = wrap.querySelector('.st-chart-tooltip');
    if (!crosshair || !tooltip) return;

    const canvasRect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - canvasRect.left;

    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < meta.pts.length; i++) {
      const d = Math.abs(meta.pts[i].x - mouseX);
      if (d < closestDist) {
        closestDist = d;
        closestIdx = i;
      }
    }

    if (mouseX < meta.pad.l - 5 || mouseX > meta.W - meta.pad.r + 5) {
      crosshair.style.opacity = '0';
      tooltip.style.opacity = '0';
      return;
    }

    const pt = meta.pts[closestIdx];
    const val = meta.data[closestIdx];

    crosshair.style.left = pt.x + 'px';
    crosshair.style.top = meta.pad.t + 'px';
    crosshair.style.height = meta.cH + 'px';
    crosshair.style.opacity = '1';

    let timeStr = '';
    if (meta.timestamps && meta.timestamps[closestIdx]) {
      const d = new Date(meta.timestamps[closestIdx]);
      timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const timeSpan = tooltip.querySelector('.st-chart-tooltip-time');
    const valSpan = tooltip.querySelector('.st-chart-tooltip-val');
    if (timeSpan) timeSpan.textContent = timeStr;
    if (valSpan) valSpan.textContent = Math.round(val) + ' ' + (meta.unit || '');

    const tooltipW = tooltip.offsetWidth || 100;
    let tooltipX = pt.x + 12;
    if (tooltipX + tooltipW > meta.W - 10) {
      tooltipX = pt.x - tooltipW - 12;
    }
    tooltip.style.left = Math.max(0, tooltipX) + 'px';
    tooltip.style.opacity = '1';
  }

  function handleMonMouseLeave(e) {
    if (e.target && e.target.closest && e.target.closest('.st-chart-wrap')) {
      const wrap = e.target.closest('.st-chart-wrap');
      const crosshair = wrap.querySelector('.st-chart-crosshair');
      const tooltip = wrap.querySelector('.st-chart-tooltip');
      if (crosshair) crosshair.style.opacity = '0';
      if (tooltip) tooltip.style.opacity = '0';
    }
  }

  // Remove any previous listeners (PJAX re-run protection)
  if (window._monCleanup) window._monCleanup();
  document.addEventListener('click', handleMonClick);
  document.addEventListener('mousemove', handleMonMouseMove);
  document.addEventListener('mouseleave', handleMonMouseLeave, true);
  window._monCleanup = function() {
    document.removeEventListener('click', handleMonClick);
    document.removeEventListener('mousemove', handleMonMouseMove);
    document.removeEventListener('mouseleave', handleMonMouseLeave, true);
  };

  /* ── Init (clear any previous timer from PJAX re-run) ── */
  if (window._monTimer) clearInterval(window._monTimer);
  fetchMetrics();
  window._monTimer = setInterval(fetchMetrics, REFRESH);

  window.addEventListener('beforeunload', () => {
    if (window._monTimer) clearInterval(window._monTimer);
  });
})();
