/**
 * 🐺 Spectator — Live game WebSocket feed
 */
(function() {
  'use strict';

  const page = document.querySelector('.sp-page');
  if (!page) return;
  const gameId = page.dataset.gameId;
  const STORAGE_KEY = `sp-events-${gameId}`;

  // --- sessionStorage fallback for event persistence ---
  function loadEventsFromStorage() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function saveEventsToStorage(events) {
    try {
      // Keep max 200 events in storage
      const trimmed = events.slice(-200);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch { /* quota exceeded — ignore */ }
  }

  // In-memory event list (survives within a PJAX session, repopulated from WS or storage)
  let eventCache = loadEventsFromStorage();

  function init(socket) {
    console.log('[spectator] init() called, gameId:', gameId, 'socket connected:', socket.connected);

    // Remove old listeners (prevents duplicates on PJAX re-navigation)
    socket.off('gameState');
    socket.off('gameEventHistory');
    socket.off('gameEvent');
    socket.off('spectatorCount');
    socket.off('error');

    // Restore feed from sessionStorage immediately (before WS data arrives)
    if (eventCache.length > 0) {
      const feed = document.getElementById('event-feed');
      if (feed) {
        feed.innerHTML = '';
        eventCache.forEach(evt => addEventToFeed(evt, true));
        console.log('[spectator] Restored', eventCache.length, 'events from sessionStorage');
      }
    }

    // Join spectator room
    socket.emit('spectate', gameId);
    console.log('[spectator] Emitted spectate for gameId:', gameId);

    // Server error handler
    socket.on('error', (err) => {
      console.warn('[spectator] Server error:', err);
    });

    // Full game state update
    socket.on('gameState', (snapshot) => {
      console.log('[spectator] Received gameState');
      updatePhase(snapshot);
      updatePlayers(snapshot);
      updateInfo(snapshot);
    });

    // Event history replay (for late-joining spectators or refresh)
    socket.on('gameEventHistory', (data) => {
      console.log('[spectator] Received gameEventHistory:', data.events ? data.events.length : 0, 'events');
      if (data.gameId !== gameId || !data.events || data.events.length === 0) return;
      const feed = document.getElementById('event-feed');
      if (!feed) return;
      // Replace local cache with server buffer (authoritative)
      eventCache = data.events;
      saveEventsToStorage(eventCache);
      // Clear and replay
      feed.innerHTML = '';
      eventCache.forEach(evt => addEventToFeed(evt, true));
    });

    // Incremental events
    socket.on('gameEvent', (data) => {
      if (data.gameId !== gameId) return;
      addEventToFeed(data);
      // Append to cache and persist
      eventCache.push(data);
      if (eventCache.length > 200) eventCache.shift();
      saveEventsToStorage(eventCache);

      switch (data.event) {
        case 'phaseChanged':
          updatePhaseDisplay(data.phase, data.subPhase, data.dayCount);
          break;
        case 'playerKilled':
          markPlayerDead(data.playerId || data.playerName, data.role);
          break;
        case 'gameEnded':
          addEventToFeed({ event: 'victory', text: `🎉 Game Over! ${data.victor || 'Unknown'} wins!`, className: 'event-victory' });
          break;
      }
    });

    // Spectator count
    socket.on('spectatorCount', (data) => {
      if (data.gameId !== gameId) return;
      const el = document.querySelector('#spectator-count span');
      if (el) el.textContent = data.count;
    });

    // Leave room on page unload
    window.addEventListener('beforeunload', () => socket.emit('leaveSpectate', gameId));
  }

  function updatePhase(snapshot) {
    updatePhaseDisplay(snapshot.phase, snapshot.subPhase, snapshot.dayCount);
  }

  function updatePhaseDisplay(phase, subPhase, dayCount) {
    const phaseEl = document.getElementById('game-phase');
    const subEl = document.getElementById('game-subphase');
    const dayEl = document.getElementById('game-day');

    if (phaseEl && phase) {
      phaseEl.textContent = phase;
      phaseEl.className = `sp-phase game-phase phase-${phase.toLowerCase()}`;
    }
    if (subEl) subEl.textContent = subPhase || '';
    if (dayEl && dayCount) dayEl.textContent = 'Jour ' + dayCount;
  }

  function updatePlayers(snapshot) {
    if (!snapshot.players) return;
    const list = document.getElementById('player-list');
    const aliveCount = document.getElementById('alive-count');
    if (!list) return;

    // Build player lookup for resolving IDs elsewhere
    window._spectatorPlayers = {};
    snapshot.players.forEach(p => { window._spectatorPlayers[p.id] = p; });

    list.innerHTML = '';
    let alive = 0;
    snapshot.players.forEach((p, i) => {
      if (p.alive) alive++;
      const div = document.createElement('div');
      div.className = `sp-player ${p.alive ? 'sp-alive' : 'sp-dead'} clickable-player`;
      div.dataset.playerId = p.id;
      div.dataset.playerAvatar = p.avatar || '';
      div.style.animationDelay = `${0.05 + i * 0.03}s`;
      div.onclick = function() { if (window.openSpectatorPlayerModal) window.openSpectatorPlayerModal(this); };

      // Avatar wrap
      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'sp-player-avatar-wrap';
      if (p.avatar) {
        const img = document.createElement('img');
        img.className = 'sp-player-avatar';
        img.src = p.avatar;
        img.alt = '';
        avatarWrap.appendChild(img);
      } else {
        const avatarSpan = document.createElement('span');
        avatarSpan.className = 'sp-player-avatar sp-player-avatar-default';
        avatarSpan.textContent = '👤';
        avatarWrap.appendChild(avatarSpan);
      }
      const statusDot = document.createElement('span');
      statusDot.className = `sp-avatar-status ${p.alive ? 'sp-status-alive' : 'sp-status-dead'}`;
      avatarWrap.appendChild(statusDot);
      div.appendChild(avatarWrap);

      // Info
      const info = document.createElement('div');
      info.className = 'sp-player-info';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'sp-player-name';
      nameSpan.textContent = p.username || p.id;
      info.appendChild(nameSpan);

      // Fake player badge
      if (p.id && p.id.startsWith('fake_')) {
        const fakeBadge = document.createElement('span');
        fakeBadge.className = 'sp-badge-fake';
        fakeBadge.textContent = 'BOT';
        info.appendChild(fakeBadge);
      }

      const tags = document.createElement('div');
      tags.className = 'sp-player-tags';
      if (!p.alive && p.role) {
        const roleTag = document.createElement('span');
        roleTag.className = 'sp-role-tag';
        roleTag.textContent = p.role;
        tags.appendChild(roleTag);
      }
      if (p.isCaptain) {
        const badge = document.createElement('span');
        badge.className = 'sp-badge-tag';
        badge.textContent = '👑 Capitaine';
        tags.appendChild(badge);
      }
      if (p.inLove) {
        const badge = document.createElement('span');
        badge.className = 'sp-badge-tag sp-badge-love';
        badge.textContent = '💕';
        tags.appendChild(badge);
      }
      info.appendChild(tags);
      div.appendChild(info);

      const arrow = document.createElement('span');
      arrow.className = 'sp-player-chevron';
      arrow.textContent = '›';
      div.appendChild(arrow);
      list.appendChild(div);
    });
    if (aliveCount) aliveCount.textContent = alive;
    const infoAlive = document.getElementById('info-alive');
    if (infoAlive) infoAlive.textContent = alive;

    // --- Rebuild graveyard section ---
    const dead = snapshot.dead || [];
    const deadCount = snapshot.players ? snapshot.players.filter(p => !p.alive).length : 0;
    const totalDead = dead.length || deadCount;
    const panel = list.closest('.sp-panel-players');
    if (!panel) return;

    // Remove old graveyard
    const oldDivider = panel.querySelector('.sp-graveyard-divider');
    const oldGraveyard = panel.querySelector('.sp-graveyard');
    if (oldDivider) oldDivider.remove();
    if (oldGraveyard) oldGraveyard.remove();

    if (dead.length > 0) {
      // Divider
      const divider = document.createElement('div');
      divider.className = 'sp-graveyard-divider';
      divider.innerHTML = `<span>☠️ Cimetière (${dead.length})</span>`;
      panel.appendChild(divider);

      // Graveyard list
      const graveyard = document.createElement('div');
      graveyard.className = 'sp-graveyard';
      graveyard.id = 'graveyard';
      dead.forEach((d, i) => {
        const row = document.createElement('div');
        row.className = 'sp-grave clickable-player';
        row.dataset.playerId = d.id;
        row.dataset.playerAvatar = d.avatar || '';
        row.style.animationDelay = `${0.05 + i * 0.03}s`;
        row.onclick = function() { if (window.openSpectatorPlayerModal) window.openSpectatorPlayerModal(this); };

        if (d.avatar) {
          const img = document.createElement('img');
          img.className = 'sp-grave-avatar';
          img.src = d.avatar;
          img.alt = '';
          row.appendChild(img);
        } else {
          const skull = document.createElement('span');
          skull.className = 'sp-grave-avatar sp-grave-avatar-default';
          skull.textContent = '☠️';
          row.appendChild(skull);
        }

        const name = document.createElement('span');
        name.className = 'sp-grave-name';
        name.textContent = d.username || d.id;
        row.appendChild(name);

        if (d.id && d.id.startsWith('fake_')) {
          const badge = document.createElement('span');
          badge.className = 'sp-badge-fake';
          badge.textContent = 'BOT';
          row.appendChild(badge);
        }

        const role = document.createElement('span');
        role.className = 'sp-grave-role';
        role.textContent = d.role || '?';
        row.appendChild(role);

        const chevron = document.createElement('span');
        chevron.className = 'sp-player-chevron';
        chevron.textContent = '›';
        row.appendChild(chevron);

        graveyard.appendChild(row);
      });
      panel.appendChild(graveyard);
    }

    // Update info panel counters
    const deadCountEl = document.getElementById('dead-count');
    if (deadCountEl) deadCountEl.textContent = totalDead;
    const playerCountEl = document.getElementById('player-count');
    if (playerCountEl) playerCountEl.textContent = snapshot.players ? snapshot.players.length : 0;
  }

  function updateInfo(snapshot) {
    // Update additional info panels if needed
    const started = document.getElementById('game-started');
    if (started && snapshot.startedAt) {
      started.textContent = new Date(snapshot.startedAt).toLocaleTimeString();
    }
  }

  function markPlayerDead(identifier, role) {
    const rows = document.querySelectorAll('.sp-player');
    rows.forEach(row => {
      if (row.dataset.playerId === identifier || row.querySelector('.sp-player-name')?.textContent === identifier) {
        row.classList.remove('sp-alive');
        row.classList.add('sp-dead');
        const statusDot = row.querySelector('.sp-avatar-status');
        if (statusDot) { statusDot.classList.remove('sp-status-alive'); statusDot.classList.add('sp-status-dead'); }
        if (role) {
          const tags = row.querySelector('.sp-player-tags');
          if (tags && !tags.querySelector('.sp-role-tag')) {
            const span = document.createElement('span');
            span.className = 'sp-role-tag';
            span.textContent = role;
            tags.insertBefore(span, tags.firstChild);
          }
        }
        // Update alive count
        const aliveCount = document.getElementById('alive-count');
        if (aliveCount) {
          const current = parseInt(aliveCount.textContent) || 0;
          aliveCount.textContent = Math.max(0, current - 1);
        }
      }
    });
  }

  function addEventToFeed(data) {
    const feed = document.getElementById('event-feed');
    if (!feed) return;

    const div = document.createElement('div');
    const evType = data.event === 'playerKilled' ? 'kill' : data.event === 'phaseChanged' ? 'phase' : data.event === 'gameEnded' ? 'victory' : 'info';
    div.className = `sp-event sp-ev-${evType}`;

    const time = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    let text = data.text || '';
    if (!text) {
      switch (data.event) {
        case 'phaseChanged': text = `Phase → ${data.phase}${data.subPhase ? ' (' + data.subPhase + ')' : ''}`; break;
        case 'playerKilled': text = `💀 ${data.username || data.playerName || 'A player'} was killed (${data.role || '?'})`; break;
        case 'playerJoined': text = `👋 A player joined (${data.playerCount || '?'} total)`; break;
        case 'gameStarted': text = '🎮 Game started!'; break;
        case 'gameEnded': text = `🏆 ${data.victor || 'Someone'} wins!`; break;
        case 'actionLog': text = `📝 ${data.action || 'Action'}`; break;
        default: text = data.event;
      }
    }

    const timeSpan = document.createElement('span');
    timeSpan.className = 'sp-ev-time';
    timeSpan.textContent = time;
    div.appendChild(timeSpan);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'sp-ev-icon';
    iconSpan.textContent = evType === 'kill' ? '💀' : evType === 'phase' ? '🌙' : evType === 'victory' ? '🏆' : '📝';
    div.appendChild(iconSpan);

    const textSpan = document.createElement('span');
    textSpan.className = 'sp-ev-text';
    textSpan.textContent = text;
    div.appendChild(textSpan);
    
    // Insert at top (newest first)
    feed.insertBefore(div, feed.firstChild);

    // Limit feed to 200 items
    while (feed.children.length > 200) feed.removeChild(feed.lastChild);
  }

  // Wait for socket
  if (window.werewolfSocket) {
    console.log('[spectator] Socket already available, calling init immediately');
    init(window.werewolfSocket);
  } else {
    console.log('[spectator] Waiting for werewolf:socket-ready event');
    window.addEventListener('werewolf:socket-ready', function onReady(e) {
      window.removeEventListener('werewolf:socket-ready', onReady);
      console.log('[spectator] Got socket-ready, calling init');
      init(e.detail.socket);
    });
  }
})();
