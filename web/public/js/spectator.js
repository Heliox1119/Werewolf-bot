/**
 * 🐺 Spectator — Live game WebSocket feed
 */
(function() {
  'use strict';

  const page = document.querySelector('.sp-page');
  if (!page) return;
  const gameId = page.dataset.gameId;

  function init(socket) {
    // Join spectator room
    socket.emit('spectate', gameId);

    // Full game state update
    socket.on('gameState', (snapshot) => {
      updatePhase(snapshot);
      updatePlayers(snapshot);
      updateInfo(snapshot);
    });

    // Incremental events
    socket.on('gameEvent', (data) => {
      if (data.gameId !== gameId) return;
      addEventToFeed(data);

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

    const time = new Date().toLocaleTimeString();
    let text = data.text || '';
    if (!text) {
      switch (data.event) {
        case 'phaseChanged': text = `Phase → ${data.phase}${data.subPhase ? ' (' + data.subPhase + ')' : ''}`; break;
        case 'playerKilled': text = `💀 ${data.playerName || 'A player'} was killed (${data.role || '?'})`; break;
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
    
    // Insert at top
    feed.insertBefore(div, feed.firstChild);

    // Limit feed to 50 items
    while (feed.children.length > 50) feed.removeChild(feed.lastChild);
  }

  // Wait for socket
  if (window.werewolfSocket) {
    init(window.werewolfSocket);
  } else {
    window.addEventListener('werewolf:socket-ready', (e) => init(e.detail.socket));
  }
})();
