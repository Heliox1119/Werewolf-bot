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

/**
 * Card Deck Draw — shuffle & reveal a random role
 */
(function() {
  'use strict';

  const ROLES = [
    { id: 'WEREWOLF', name: 'Loup-Garou', camp: 'wolves', campLabel: 'Loups', img: 'loupSimple.webp', cmd: '/kill @joueur', desc: 'Chaque nuit, les loups-garous se réunissent pour dévorer un villageois.' },
    { id: 'VILLAGER', name: 'Villageois', camp: 'village', campLabel: 'Village', img: 'villageois.webp', cmd: '/vote @joueur', desc: 'Un simple villageois sans pouvoir spécial. Il doit démasquer les loups.' },
    { id: 'SEER', name: 'Voyante', camp: 'village', campLabel: 'Village', img: 'voyante.webp', cmd: '/see @joueur', desc: 'Chaque nuit, la voyante peut découvrir le rôle d\'un joueur.' },
    { id: 'WITCH', name: 'Sorcière', camp: 'village', campLabel: 'Village', img: 'sorciere.png', cmd: '/potion vie|mort @joueur', desc: 'Possède une potion de vie et une potion de mort, utilisable une fois chacune.' },
    { id: 'HUNTER', name: 'Chasseur', camp: 'village', campLabel: 'Village', img: 'chasseur.webp', cmd: '/shoot @joueur', desc: 'En mourant, le chasseur peut emporter un autre joueur avec lui.' },
    { id: 'WHITE_WOLF', name: 'Loup Blanc', camp: 'solo', campLabel: 'Solo', img: 'loupBlanc.webp', cmd: '/kill @joueur', desc: 'Joue en solitaire. Une nuit sur deux, il peut dévorer un loup-garou.' },
    { id: 'PETITE_FILLE', name: 'Petite Fille', camp: 'village', campLabel: 'Village', img: 'petiteFille.webp', cmd: '/listen', desc: 'Peut espionner les loups-garous pendant la nuit.' },
    { id: 'CUPID', name: 'Cupidon', camp: 'village', campLabel: 'Village', img: 'cupidon.webp', cmd: '/love @joueur1 @joueur2', desc: 'Désigne deux amoureux au début de la partie.' },
    { id: 'SALVATEUR', name: 'Salvateur', camp: 'village', campLabel: 'Village', img: 'salvateur.webp', cmd: '/protect @joueur', desc: 'Chaque nuit, il protège un joueur de l\'attaque des loups-garous.' },
    { id: 'ANCIEN', name: 'Ancien', camp: 'village', campLabel: 'Village', img: 'ancien.webp', cmd: '/vote @joueur', desc: 'Résiste à la première attaque des loups-garous.' },
    { id: 'IDIOT', name: 'Idiot du Village', camp: 'village', campLabel: 'Village', img: 'idiot.webp', cmd: '/vote @joueur', desc: 'S\'il est voté par le village, il est révélé mais perd son droit de vote.' },
    { id: 'THIEF', name: 'Voleur', camp: 'village', campLabel: 'Village', img: 'voleur.webp', cmd: '/steal @carte', desc: 'Découvre 2 cartes et peut en choisir une pour échanger son rôle.' }
  ];

  const CAMP_CLASSES = {
    wolves: 'camp-wolves',
    village: 'camp-village',
    solo: 'camp-solo'
  };

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

        // Populate card back content
        roleImg.src = '/static/img/roles/' + role.img;
        roleImg.alt = role.name;
        roleName.textContent = role.name;
        roleCamp.textContent = role.campLabel;
        roleCamp.className = 'drawn-role-camp ' + (CAMP_CLASSES[role.camp] || '');
        roleDesc.textContent = role.desc;
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
