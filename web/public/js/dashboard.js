/**
 * Dashboard — Real-time game updates + activity feed
 */

/* ── Animated number counters ── */
(function() {
  'use strict';
  const counters = document.querySelectorAll('.counter[data-target]');
  if (!counters.length) return;

  const duration = 1400; // ms
  const fps = 60;
  const totalFrames = Math.round(duration / (1000 / fps));

  function easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  counters.forEach(el => {
    const target = parseInt(el.getAttribute('data-target')) || 0;
    if (target === 0) { el.textContent = '0'; return; }
    let frame = 0;
    const step = () => {
      frame++;
      const progress = easeOutExpo(frame / totalFrames);
      el.textContent = Math.round(target * progress);
      if (frame < totalFrames) requestAnimationFrame(step);
      else el.textContent = target;
    };
    // Delay based on --i CSS variable (staggered)
    const delay = parseInt(el.closest('[style*="--i"]')?.style.getPropertyValue('--i') || '0') * 100 + 300;
    setTimeout(() => requestAnimationFrame(step), delay);
  });
})();

/* ── Real-time socket updates ── */
(function() {
  'use strict';
  const t = (k) => (window.webI18n ? window.webI18n.t(k) : k);

  function init(socket) {
    socket.emit('requestGames');

    // Listen for game events
    socket.on('gameEvent', (data) => {
      addActivity(data);
      switch (data.event) {
        case 'gameCreated':
          addGameCard(data);
          incrementStat('active-games', 1);
          break;
        case 'gameEnded':
          removeGameCard(data.gameId);
          incrementStat('active-games', -1);
          break;
        case 'playerJoined':
          incrementStat('active-players', 1);
          updateGameCard(data.gameId, data);
          break;
        case 'playerKilled':
          incrementStat('active-players', -1);
          updateGameCard(data.gameId, data);
          break;
        case 'phaseChanged':
        case 'gameStarted':
          updateGameCard(data.gameId, data);
          break;
      }
    });

    // Global events
    socket.on('globalEvent', (data) => {
      addActivity(data);
    });

    socket.on('gameState', (snapshot) => {
      updateGameCard(snapshot.gameId, snapshot);
    });

    socket.on('activeGames', (games) => {
      const grid = document.getElementById('games-grid');
      if (!grid || !games.length) return;
      const empty = grid.querySelector('.empty-state');
      if (empty) empty.remove();
      games.forEach(g => addOrUpdateGameCard(g));
    });
  }

  // === Activity Feed ===
  function addActivity(data) {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;
    
    const emptyEl = feed.querySelector('.activity-empty');
    if (emptyEl) emptyEl.remove();

    let icon, text;
    switch (data.event) {
      case 'gameCreated': icon = '🎮'; text = t('dash.evt_created'); break;
      case 'gameStarted': icon = '🌙'; text = t('dash.evt_started'); break;
      case 'gameEnded': icon = '🏆'; text = t('dash.evt_ended') + ' ' + (data.victor || '?'); break;
      case 'phaseChanged': icon = data.phase === 'NIGHT' ? '🌙' : '☀️'; text = t('dash.evt_phase') + ' ' + t('phase.' + (data.phase || '?')); break;
      case 'playerJoined': icon = '👋'; text = t('dash.evt_joined'); break;
      case 'playerKilled': icon = '💀'; text = (data.playerName || t('dash.evt_default_player')) + ' ' + t('dash.evt_killed'); break;
      default: icon = '📝'; text = data.event || t('dash.evt_default'); break;
    }

    const item = document.createElement('div');
    item.className = 'activity-item';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'activity-icon';
    iconSpan.textContent = icon;
    item.appendChild(iconSpan);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'activity-content';
    const textSpan = document.createElement('span');
    textSpan.className = 'activity-text';
    textSpan.textContent = text;
    contentDiv.appendChild(textSpan);
    const timeSpan = document.createElement('span');
    timeSpan.className = 'activity-time';
    timeSpan.textContent = new Date().toLocaleTimeString();
    contentDiv.appendChild(timeSpan);
    item.appendChild(contentDiv);
    feed.insertBefore(item, feed.firstChild);

    // Limit to 20 items
    while (feed.children.length > 20) feed.removeChild(feed.lastChild);
  }

  function addGameCard(data) {
    const grid = document.getElementById('games-grid');
    if (!grid) return;
    const empty = grid.querySelector('.empty-state');
    if (empty) empty.remove();
    if (grid.querySelector(`[data-game="${data.gameId}"]`)) return;

    const card = document.createElement('a');
    card.href = `/game/${encodeURIComponent(data.gameId)}`;
    card.className = 'game-card';
    card.setAttribute('data-game', data.gameId);

    // Build card with safe DOM methods
    const header = document.createElement('div');
    header.className = 'game-card-header';
    const phaseSpan = document.createElement('span');
    phaseSpan.className = 'game-phase phase-lobby';
    phaseSpan.textContent = t('dash.phase_lobby');
    header.appendChild(phaseSpan);
    const daySpan = document.createElement('span');
    daySpan.className = 'game-day';
    header.appendChild(daySpan);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'game-card-body';
    const guildDiv = document.createElement('div');
    guildDiv.className = 'game-guild';
    guildDiv.textContent = data.guildName || data.guildId || t('fb.unknown');
    body.appendChild(guildDiv);
    const playersDiv = document.createElement('div');
    playersDiv.className = 'game-players';
    const aliveSpan = document.createElement('span');
    aliveSpan.className = 'alive-count';
    aliveSpan.textContent = '❤ 0 ' + t('dash.alive_count');
    playersDiv.appendChild(aliveSpan);
    const deadSpan = document.createElement('span');
    deadSpan.className = 'dead-count';
    deadSpan.textContent = '💀 0 ' + t('dash.dead_count');
    playersDiv.appendChild(deadSpan);
    body.appendChild(playersDiv);
    card.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'game-card-footer';
    const spectateBtn = document.createElement('span');
    spectateBtn.className = 'spectate-btn';
    spectateBtn.textContent = '👁 ' + t('dash.spectate_btn');
    footer.appendChild(spectateBtn);
    card.appendChild(footer);
    card.style.animation = 'fadeIn 0.4s ease';
    grid.appendChild(card);
  }

  function removeGameCard(gameId) {
    const card = document.querySelector(`[data-game="${gameId}"]`);
    if (card) {
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
      setTimeout(() => card.remove(), 300);
    }
  }

  function updateGameCard(gameId, data) {
    const card = document.querySelector(`[data-game="${gameId}"]`);
    if (!card) return addOrUpdateGameCard(data);

    if (data.phase) {
      const phase = card.querySelector('.game-phase');
      if (phase) {
        phase.textContent = t('phase.' + data.phase);
        phase.className = `game-phase phase-${data.phase.toLowerCase()}`;
      }
    }
    if (data.dayCount) {
      const day = card.querySelector('.game-day');
      if (day) day.textContent = t('dash.day_prefix') + ' ' + data.dayCount;
    }
    // Resolve guild name if available
    const guildName = data.guildName || (data.snapshot && data.snapshot.guildName);
    if (guildName) {
      const guildEl = card.querySelector('.game-guild');
      if (guildEl) guildEl.textContent = guildName;
    }
    const snap = data.snapshot || data;
    if (snap && snap.players) {
      const alive = snap.players.filter(p => p.alive).length;
      const dead = snap.dead ? snap.dead.length : 0;
      const aliveEl = card.querySelector('.alive-count');
      const deadEl = card.querySelector('.dead-count');
      if (aliveEl) aliveEl.innerHTML = `❤ ${alive} <span data-i18n="dash.alive_count">${t('dash.alive_count')}</span>`;
      if (deadEl) deadEl.innerHTML = `💀 ${dead} <span data-i18n="dash.dead_count">${t('dash.dead_count')}</span>`;
    }
  }

  function addOrUpdateGameCard(data) {
    const gameId = data.gameId || data.guildId;
    if (!gameId) return;
    if (document.querySelector(`[data-game="${gameId}"]`)) {
      return updateGameCard(gameId, { ...data, snapshot: data });
    }
    addGameCard(data);
    updateGameCard(data.gameId, { ...data, snapshot: data });
  }

  function incrementStat(id, delta) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = parseInt(el.textContent) || 0;
    el.textContent = Math.max(0, current + delta);
  }

  if (window.werewolfSocket) {
    init(window.werewolfSocket);
  } else {
    window.addEventListener('werewolf:socket-ready', (e) => init(e.detail.socket));
  }
})();

/**
 * Card Deck Draw — shuffle & reveal a random role
 */
(function() {
  'use strict';
  const t = (k) => (window.webI18n ? window.webI18n.t(k) : k);

  function getLang() { return window.webI18n ? window.webI18n.getLang() : 'fr'; }

  const CAMP_KEYS = { village: 'dash.camp_village', wolves: 'dash.camp_wolves', solo: 'dash.camp_solo' };

  let ROLES;
  if (window.__ROLE_DATA__ && Array.isArray(window.__ROLE_DATA__) && window.__ROLE_DATA__.length) {
    ROLES = window.__ROLE_DATA__.map(function(r) {
      return {
        id: r.id, camp: r.camp, img: r.image, cmd: r.cmd || '',
        names: r.name, descs: r.desc
      };
    });
  } else {
    console.warn('[dashboard] __ROLE_DATA__ missing — card deck disabled');
    ROLES = [];
  }

  const CAMP_CLASSES = {
    wolves: 'camp-wolves',
    village: 'camp-village',
    solo: 'camp-solo'
  };

  if (!ROLES.length) return;

  const btn = document.getElementById('btn-draw');
  const deckStack = document.getElementById('deck-stack');
  const drawnZone = document.getElementById('drawn-card-zone');
  const drawnInner = document.getElementById('drawn-card-inner');
  const roleImg = document.getElementById('drawn-role-img');
  const roleName = document.getElementById('drawn-role-name');
  const roleCamp = document.getElementById('drawn-role-camp');
  const roleDesc = document.getElementById('drawn-role-desc');
  const roleCmd = document.getElementById('drawn-role-cmd');
  const roleInfo = document.getElementById('drawn-role-info');

  if (!btn || !deckStack) return;

  let busy = false;
  let lastRoleIndex = -1;

  btn.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;

    const isRedraw = roleInfo.classList.contains('visible');

    const performDraw = () => {
      // Reset previous draw
      drawnZone.classList.remove('visible');
      drawnInner.classList.remove('flipped');
      roleInfo.classList.remove('visible');
      roleInfo.classList.remove('fade-out');

      // Pick a random role (avoid repeat)
      let idx;
      do { idx = Math.floor(Math.random() * ROLES.length); } while (idx === lastRoleIndex && ROLES.length > 1);
      lastRoleIndex = idx;
      const role = ROLES[idx];

      // Phase 1: Shuffle animation (0.7s)
      deckStack.classList.add('shuffling');

      setTimeout(() => {
        deckStack.classList.remove('shuffling');

        // Phase 2: Card slides out from deck (0.4s)
        drawnZone.classList.add('visible');

        // Populate card back content (translate at render time)
        const lang = getLang();
        const roleName_ = role.names[lang] || role.names.fr;
        const roleDesc_ = role.descs[lang] || role.descs.fr;
        const campLabel = t(CAMP_KEYS[role.camp] || role.camp);

        roleImg.src = '/static/img/roles/' + role.img;
        roleImg.alt = roleName_;
        roleName.textContent = roleName_;
        roleCamp.textContent = campLabel;
        roleCamp.className = 'drawn-role-camp ' + (CAMP_CLASSES[role.camp] || '');
        roleDesc.textContent = roleDesc_;
        roleCmd.textContent = role.cmd;

        // Phase 3: Flip to reveal (after slide-in)
        setTimeout(() => {
          drawnInner.classList.add('flipped');
          // Phase 4: Show role info below after flip completes
          setTimeout(() => {
            roleInfo.classList.add('visible');
            busy = false;
            btn.disabled = false;
          }, 600);
        }, 500);
      }, 750);
    };

    // If re-drawing, fade out description smoothly first
    if (isRedraw) {
      roleInfo.classList.add('fade-out');
      setTimeout(performDraw, 350);
    } else {
      performDraw();
    }
  });
})();
