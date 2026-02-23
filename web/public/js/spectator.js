/**
 * 🐺 Spectator — Live game WebSocket feed
 */
(function() {
  'use strict';

  const page = document.querySelector('.spectator-page');
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
      phaseEl.className = `game-phase phase-${phase.toLowerCase()}`;
    }
    if (subEl) subEl.textContent = subPhase || '';
    if (dayEl && dayCount) dayEl.textContent = 'Day ' + dayCount;
  }

  function updatePlayers(snapshot) {
    if (!snapshot.players) return;
    const list = document.getElementById('player-list');
    const aliveCount = document.getElementById('alive-count');
    if (!list) return;

    list.innerHTML = '';
    let alive = 0;
    snapshot.players.forEach(p => {
      if (p.alive) alive++;
      const div = document.createElement('div');
      div.className = `player-row ${p.alive ? 'alive' : 'dead'}`;
      div.dataset.playerId = p.id;
      div.innerHTML = `
        <span class="player-status">${p.alive ? '❤️' : '💀'}</span>
        <span class="player-name">${p.username}</span>
        ${!p.alive && p.role ? `<span class="player-role">${p.role}</span>` : ''}
        ${p.isCaptain ? '<span class="player-badge">👑</span>' : ''}
        ${p.inLove ? '<span class="player-badge">💕</span>' : ''}
      `;
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
    const rows = document.querySelectorAll('.player-row');
    rows.forEach(row => {
      if (row.dataset.playerId === identifier || row.querySelector('.player-name')?.textContent === identifier) {
        row.className = 'player-row dead';
        row.querySelector('.player-status').textContent = '💀';
        if (role) {
          const existing = row.querySelector('.player-role');
          if (!existing) {
            const span = document.createElement('span');
            span.className = 'player-role';
            span.textContent = role;
            row.appendChild(span);
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
    const className = data.className || `event-${data.event === 'playerKilled' ? 'kill' : data.event === 'phaseChanged' ? 'phase' : 'info'}`;
    div.className = `event-item ${className}`;

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

    div.innerHTML = `<span class="event-time">${time}</span><span class="event-text">${text}</span>`;
    
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
