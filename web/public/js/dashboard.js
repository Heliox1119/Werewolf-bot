/**
 * 🐺 Dashboard — Real-time game updates
 */
(function() {
  'use strict';

  function init(socket) {
    // Request all active games
    socket.emit('requestGames');

    // Listen for game events
    socket.on('gameEvent', (data) => {
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

    // Receive full game state
    socket.on('gameState', (snapshot) => {
      updateGameCard(snapshot.gameId, snapshot);
    });

    // Receive all active games
    socket.on('activeGames', (games) => {
      const grid = document.getElementById('games-grid');
      if (!grid || !games.length) return;
      // Clear "no games" message
      const empty = grid.querySelector('.empty-state');
      if (empty) empty.remove();
      games.forEach(g => addOrUpdateGameCard(g));
    });
  }

  function addGameCard(data) {
    const grid = document.getElementById('games-grid');
    if (!grid) return;
    const empty = grid.querySelector('.empty-state');
    if (empty) empty.remove();

    if (grid.querySelector(`[data-game="${data.gameId}"]`)) return;

    const card = document.createElement('a');
    card.href = `/game/${data.gameId}`;
    card.className = 'game-card';
    card.setAttribute('data-game', data.gameId);
    card.innerHTML = `
      <div class="game-card-header">
        <span class="game-phase phase-lobby">Lobby</span>
        <span class="game-day"></span>
      </div>
      <div class="game-card-body">
        <div class="game-guild">${data.guildId || 'Unknown'}</div>
        <div class="game-players">
          <span class="alive-count">👤 0 alive</span>
          <span class="dead-count">💀 0 dead</span>
        </div>
      </div>
      <div class="game-card-footer"><span class="spectate-btn">👁 Spectate Live</span></div>
    `;
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
        phase.textContent = data.phase;
        phase.className = `game-phase phase-${data.phase.toLowerCase()}`;
      }
    }
    if (data.dayCount) {
      const day = card.querySelector('.game-day');
      if (day) day.textContent = 'Day ' + data.dayCount;
    }
    if (data.snapshot && data.snapshot.players) {
      const alive = data.snapshot.players.filter(p => p.alive).length;
      const dead = data.snapshot.dead ? data.snapshot.dead.length : 0;
      const aliveEl = card.querySelector('.alive-count');
      const deadEl = card.querySelector('.dead-count');
      if (aliveEl) aliveEl.textContent = `👤 ${alive} alive`;
      if (deadEl) deadEl.textContent = `💀 ${dead} dead`;
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

  // Wait for socket
  if (window.werewolfSocket) {
    init(window.werewolfSocket);
  } else {
    window.addEventListener('werewolf:socket-ready', (e) => init(e.detail.socket));
  }
})();
