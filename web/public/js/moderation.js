/**
 * Moderation panel — Game management, player interactions
 */
(function() {
  'use strict';

  // === Tab Switching ===
  window.switchModGame = function(gameId) {
    document.querySelectorAll('.mod-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.mod-game-panel').forEach(p => p.classList.remove('active'));
    const tab = document.querySelector(`.mod-tab[data-game="${gameId}"]`);
    const panel = document.getElementById(`mod-game-${gameId}`);
    if (tab) tab.classList.add('active');
    if (panel) panel.classList.add('active');
  };

  // === Moderation Actions ===
  window.modAction = async function(action, gameId, playerId) {
    let url, confirmMsg;
    switch (action) {
      case 'force-end':
        confirmMsg = 'Forcer la fin de cette partie ?';
        url = `/api/mod/force-end/${gameId}`;
        break;
      case 'skip-phase':
        confirmMsg = 'Passer à la phase suivante ?';
        url = `/api/mod/skip-phase/${gameId}`;
        break;
      case 'kill-player':
        const card = document.querySelector(`.mod-player-card[data-player-id="${playerId}"][data-game-id="${gameId}"]`);
        const name = card ? card.querySelector('.mod-player-name').textContent : playerId;
        confirmMsg = `Éliminer ${name} ?`;
        url = `/api/mod/kill-player/${gameId}/${playerId}`;
        break;
      default:
        return;
    }

    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const result = await res.json();
      if (result.success) {
        showToast(result.message || 'Action effectuée', 'success');
        // Refresh after short delay
        setTimeout(() => location.reload(), 800);
      } else {
        showToast('Erreur : ' + (result.error || 'Unknown'), 'error');
      }
    } catch (err) {
      showToast('Erreur réseau : ' + err.message, 'error');
    }
  };

  // === Player Modal ===
  window.openPlayerModal = async function(cardEl) {
    const playerId = cardEl.dataset.playerId;
    const gameId = cardEl.dataset.gameId;
    const modal = document.getElementById('player-modal');
    const name = cardEl.querySelector('.mod-player-name').textContent;
    const role = cardEl.querySelector('.mod-player-role')?.textContent || '—';
    const isAlive = !cardEl.classList.contains('dead');
    const isCaptain = !!cardEl.querySelector('.badge-captain');
    const isLover = !!cardEl.querySelector('.badge-love');

    document.getElementById('modal-player-name').textContent = name;
    document.getElementById('modal-profile-link').href = `/player/${playerId}`;

    // Badges
    const badges = document.getElementById('modal-badges');
    badges.innerHTML = '';
    if (isAlive) badges.innerHTML += '<span class="badge badge-alive">&#10084; Vivant</span>';
    else badges.innerHTML += '<span class="badge badge-dead">&#9760; Mort</span>';
    if (isCaptain) badges.innerHTML += '<span class="badge badge-captain">&#128081; Capitaine</span>';
    if (isLover) badges.innerHTML += '<span class="badge badge-love">&#128149; Amoureux</span>';

    // Info
    const infoGrid = document.getElementById('modal-info');
    infoGrid.innerHTML = `
      <div class="modal-info-row"><span class="info-label">Rôle</span><span class="info-value role-tag">${role}</span></div>
      <div class="modal-info-row"><span class="info-label">Statut</span><span class="info-value">${isAlive ? '✅ En vie' : '💀 Éliminé'}</span></div>
      <div class="modal-info-row"><span class="info-label">ID</span><span class="info-value" style="font-family:monospace;font-size:0.75rem;opacity:0.6;">${playerId}</span></div>
    `;

    // Actions
    const actions = document.getElementById('modal-actions');
    actions.innerHTML = '';
    if (isAlive) {
      actions.innerHTML += `<button class="btn btn-sm btn-danger" onclick="modAction('kill-player','${gameId}','${playerId}')">&#9760; Éliminer</button>`;
    }

    // Try to load extended stats
    try {
      const res = await fetch(`/api/players/${playerId}`);
      const result = await res.json();
      if (result.success && result.data) {
        const d = result.data;
        infoGrid.innerHTML += `
          <div class="modal-info-row"><span class="info-label">Parties jouées</span><span class="info-value">${d.games_played || 0}</span></div>
          <div class="modal-info-row"><span class="info-label">Victoires</span><span class="info-value">${d.games_won || 0}</span></div>
          <div class="modal-info-row"><span class="info-label">Win rate</span><span class="info-value">${d.winrate || 0}%</span></div>
          ${d.elo ? `<div class="modal-info-row"><span class="info-label">ELO</span><span class="info-value">${d.elo}</span></div>` : ''}
          ${d.tier ? `<div class="modal-info-row"><span class="info-label">Rang</span><span class="info-value">${d.tier.emoji || ''} ${d.tier.name || ''}</span></div>` : ''}
        `;
      }
    } catch {}

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  window.closePlayerModal = function() {
    document.getElementById('player-modal').classList.remove('open');
    document.body.style.overflow = '';
  };

  // Close modal on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePlayerModal();
  });

  // === Toast Notifications ===
  function showToast(msg, type) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    
    // Force reflow then animate
    toast.offsetHeight;
    toast.classList.add('show');
    console.log('[TOAST]', type, msg);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  // === Real-time updates ===
  function initSocket(socket) {
    socket.on('gameEvent', (data) => {
      const panel = document.getElementById(`mod-game-${data.gameId}`);
      if (!panel) return;

      // Add to log
      const log = document.getElementById(`mod-log-${data.gameId}`);
      if (log) {
        const entry = document.createElement('div');
        entry.className = 'mod-log-entry mod-log-new';
        const time = new Date().toLocaleTimeString();
        let text = '';
        switch (data.event) {
          case 'phaseChanged': text = `Phase → ${data.phase}${data.subPhase ? ' (' + data.subPhase + ')' : ''}`; break;
          case 'playerKilled': text = `💀 ${data.playerName || '?'} éliminé (${data.role || '?'})`; break;
          case 'gameStarted': text = '🎮 Partie démarrée'; break;
          case 'gameEnded': text = `🏆 Fin — ${data.victor || '?'}`; break;
          default: text = data.event;
        }
        entry.innerHTML = `<span class="mod-log-time">${time}</span><span class="mod-log-text">${text}</span>`;
        log.insertBefore(entry, log.firstChild);
      }

      // Refresh on major events
      if (['gameEnded', 'gameStarted'].includes(data.event)) {
        setTimeout(() => location.reload(), 1500);
      }
    });
  }

  if (window.werewolfSocket) {
    initSocket(window.werewolfSocket);
  } else {
    window.addEventListener('werewolf:socket-ready', (e) => initSocket(e.detail.socket));
  }
})();
