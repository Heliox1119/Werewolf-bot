/**
 * Dashboard — Real-time game updates + activity feed
 */
(function() {
  'use strict';

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
      case 'gameCreated': icon = '🎮'; text = 'Nouvelle partie créée'; break;
      case 'gameStarted': icon = '🌙'; text = 'Partie démarrée'; break;
      case 'gameEnded': icon = '🏆'; text = `Fin — ${data.victor || '?'}`; break;
      case 'phaseChanged': icon = data.phase === 'NIGHT' ? '🌙' : '☀️'; text = `Phase → ${data.phase || '?'}`; break;
      case 'playerJoined': icon = '👋'; text = `Joueur rejoint`; break;
      case 'playerKilled': icon = '💀'; text = `${data.playerName || 'Joueur'} éliminé`; break;
      default: icon = '📝'; text = data.event || 'Événement'; break;
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
    phaseSpan.textContent = 'Lobby';
    header.appendChild(phaseSpan);
    const daySpan = document.createElement('span');
    daySpan.className = 'game-day';
    header.appendChild(daySpan);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'game-card-body';
    const guildDiv = document.createElement('div');
    guildDiv.className = 'game-guild';
    guildDiv.textContent = data.guildName || data.guildId || 'Unknown';
    body.appendChild(guildDiv);
    const playersDiv = document.createElement('div');
    playersDiv.className = 'game-players';
    const aliveSpan = document.createElement('span');
    aliveSpan.className = 'alive-count';
    aliveSpan.textContent = '❤ 0 vivants';
    playersDiv.appendChild(aliveSpan);
    const deadSpan = document.createElement('span');
    deadSpan.className = 'dead-count';
    deadSpan.textContent = '💀 0 morts';
    playersDiv.appendChild(deadSpan);
    body.appendChild(playersDiv);
    card.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'game-card-footer';
    const spectateBtn = document.createElement('span');
    spectateBtn.className = 'spectate-btn';
    spectateBtn.textContent = '👁 Regarder en direct';
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
        phase.textContent = data.phase;
        phase.className = `game-phase phase-${data.phase.toLowerCase()}`;
      }
    }
    if (data.dayCount) {
      const day = card.querySelector('.game-day');
      if (day) day.textContent = 'Jour ' + data.dayCount;
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
      if (aliveEl) aliveEl.textContent = `❤ ${alive} vivants`;
      if (deadEl) deadEl.textContent = `💀 ${dead} morts`;
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
