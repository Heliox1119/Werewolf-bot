const ROLES = require("./roles");
const PHASES = require("./phases");
const fs = require('fs');
const path = require('path');
const { game: logger } = require('../utils/logger');
const GameDatabase = require('../database/db');

// Timeouts configurables (en ms)
const TIMEOUTS = {
  LOBBY_AUTO_CLEANUP: 60 * 60 * 1000, // 1h
  NIGHT_AFK: 90_000,                   // 90s
  HUNTER_SHOOT: 60_000,                // 60s
  RECENT_COMMAND_WINDOW: 5_000,        // 5s
  RECENT_COMMAND_CLEANUP: 30_000,      // 30s
  RECENT_COMMAND_INTERVAL: 60_000      // 60s interval de nettoyage
};

class GameManager {
  constructor() {
    this.games = new Map(); // Cache en mémoire pour performance
    this.db = new GameDatabase(); // Base de données SQLite
    this.lobbyTimeouts = new Map(); // channelId -> timeoutId
    this.saveTimeout = null; // Debounce saveState calls
    this.saveInProgress = false;
    this.creationsInProgress = new Set(); // Track ongoing channel creation to prevent duplicates
    this.recentCommands = new Map(); // Cache pour déduplication: "command:channelId:userId" -> timestamp
    
    // Nettoyage périodique des recentCommands
    this._recentCommandsInterval = setInterval(() => {
      const now = Date.now();
      for (const [k, timestamp] of this.recentCommands.entries()) {
        if (now - timestamp > TIMEOUTS.RECENT_COMMAND_CLEANUP) {
          this.recentCommands.delete(k);
        }
      }
    }, TIMEOUTS.RECENT_COMMAND_INTERVAL);
  }

  // Check if command was recently executed (within 5 seconds) to prevent Discord retries
  isRecentDuplicate(commandName, channelId, userId) {
    const key = `${commandName}:${channelId}:${userId}`;
    const lastExecution = this.recentCommands.get(key);
    
    if (lastExecution) {
      const elapsed = Date.now() - lastExecution;
      if (elapsed < TIMEOUTS.RECENT_COMMAND_WINDOW) {
        logger.warn('Duplicate command detected (Discord retry)', { 
          command: commandName,
          channelId,
          userId,
          elapsedMs: elapsed 
        });
        return true;
      }
    }
    
    // Mark this execution
    this.recentCommands.set(key, Date.now());
    
    return false;
  }

  setLobbyTimeout(channelId) {
    this.clearLobbyTimeout(channelId);
    const timeoutId = setTimeout(async () => {
      const game = this.games.get(channelId);
      if (!game) return;
      try {
        // On suppose que le bot principal est accessible via require.main.exports.client
        const bot = require.main && require.main.exports && require.main.exports.client ? require.main.exports.client : null;
        const guild = bot ? bot.guilds.cache.get(process.env.GUILD_ID) : null;
        if (guild) {
          await this.cleanupChannels(guild, game);
          this.clearGameTimers(game);
          this.games.delete(channelId);
          // Supprimer de la DB
          this.db.deleteGame(channelId);
          logger.info(`💤 Lobby auto-deleted after 1h of inactivity`, { channelId });
        }
      } catch (e) { logger.error('Auto-cleanup lobby failed', e); }
    }, TIMEOUTS.LOBBY_AUTO_CLEANUP);
    this.lobbyTimeouts.set(channelId, timeoutId);
  }

  clearLobbyTimeout(channelId) {
    const timeoutId = this.lobbyTimeouts.get(channelId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.lobbyTimeouts.delete(channelId);
    }
  }

  // Nettoyer tous les timers d'une partie (AFK nuit, chasseur)
  clearGameTimers(game) {
    this.clearNightAfkTimeout(game);
    if (game._hunterTimer) {
      clearTimeout(game._hunterTimer);
      game._hunterTimer = null;
    }
  }

  // Nettoyage global (pour shutdown propre)
  destroy() {
    // Clear recentCommands interval
    if (this._recentCommandsInterval) {
      clearInterval(this._recentCommandsInterval);
      this._recentCommandsInterval = null;
    }
    // Clear all game timers
    for (const game of this.games.values()) {
      this.clearGameTimers(game);
    }
    // Clear all lobby timeouts
    for (const timeoutId of this.lobbyTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.lobbyTimeouts.clear();
    // Save state and close DB
    this.saveState();
    if (this.db) {
      this.db.close();
    }
  }

  // Retourne toutes les parties actives sous forme de tableau
  getAllGames() {
    return Array.from(this.games.values());
  }

  create(channelId, options = {}) {
    if (this.games.has(channelId)) return false;

    const minPlayers = options.minPlayers ?? 5;
    const maxPlayers = options.maxPlayers ?? 10;

    // Créer dans la base de données
    const gameId = this.db.createGame(channelId, {
      lobbyHostId: options.lobbyHostId || null,
      minPlayers,
      maxPlayers,
      disableVoiceMute: options.disableVoiceMute || false
    });

    if (!gameId) {
      logger.warn('Game already exists in DB', { channelId });
      return false;
    }

    // Initialiser les potions de la sorcière dans la DB
    this.db.initWitchPotions(channelId);

    // Créer dans le cache mémoire
    this.games.set(channelId, {
      mainChannelId: channelId,
      lobbyMessageId: null,
      lobbyHostId: options.lobbyHostId || null,
      voiceChannelId: null,
      villageChannelId: null,
      wolvesChannelId: null,
      seerChannelId: null,
      witchChannelId: null,
      phase: PHASES.NIGHT,
      subPhase: PHASES.LOUPS, // commence par les loups
      dayCount: 0,
      captainId: null,
      captainVotes: new Map(),
      captainVoters: new Map(),
      cupidChannelId: null,
      lovers: [],
      players: [],
      dead: [],
      votes: new Map(),
      voteVoters: new Map(),
      witchPotions: { life: true, death: true },
      nightVictim: null,
      witchKillTarget: null,
      witchSave: false,
      rules: { minPlayers, maxPlayers },
      actionLog: [],
      startedAt: null,
      endedAt: null,
      disableVoiceMute: options.disableVoiceMute || false
    });

    // Démarrer le timeout de lobby zombie (1h)
    this.setLobbyTimeout(channelId);
    
    // Enregistrer dans le monitoring
    try {
      const MetricsCollector = require('../monitoring/metrics');
      const metrics = MetricsCollector.getInstance();
      metrics.recordGameCreated();
    } catch {}
    
    return true;
  }

  getGameByChannelId(channelId) {
    if (this.games.has(channelId)) return this.games.get(channelId);

    for (const game of this.games.values()) {
      const ids = [
        game.mainChannelId,
        game.villageChannelId,
        game.wolvesChannelId,
        game.seerChannelId,
        game.witchChannelId,
        game.cupidChannelId,
        game.voiceChannelId
      ].filter(Boolean);

      if (ids.includes(channelId)) return game;
    }

    return null;
  }

  logAction(game, text) {
    if (!game) return;
    if (!Array.isArray(game.actionLog)) game.actionLog = [];
    game.actionLog.push({ ts: Date.now(), text });
    if (game.actionLog.length > 200) {
      game.actionLog.shift();
    }
    // Sauvegarder dans la DB
    this.db.addLog(game.mainChannelId, text);
  }

  formatPayloadSummary(payload) {
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload === 'object') {
      return payload.content || '[embed/complex]';
    }
    return '[unknown]';
  }

  async sendLogged(channel, payload, context = {}) {
    try {
      logger.info('Channel send', {
        channelId: channel?.id,
        channelName: channel?.name,
        context,
        content: this.formatPayloadSummary(payload)
      });
      return await channel.send(payload);
    } catch (err) {
      logger.error('Channel send failed', {
        channelId: channel?.id,
        channelName: channel?.name,
        error: err.message
      });
      throw err;
    }
  }

  isRealPlayerId(id) {
    return typeof id === 'string' && /^\d+$/.test(id);
  }

  getAliveRealPlayersByRole(game, role) {
    return game.players.filter(p => p.alive && p.role === role && this.isRealPlayerId(p.id));
  }

  hasAliveRealRole(game, role) {
    return this.getAliveRealPlayersByRole(game, role).length > 0;
  }

  async transitionToDay(guild, game) {
    if (game._transitioning) return;
    if (game.phase !== PHASES.NIGHT) return;
    game._transitioning = true;

    try {
      const newPhase = await this.nextPhase(guild, game);
      if (newPhase !== PHASES.DAY) return;

      if (game.voiceChannelId) {
        this.playAmbience(game.voiceChannelId, 'day_ambience.mp3');
      }

      const mainChannel = game.villageChannelId
        ? await guild.channels.fetch(game.villageChannelId)
        : await guild.channels.fetch(game.mainChannelId);

      await this.sendLogged(mainChannel, `☀️ **LE JOUR SE LÈVE**\n\n` +
        `Tous les micros sont réactivés. Le village discute et vote !\n` +
        `Utilisez \`/vote @joueur\` pour voter pour éliminer quelqu'un.`, { type: 'transitionToDay' });

      // Collecter les morts de la nuit pour vérifier le chasseur après
      const nightDeaths = [];

      if (game.nightVictim) {
        if (game.witchSave) {
          await this.sendLogged(mainChannel, `✨ La victime des loups a été sauvée par la sorcière !`, { type: 'witchSave' });
          this.logAction(game, 'Sorciere sauve la victime des loups');
        } else {
          const victimPlayer = game.players.find(p => p.id === game.nightVictim);
          if (victimPlayer && victimPlayer.alive) {
            if (game.voiceChannelId) {
              this.playAmbience(game.voiceChannelId, 'death.mp3');
            }
            await this.sendLogged(mainChannel, `💀 **${victimPlayer.username}** s'est fait dévorer la nuit ! 🐺`, { type: 'nightVictim' });
            this.kill(game.mainChannelId, game.nightVictim);
            nightDeaths.push(victimPlayer);
            this.logAction(game, `Mort la nuit: ${victimPlayer.username}`);
          }
        }
        game.nightVictim = null;
      }

      // Résoudre la potion de mort de la sorcière (à l'aube)
      if (game.witchKillTarget) {
        const witchVictim = game.players.find(p => p.id === game.witchKillTarget);
        if (witchVictim && witchVictim.alive) {
          await this.sendLogged(mainChannel, `💀 **${witchVictim.username}** a été empoisonné pendant la nuit ! 🧪`, { type: 'witchKill' });
          this.kill(game.mainChannelId, game.witchKillTarget);
          nightDeaths.push(witchVictim);
          this.logAction(game, `Empoisonné: ${witchVictim.username}`);
        }
        game.witchKillTarget = null;
      }

      game.witchSave = false;
      this.scheduleSave();

      // Vérifier si un chasseur est mort cette nuit — il doit tirer
      for (const dead of nightDeaths) {
        if (dead.role === ROLES.HUNTER) {
          game._hunterMustShoot = dead.id;
          await this.sendLogged(mainChannel, `🏹 **${dead.username}** était le Chasseur ! Il doit tirer sur quelqu'un avec \`/shoot @joueur\` !`, { type: 'hunterDeath' });
          // Lancer un timeout de 60s pour le chasseur
          this.startHunterTimeout(guild, game, dead.id);
          break;
        }
      }

      await this.announceVictoryIfAny(guild, game);
    } finally {
      game._transitioning = false;
    }
  }

  async transitionToNight(guild, game) {
    if (game._transitioning) return;
    if (game.phase !== PHASES.DAY) return;
    game._transitioning = true;

    try {
      const newPhase = await this.nextPhase(guild, game);
      if (newPhase !== PHASES.NIGHT) return;

      if (game.voiceChannelId) {
        this.playAmbience(game.voiceChannelId, 'night_ambience.mp3');
      }

      const mainChannel = game.villageChannelId
        ? await guild.channels.fetch(game.villageChannelId)
        : await guild.channels.fetch(game.mainChannelId);

      await this.sendLogged(mainChannel, `🌙 **LA NUIT TOMBE**\n\n` +
        `Les micros se coupent pour tout le monde.\n` +
        `Les loups choisissent leur victime avec \`/kill @joueur\``, { type: 'transitionToNight' });

      const allVotes = Array.from(game.votes.entries()).sort((a, b) => b[1] - a[1]);
      if (allVotes.length > 0) {
        const [votedId, voteCount] = allVotes[0];
        const votedPlayer = game.players.find(p => p.id === votedId);
        if (votedPlayer && votedPlayer.alive) {
          if (game.voiceChannelId) {
            this.playAmbience(game.voiceChannelId, 'death.mp3');
          }
          await this.sendLogged(mainChannel, `🔨 **${votedPlayer.username}** a été éliminé par le village ! (${voteCount} votes)`, { type: 'dayVoteResult' });
          this.kill(game.mainChannelId, votedId);
          this.logAction(game, `Vote du village: ${votedPlayer.username} elimine`);

          // Vérifier si le joueur éliminé était le chasseur
          if (votedPlayer.role === ROLES.HUNTER) {
            game._hunterMustShoot = votedPlayer.id;
            await this.sendLogged(mainChannel, `🏹 **${votedPlayer.username}** était le Chasseur ! Il doit tirer sur quelqu'un avec \`/shoot @joueur\` !`, { type: 'hunterDeath' });
            this.startHunterTimeout(guild, game, votedPlayer.id);
          }
        }
      }

      // Lancer le timeout AFK pour les loups
      this.startNightAfkTimeout(guild, game);

      await this.announceVictoryIfAny(guild, game);
    } finally {
      game._transitioning = false;
    }
  }

  async announceVictoryIfAny(guild, game) {
    if (game.phase === PHASES.ENDED) return;
    const victor = this.checkWinner(game);
    if (victor === null) return;

    // Traduire le résultat pour l'affichage
    const victorDisplay = { wolves: 'Loups-Garous 🐺', village: 'Village 🏡', lovers: 'Amoureux 💘', draw: 'Égalité 🤝' }[victor] || victor;

    game.phase = PHASES.ENDED;
    game.endedAt = Date.now();
    this.clearGameTimers(game);
    this.logAction(game, `Victoire: ${victorDisplay}`);

    const mainChannel = game.villageChannelId
      ? await guild.channels.fetch(game.villageChannelId)
      : await guild.channels.fetch(game.mainChannelId);

    if (game.voiceChannelId) {
      if (victor === 'wolves') {
        this.playAmbience(game.voiceChannelId, 'victory_wolves.mp3');
      } else {
        this.playAmbience(game.voiceChannelId, 'victory_villagers.mp3');
      }
    }

    await this.sendLogged(mainChannel, `\n🏆 **${victorDisplay}** a gagné la partie !`, { type: 'victory' });

    // Enregistrer dans le monitoring
    try {
      const MetricsCollector = require('../monitoring/metrics');
      const metrics = MetricsCollector.getInstance();
      metrics.recordGameCompleted();
    } catch {}

    await this.sendGameSummary(guild, game, victorDisplay, mainChannel);
  }

  formatDurationMs(ms) {
    if (!ms || ms < 0) return 'N/A';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}m ${sec}s`;
  }

  async sendGameSummary(guild, game, victor, mainChannel) {
    try {
      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

      const duration = game.startedAt && game.endedAt
        ? this.formatDurationMs(game.endedAt - game.startedAt)
        : 'N/A';

      const players = game.players
        .map(p => `${p.alive ? '✅' : '💀'} ${p.username} — ${p.role || 'Sans role'}`)
        .join('\n');

      const actions = (game.actionLog || [])
        .slice(-20)
        .map(a => `• ${a.text}`)
        .join('\n') || 'Aucune action enregistree';

      const embed = new EmbedBuilder()
        .setTitle('Recapitulatif de la partie')
        .setColor(0xFFD166)
        .addFields(
          { name: '🏆 Vainqueur', value: victor, inline: true },
          { name: '⏱️ Duree', value: duration, inline: true },
          { name: '👥 Joueurs', value: players.slice(0, 1024) || 'Aucun', inline: false },
          { name: '📜 Actions', value: actions.slice(0, 1024), inline: false }
        )
        .setTimestamp(new Date());

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`game_restart:${game.mainChannelId}`)
          .setLabel('Relancer')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`game_cleanup:${game.mainChannelId}`)
          .setLabel('Nettoyer')
          .setStyle(ButtonStyle.Danger)
      );

      await this.sendLogged(mainChannel, { embeds: [embed], components: [row] }, { type: 'summary' });
    } catch (err) {
      logger.error('Failed to send game summary', err);
    }
  }

  // Enchaînement logique des sous-phases
  async advanceSubPhase(guild, game) {
    // Séquence : LOUPS -> SORCIERE -> VOYANTE -> REVEIL -> (si premier jour: VOTE_CAPITAINE) -> DELIBERATION -> (bouton capitaine) -> VOTE -> (retour nuit)
    // Vérifier la victoire à chaque sous-phase
    const victory = this.checkVictory(game.mainChannelId);
    if (victory) {
      // Annonce victoire + son
      const villageChannel = game.villageChannelId ? await guild.channels.fetch(game.villageChannelId) : null;
      let msg = '';
      let sound = '';
      if (victory === "Village") {
        msg = '🎉 **VICTOIRE DES VILLAGEOIS !**\nTous les loups-garous ont été éliminés.';
        sound = 'victory_villagers.mp3';
      } else if (victory === "Loups") {
        msg = '🐺 **VICTOIRE DES LOUPS-GAROUS !**\nLes loups sont en supériorité numérique.';
        sound = 'victory_wolves.mp3';
      }
      if (villageChannel) await this.sendLogged(villageChannel, msg, { type: 'victory' });
      if (game.voiceChannelId) {
        try { await this.playAmbience(game.voiceChannelId, sound); } catch (e) { /* ignore */ }
      }
      // Optionnel : cleanup automatique ou laisser la partie en pause ?
      return; // Stopper l'enchaînement des phases
    }
    switch (game.subPhase) {
      case PHASES.LOUPS:
        game.subPhase = PHASES.SORCIERE;
        await this.announcePhase(guild, game, "La sorcière se réveille...");
        break;
      case PHASES.SORCIERE:
        game.subPhase = PHASES.VOYANTE;
        await this.announcePhase(guild, game, "La voyante se réveille...");
        break;
      case PHASES.VOYANTE:
        game.subPhase = PHASES.REVEIL;
        await this.announcePhase(guild, game, "Le village se réveille...");
        break;
      case PHASES.REVEIL:
        // Si premier jour et pas de capitaine, ou si le capitaine est mort, on refait un vote capitaine
        const isFirstDay = (game.dayCount || 0) === 1;
        const captain = game.captainId ? game.players.find(p => p.id === game.captainId) : null;
        const captainDead = !captain || !captain.alive;
        if ((isFirstDay && !game.captainId) || captainDead) {
          game.captainId = null; // reset
          game.subPhase = PHASES.VOTE_CAPITAINE;
          await this.announcePhase(guild, game, "Vote du capitaine ! Utilisez /captainvote puis /declarecaptain");
        } else {
          game.subPhase = PHASES.DELIBERATION;
          await this.announcePhase(guild, game, "Délibération du village...");
        }
        break;
      case PHASES.VOTE_CAPITAINE:
        game.subPhase = PHASES.DELIBERATION;
        await this.announcePhase(guild, game, "Délibération du village...");
        break;
      case PHASES.DELIBERATION:
        // Ici, on attendra un bouton du capitaine pour passer à la phase de vote
        await this.announcePhase(guild, game, "Le capitaine peut lancer le vote avec le bouton 'Vote' !");
        break;
      case PHASES.VOTE:
      default:
        game.subPhase = PHASES.LOUPS;
        await this.announcePhase(guild, game, "La nuit tombe, les loups se réveillent...");
        break;
    }
    this.scheduleSave();
  }

  // Annonce la sous-phase dans le channel village
  async announcePhase(guild, game, message) {
    if (!game.villageChannelId) return;
    try {
      const channel = await guild.channels.fetch(game.villageChannelId);
      await this.sendLogged(channel, `**${message}**`, { type: 'announcePhase', phase: game.phase, subPhase: game.subPhase });
    } catch (e) { /* ignore */ }
  }

  // --- Night AFK timeout ---
  // Auto-avance la sous-phase si le rôle ne joue pas dans le délai imparti (90s)
  startNightAfkTimeout(guild, game) {
    this.clearNightAfkTimeout(game);
    const NIGHT_AFK_DELAY = TIMEOUTS.NIGHT_AFK;
    game._nightAfkTimer = setTimeout(async () => {
      try {
        if (game.phase !== PHASES.NIGHT) return;
        const mainChannel = game.villageChannelId
          ? await guild.channels.fetch(game.villageChannelId)
          : await guild.channels.fetch(game.mainChannelId);

        const currentSub = game.subPhase;
        if (currentSub === PHASES.LOUPS) {
          await this.sendLogged(mainChannel, `⏰ Les loups n'ont pas choisi de victime à temps. La nuit passe sans attaque.`, { type: 'afkTimeout' });
          this.logAction(game, 'AFK timeout: loups');
        } else if (currentSub === PHASES.SORCIERE) {
          await this.sendLogged(mainChannel, `⏰ La sorcière ne se réveille pas... La nuit continue.`, { type: 'afkTimeout' });
          this.logAction(game, 'AFK timeout: sorcière');
        } else if (currentSub === PHASES.VOYANTE) {
          await this.sendLogged(mainChannel, `⏰ La voyante ne se réveille pas... La nuit continue.`, { type: 'afkTimeout' });
          this.logAction(game, 'AFK timeout: voyante');
        } else {
          return; // Pas de timeout pour les autres sous-phases
        }

        await this.advanceSubPhase(guild, game);

        // Si on est encore en nuit avec une sous-phase qui attend une action, relancer le timer
        if (game.phase === PHASES.NIGHT && [PHASES.LOUPS, PHASES.SORCIERE, PHASES.VOYANTE].includes(game.subPhase)) {
          this.startNightAfkTimeout(guild, game);
        } else if (game.subPhase === PHASES.REVEIL) {
          // Transition vers le jour
          await this.transitionToDay(guild, game);
        }
      } catch (e) {
        logger.error('Night AFK timeout error', { error: e.message });
      }
    }, NIGHT_AFK_DELAY);
  }

  clearNightAfkTimeout(game) {
    if (game._nightAfkTimer) {
      clearTimeout(game._nightAfkTimer);
      game._nightAfkTimer = null;
    }
  }

  // --- Hunter timeout ---
  // Le chasseur a 60s pour tirer sinon il perd son tir
  startHunterTimeout(guild, game, hunterId) {
    if (game._hunterTimer) clearTimeout(game._hunterTimer);
    const HUNTER_DELAY = TIMEOUTS.HUNTER_SHOOT;
    game._hunterTimer = setTimeout(async () => {
      try {
        if (game._hunterMustShoot !== hunterId) return;
        game._hunterMustShoot = null;
        const mainChannel = game.villageChannelId
          ? await guild.channels.fetch(game.villageChannelId)
          : await guild.channels.fetch(game.mainChannelId);
        await this.sendLogged(mainChannel, `⏰ Le Chasseur n'a pas tiré à temps. Son tir est perdu.`, { type: 'hunterTimeout' });
        this.logAction(game, 'AFK timeout: chasseur');
        await this.announceVictoryIfAny(guild, game);
      } catch (e) {
        logger.error('Hunter timeout error', { error: e.message });
      }
    }, HUNTER_DELAY);
  }

  join(channelId, user) {
    const game = this.games.get(channelId);
    if (!game || game.phase !== PHASES.NIGHT) return false;

    if (game.players.some(p => p.id === user.id)) return false;

    game.players.push({
      id: user.id,
      username: user.username,
      role: null,
      alive: true
    });

    // Ajouter dans la DB
    this.db.addPlayer(channelId, user.id, user.username);

    if (this.isRealPlayerId(user.id)) {
      this.logAction(game, `${user.username} rejoint la partie`);
    }

    // Reset le timeout à chaque join
    this.setLobbyTimeout(channelId);
    return true;
  }

  start(channelId, rolesOverride = null) {
    const game = this.games.get(channelId);
    if (!game || game.players.length < 5) return null;

    // Empêcher le double-start
    if (game.startedAt) {
      logger.warn('Game already started, ignoring duplicate start', { channelId });
      return null;
    }

    // If rolesOverride provided, use it; otherwise build default pool
    let rolesPool = [];
    if (Array.isArray(rolesOverride) && rolesOverride.length > 0) {
      rolesPool = [...rolesOverride];
    } else {
      // Construire la pool de rôles de base
      rolesPool = [
        ROLES.WEREWOLF,
        ROLES.WEREWOLF,
        ROLES.SEER,
        ROLES.WITCH,
        ROLES.HUNTER
      ];

      // Si au moins 6 joueurs, ajouter la Petite Fille
      if (game.players.length >= 6) {
        rolesPool.push(ROLES.PETITE_FILLE);
      }
      // Si au moins 7 joueurs, ajouter Cupidon
      if (game.players.length >= 7) {
        rolesPool.push(ROLES.CUPID);
      }
    }

    // Compléter avec des villageois si nécessaire
    if (rolesPool.length < game.players.length) {
      rolesPool.push(...Array(game.players.length - rolesPool.length).fill(ROLES.VILLAGER));
    }

    // If rolesPool is longer than players, caller should have resolved selection
    rolesPool = rolesPool.slice(0, game.players.length);

    // Distribuer les rôles aléatoirement
    game.players.forEach(p => {
      const role = rolesPool.splice(Math.floor(Math.random() * rolesPool.length), 1)[0];
      p.role = role;
      // Synchroniser avec la DB
      this.db.updatePlayer(channelId, p.id, { role: role });
    });

    game.startedAt = Date.now();
    
    // Mettre à jour startedAt dans la DB
    this.db.updateGame(channelId, { startedAt: game.startedAt });
    
    this.logAction(game, 'Partie demarree');
    for (const p of game.players) {
      this.logAction(game, `${p.username} => ${p.role}`);
    }

    return game;
  }

  async createInitialChannels(guild, mainChannelId, game, categoryId = null) {
    const timer = logger.startTimer('createInitialChannels');
    try {
      logger.info("Creating initial game channels...", { mainChannelId, categoryId });
      
      // Créer le channel village (visible de tous) pour les messages système
      logger.debug("Creating village channel...");
      const villageChannel = await guild.channels.create({
        name: "🏘️-village",
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined
      });
      game.villageChannelId = villageChannel.id;
      logger.success("✅ Village channel created", { id: villageChannel.id });

      // Créer le channel des loups (accessible à tous pour l'instant)
      logger.debug("Creating wolves channel...");
      const wolvesChannel = await guild.channels.create({
        name: "🐺-loups",
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: ["ViewChannel"]
          }
        ]
      });
      game.wolvesChannelId = wolvesChannel.id;
      logger.success("✅ Wolves channel created", { id: wolvesChannel.id });

      // Créer le channel de la voyante
      logger.debug("Creating seer channel...");
      const seerChannel = await guild.channels.create({
        name: "🔮-voyante",
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: ["ViewChannel"]
          }
        ]
      });
      game.seerChannelId = seerChannel.id;
      logger.success("✅ Seer channel created", { id: seerChannel.id });

      // Créer le channel de la sorcière
      logger.debug("Creating witch channel...");
      const witchChannel = await guild.channels.create({
        name: "🧪-sorciere",
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: ["ViewChannel"]
          }
        ]
      });
      game.witchChannelId = witchChannel.id;
      logger.success("✅ Witch channel created", { id: witchChannel.id });

      // Créer le channel de Cupidon
      logger.debug("Creating cupid channel...");
      const cupidChannel = await guild.channels.create({
        name: "💘-cupidon",
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: ["ViewChannel"]
          }
        ]
      });
      game.cupidChannelId = cupidChannel.id;
      logger.success("✅ Cupid channel created", { id: cupidChannel.id });

      // Créer le channel vocal
      logger.debug("Creating voice channel...");
      const voiceChannel = await guild.channels.create({
        name: "🎤-partie",
        type: 2, // GUILD_VOICE
        parent: categoryId || undefined
      });
      game.voiceChannelId = voiceChannel.id;
      logger.success("✅ Voice channel created", { id: voiceChannel.id });

      // Synchroniser les IDs de channels avec la DB
      this.db.updateGame(mainChannelId, {
        villageChannelId: game.villageChannelId,
        wolvesChannelId: game.wolvesChannelId,
        seerChannelId: game.seerChannelId,
        witchChannelId: game.witchChannelId,
        cupidChannelId: game.cupidChannelId,
        voiceChannelId: game.voiceChannelId
      });

      timer.end();
      logger.success("✅ All initial channels created successfully", { 
        channelCount: 6,
        mainChannelId 
      });
      return true;
    } catch (error) {
      logger.error("❌ Failed to create initial channels", error);
      return false;
    }
  }

  async updateChannelPermissions(guild, game) {
    const timer = logger.startTimer('updateChannelPermissions');
    try {
      logger.info("Updating channel permissions...");

      // Mettre à jour le channel des loups
      const wolvesChannel = await guild.channels.fetch(game.wolvesChannelId);
      const { PermissionsBitField } = require('discord.js');

      const wolvesPerms = [
        {
          id: guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        }
      ];

      // Ajouter uniquement les joueurs valides (membres du serveur)
      for (const p of game.players.filter(p => p.role === ROLES.WEREWOLF && p.alive)) {
        try {
          await guild.members.fetch(p.id);
          wolvesPerms.push({
            id: p.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          });
        } catch (err) {
          logger.warn(`Ignored non-guild member for wolves permissions`, { playerId: p.id });
        }
      }

      await wolvesChannel.permissionOverwrites.set(wolvesPerms);
      logger.success("✅ Wolves channel permissions updated");

      // Mettre à jour le channel de la voyante
      const seerChannel = await guild.channels.fetch(game.seerChannelId);
      const seerPlayer = game.players.find(p => p.role === ROLES.SEER && p.alive);
      const seerPerms = [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }
      ];
      if (seerPlayer) {
        try {
          await guild.members.fetch(seerPlayer.id);
          seerPerms.push({
            id: seerPlayer.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          });
        } catch (err) {
          logger.warn(`Ignored non-guild member for seer permissions`, { playerId: seerPlayer.id });
        }
      }
      await seerChannel.permissionOverwrites.set(seerPerms);
      logger.success("✅ Seer channel permissions updated");

      // Mettre à jour le channel de la sorcière
      const witchChannel = await guild.channels.fetch(game.witchChannelId);
      const witchPlayer = game.players.find(p => p.role === ROLES.WITCH && p.alive);
      const witchPerms = [ { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] } ];
      if (witchPlayer) {
        try {
          await guild.members.fetch(witchPlayer.id);
          witchPerms.push({
            id: witchPlayer.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          });
        } catch (err) {
          logger.warn(`Ignored non-guild member for witch permissions`, { playerId: witchPlayer.id });
        }
      }
      await witchChannel.permissionOverwrites.set(witchPerms);
      logger.success("✅ Witch channel permissions updated");

      // Mettre à jour le channel de Cupidon
      if (game.cupidChannelId) {
        const cupidChannel = await guild.channels.fetch(game.cupidChannelId);
        const cupidPlayer = game.players.find(p => p.role === ROLES.CUPID && p.alive);
        const cupidPerms = [ { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] } ];
        if (cupidPlayer) {
          try {
            await guild.members.fetch(cupidPlayer.id);
            cupidPerms.push({
              id: cupidPlayer.id,
              allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
            });
          } catch (err) {
            logger.warn(`Ignored non-guild member for cupid permissions`, { playerId: cupidPlayer.id });
          }
        }
        await cupidChannel.permissionOverwrites.set(cupidPerms);
        logger.success("✅ Cupid channel permissions updated");
      }

      timer.end();
      return true;
    } catch (error) {
      logger.error("❌ Failed to update channel permissions", error);
      return false;
    }
  }

  async cleanupChannels(guild, game) {
    const timer = logger.startTimer('cleanupChannels');
    // Annuler le timeout si cleanup manuel
    if (game && game.mainChannelId) {
      this.clearLobbyTimeout(game.mainChannelId);
    }

    const ids = [
      { id: game.wolvesChannelId, name: 'wolves' },
      { id: game.seerChannelId, name: 'seer' },
      { id: game.witchChannelId, name: 'witch' },
      { id: game.villageChannelId, name: 'village' },
      { id: game.cupidChannelId, name: 'cupid' },
      { id: game.voiceChannelId, name: 'voice' }
    ];

    logger.info('Cleaning up game channels...', { channelCount: ids.filter(i => i.id).length });
    let deleted = 0;

    for (const entry of ids) {
      if (!entry.id) continue;
      try {
        const ch = await guild.channels.fetch(entry.id).catch(() => null);
        if (!ch) {
          logger.warn(`Channel not found, skipping`, { name: entry.name, id: entry.id });
          continue;
        }

        // Try to unban/mute safety: if voice, attempt to unmute members before deletion
        try {
          if (ch.type === 2) {
            logger.debug('Unmuting voice channel members before deletion', { channelId: ch.id });
            for (const member of ch.members.values()) {
              try { await member.voice.setMute(false); } catch (e) { /* ignore individual failures */ }
            }
          }
        } catch (e) {
          // ignore
        }

        await ch.delete({ reason: 'Cleanup partie Loup-Garou' });
        deleted++;
        logger.success(`🗑️ Channel deleted`, { name: entry.name, id: entry.id });
      } catch (err) {
        logger.error(`Failed to delete channel`, { name: entry.name, id: entry.id, error: err.message });
      }
    }

    this.saveState();
    timer.end();
    logger.success('Channel cleanup completed', { deleted });

    return deleted;
  }

  /**
   * Clean up orphan game channels (channels that exist without an active game)
   * @param {Guild} guild - The Discord guild
   * @param {string} categoryId - The category ID to search in
   * @returns {number} Number of orphan channels deleted
   */
  async cleanupOrphanChannels(guild, categoryId) {
    const timer = logger.startTimer('cleanupOrphanChannels');
    logger.info('Searching for orphan game channels...', { categoryId });

    // Match both with and without emojis (Discord sometimes normalizes, sometimes doesn't)
    const gameChannelNames = [
      'village', '🏘️-village', '🏘-village',
      'loups', 'wolves', '🐺-loups', '🐺-wolves', 
      'voyante', 'seer', '🔮-voyante', '🔮-seer',
      'sorciere', 'witch', '🧪-sorciere', '🧪-witch',
      'cupidon', 'cupid', '❤️-cupidon', '❤️-cupid', '❤-cupidon', '❤-cupid',
      'partie', 'voice', '🎤-partie', '🎤-voice'
    ];
    let deleted = 0;

    try {
      // IMPORTANT: Force fetch ALL channels from API bypassing cache completely
      logger.debug('Fetching all channels from Discord API (forced)...');
      const allChannels = await guild.channels.fetch({ force: true, cache: false });
      logger.debug('Channels fetched', { total: allChannels.size });
      
      // Log all channels for debugging
      const allChannelsList = Array.from(allChannels.values()).map(ch => ({
        id: ch.id,
        name: ch.name,
        parentId: ch.parentId,
        type: ch.type
      }));
      logger.debug('All guild channels:', { channels: allChannelsList.slice(0, 30) }); // Limit to first 30
      
      // Filter channels in the specified category
      const channels = allChannels.filter(ch => ch.parentId === categoryId);
      logger.info('Channels in game category', { 
        count: channels.size, 
        categoryId,
        channelNames: Array.from(channels.values()).map(ch => ch.name)
      });
      
      // Log active games
      logger.debug('Active games', { 
        count: this.games.size,
        gameChannelIds: Array.from(this.games.values()).flatMap(g => [
          g.wolvesChannelId, g.seerChannelId, g.witchChannelId,
          g.villageChannelId, g.cupidChannelId, g.voiceChannelId
        ].filter(Boolean))
      });
      
      for (const channel of channels.values()) {
        // Check if it's a game channel by exact name match
        const isGameChannel = gameChannelNames.includes(channel.name);
        
        if (isGameChannel) {
          logger.debug('Found potential game channel', { name: channel.name, id: channel.id });
          
          // Check if there's an active game that owns this channel
          let isOrphan = true;
          
          for (const game of this.games.values()) {
            const gameChannelIds = [
              game.wolvesChannelId,
              game.seerChannelId,
              game.witchChannelId,
              game.villageChannelId,
              game.cupidChannelId,
              game.voiceChannelId
            ];
            
            if (gameChannelIds.includes(channel.id)) {
              isOrphan = false;
              logger.debug('Channel belongs to active game', { channelId: channel.id, mainChannelId: game.mainChannelId });
              break;
            }
          }
          
          if (isOrphan) {
            logger.info('Deleting orphan channel...', { name: channel.name, id: channel.id });
            try {
              await channel.delete({ reason: 'Cleanup orphan Loup-Garou channel' });
              deleted++;
              logger.success('🗑️ Orphan channel deleted', { name: channel.name, id: channel.id });
            } catch (err) {
              logger.error('Failed to delete orphan channel', { name: channel.name, id: channel.id, error: err.message });
            }
          } else {
            logger.debug('Channel is part of active game, keeping', { name: channel.name, id: channel.id });
          }
        } else {
          logger.debug('Skipping non-game channel', { name: channel.name, type: channel.type });
        }
      }
    } catch (err) {
      logger.error('Error during orphan cleanup', err);
    }

    timer.end();
    logger.success('Orphan cleanup completed', { deleted });
    return deleted;
  }

  async cleanupCategoryChannels(guild, categoryId) {
    const timer = logger.startTimer('cleanupCategoryChannels');
    logger.info('Cleaning game channels by name in category...', { categoryId });

    const gameChannelNames = [
      'village', '🏘️-village', '🏘-village',
      'loups', 'wolves', '🐺-loups', '🐺-wolves',
      'voyante', 'seer', '🔮-voyante', '🔮-seer',
      'sorciere', 'witch', '🧪-sorciere', '🧪-witch',
      'cupidon', 'cupid', '❤️-cupidon', '❤️-cupid', '❤-cupidon', '❤-cupid',
      'partie', 'voice', '🎤-partie', '🎤-voice'
    ];

    let deleted = 0;
    try {
      const allChannels = await guild.channels.fetch(undefined, { force: true, cache: false });
      const channels = allChannels.filter(ch => ch.parentId === categoryId && gameChannelNames.includes(ch.name));

      for (const channel of channels.values()) {
        try {
          await channel.delete({ reason: 'Cleanup duplicate Loup-Garou channels' });
          deleted++;
        } catch (err) {
          logger.error('Failed to delete channel during category cleanup', {
            name: channel.name,
            id: channel.id,
            error: err.message
          });
        }
      }
    } catch (err) {
      logger.error('Error during category cleanup', err);
    }

    timer.end();
    logger.success('Category cleanup completed', { deleted });
    return deleted;
  }

  async updateVoicePerms(guild, game) {
    try {
      if (!game.voiceChannelId) return;

      const voiceChannel = await guild.channels.fetch(game.voiceChannelId);
      if (!voiceChannel) return;

      // La nuit : mute uniquement les joueurs inscrits à la partie ET présents dans le channel vocal
      if (game.phase === PHASES.NIGHT) {
        for (const member of voiceChannel.members.values()) {
          try {
            const botId = guild.members.me ? guild.members.me.id : null;
            if (botId && member.id === botId) continue;
          } catch (err) {
            // ignore
          }

          const player = game.players.find(p => p.id === member.id);
          if (player && player.alive) {
            await member.voice.setMute(true);
          }
        }
      }
      // Le jour : unmute uniquement les joueurs inscrits à la partie ET vivants
      else if (game.phase === PHASES.DAY) {
        for (const member of voiceChannel.members.values()) {
          try {
            const botId = guild.members.me ? guild.members.me.id : null;
            if (botId && member.id === botId) continue;
          } catch (err) {
            // ignore
          }

          const player = game.players.find(p => p.id === member.id);
          if (player && player.alive) {
            await member.voice.setMute(false);
          }
        }
      }
    } catch (error) {
      logger.error("❌ Failed to update voice permissions", error);
    }
  }

  async nextPhase(guild, game) {
    // Passer de NIGHT à DAY ou DAY à NIGHT
    game.phase = game.phase === PHASES.NIGHT ? PHASES.DAY : PHASES.NIGHT;

    // Si on passe au jour, incrémenter le compteur de jours
    if (game.phase === PHASES.DAY) {
      game.dayCount = (game.dayCount || 0) + 1;
    }

    // Synchroniser avec la DB
    this.db.updateGame(game.mainChannelId, {
      phase: game.phase,
      subPhase: game.subPhase,
      dayCount: game.dayCount
    });

    // Réinitialiser les votes
    game.votes.clear();
    if (game.voteVoters) {
      game.voteVoters.clear();
    }
    if (game._voteIncrements) {
      game._voteIncrements.clear();
    }
    // Effacer les votes du tour précédent dans la DB
    this.db.clearVotes(game.mainChannelId, 'village', game.dayCount);

    // Reset night victim only when a new night starts
    if (game.phase === PHASES.NIGHT) {
      game.nightVictim = null;
      game.subPhase = PHASES.LOUPS;
    } else {
      game.subPhase = PHASES.REVEIL;
    }

    // Mettre à jour les permissions vocales
    await this.updateVoicePerms(guild, game);

    return game.phase;
  }

  voteCaptain(channelId, voterId, targetId) {
    const game = this.games.get(channelId);
    if (!game) return { ok: false, reason: "no_game" };
    if (game.phase !== PHASES.DAY) return { ok: false, reason: "not_day" };
    if ((game.dayCount || 0) !== 1) return { ok: false, reason: "not_first_day" };
    if (game.captainId) return { ok: false, reason: "captain_already" };

    const voter = game.players.find(p => p.id === voterId);
    const target = game.players.find(p => p.id === targetId);
    if (!voter) return { ok: false, reason: "not_in_game" };
    if (!voter.alive) return { ok: false, reason: "voter_dead" };
    if (!target) return { ok: false, reason: "target_not_found" };
    if (!target.alive) return { ok: false, reason: "target_dead" };

    // Remove previous vote if exists
    const prev = game.captainVoters.get(voterId);
    if (prev) {
      game.captainVotes.set(prev, (game.captainVotes.get(prev) || 1) - 1);
      if (game.captainVotes.get(prev) <= 0) game.captainVotes.delete(prev);
    }

    // Add new vote
    game.captainVoters.set(voterId, targetId);
    game.captainVotes.set(targetId, (game.captainVotes.get(targetId) || 0) + 1);

    return { ok: true };
  }

  declareCaptain(channelId) {
    const game = this.games.get(channelId);
    if (!game) return { ok: false, reason: "no_game" };
    if (game.captainId) return { ok: false, reason: "already_set" };
    if ((game.dayCount || 0) !== 1) return { ok: false, reason: "not_first_day" };

    const entries = Array.from(game.captainVotes.entries());
    if (entries.length === 0) return { ok: false, reason: "no_votes" };

    entries.sort((a, b) => b[1] - a[1]);
    const top = entries[0][1];
    const tied = entries.filter(e => e[1] === top).map(e => e[0]);

    if (tied.length > 1) {
      // Tie — no captain
      return { ok: false, reason: "tie", tied };
    }

    const winnerId = entries[0][0];
    const winner = game.players.find(p => p.id === winnerId);
    if (!winner) return { ok: false, reason: "winner_not_found" };

    game.captainId = winnerId;
    // Synchroniser avec la DB
    this.db.updateGame(channelId, { captainId: winnerId });
    
    // clear voting state
    game.captainVotes.clear();
    game.captainVoters.clear();

    return { ok: true, winnerId, username: winner.username };
  }

  getAlive(channelId) {
    const game = this.games.get(channelId);
    if (!game) return [];
    return game.players.filter(p => p.alive);
  }

  kill(channelId, playerId) {
    const game = this.games.get(channelId);
    if (!game) return;
    const player = game.players.find(p => p.id === playerId);
    if (!player || !player.alive) return;
    player.alive = false;
    game.dead.push(player);
    
    // Synchroniser avec la DB
    this.db.updatePlayer(channelId, playerId, { alive: false });
    
    // Si la victime fait partie d'un couple d'amoureux, l'autre meurt aussi
    if (game.lovers && Array.isArray(game.lovers)) {
      for (const pair of game.lovers) {
        if (Array.isArray(pair) && pair.includes(playerId)) {
          const otherId = pair[0] === playerId ? pair[1] : pair[0];
          const other = game.players.find(p => p.id === otherId);
          if (other && other.alive) {
            other.alive = false;
            game.dead.push(other);
            // Synchroniser avec la DB
            this.db.updatePlayer(channelId, otherId, { alive: false });
          }
        }
      }
    }
  }

  // checkVictory est remplacé par checkWinner --- voir plus bas
  // Gardé comme alias pour compatibilité tests
  checkVictory(channelId) {
    const game = this.getGameByChannelId(channelId);
    if (!game) return null;
    return this.checkWinner(game);
  }

  async joinVoiceChannel(guild, voiceChannelId) {
    const voiceManager = require('./voiceManager');
    try {
      logger.debug('Joining voice channel...', { voiceChannelId });
      const voiceChannel = await guild.channels.fetch(voiceChannelId);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) {
        logger.error('❌ Invalid voice channel', { voiceChannelId });
        return false;
      }
      await voiceManager.joinChannel(voiceChannel);
      logger.success('✅ Joined voice channel', { voiceChannelId });
      return true;
    } catch (error) {
      logger.error('❌ Voice connection failed', error);
      return false;
    }
  }

  async playAmbience(voiceChannelId, soundFile) {
    const voiceManager = require('./voiceManager');
    try {
      logger.debug('Playing ambience', { voiceChannelId, soundFile });
      // For day/night ambience we want looping until a phase change
      if (soundFile === 'day_ambience.mp3' || soundFile === 'night_ambience.mp3') {
        await voiceManager.startLoop(voiceChannelId, soundFile);
      } else {
        // stop any running ambience loop before playing one-shot sounds
        try { voiceManager.stopLoop(voiceChannelId); } catch (e) { /* ignore */ }
        await voiceManager.playSound(voiceChannelId, soundFile);
      }
      logger.success('✅ Ambience started', { soundFile });
    } catch (error) {
      logger.error(`❌ Failed to play ambience`, { soundFile, error: error.message });
    }
  }

  disconnectVoice(voiceChannelId) {
    const voiceManager = require('./voiceManager');
    voiceManager.disconnect(voiceChannelId);
  }

  /**
   * Vérifie s'il y a un gagnant
   * @param {Object} game - L'objet game
   * @returns {string|null} - 'wolves', 'village', 'lovers' ou null
   */
  checkWinner(game) {
    const alivePlayers = game.players.filter(p => p.alive);
    
    if (alivePlayers.length === 0) {
      return 'draw'; // Tout le monde est mort — égalité
    }

    // Compter les loups vivants
    const aliveWolves = alivePlayers.filter(p => p.role === ROLES.WEREWOLF);
    const aliveVillagers = alivePlayers.filter(p => p.role !== ROLES.WEREWOLF);

    // Victoire des amoureux : il ne reste que les 2 amoureux
    if (game.lovers && game.lovers.length > 0 && Array.isArray(game.lovers[0])) {
      const pair = game.lovers[0];
      const aliveLovers = alivePlayers.filter(p => pair.includes(p.id));
      if (aliveLovers.length === 2 && alivePlayers.length === 2) {
        return 'lovers';
      }
    }

    // Victoire des loups : tous les non-loups sont morts
    if (aliveVillagers.length === 0 && aliveWolves.length > 0) {
      return 'wolves';
    }

    // Victoire du village : tous les loups sont morts
    if (aliveWolves.length === 0 && aliveVillagers.length > 0) {
      return 'village';
    }

    // Victoire des loups : autant ou plus de loups que de non-loups
    if (aliveWolves.length >= aliveVillagers.length) {
      return 'wolves';
    }

    // Partie continue
    return null;
  }

  // Schedule a save with debouncing (waits 500ms before saving)
  scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveState();
    }, 500);
  }

  // Synchronise une partie du cache vers la base de données
  syncGameToDb(channelId) {
    const game = this.games.get(channelId);
    if (!game) return;

    try {
      // Mettre à jour la partie
      this.db.updateGame(channelId, {
        lobbyMessageId: game.lobbyMessageId,
        lobbyHostId: game.lobbyHostId,
        voiceChannelId: game.voiceChannelId,
        villageChannelId: game.villageChannelId,
        wolvesChannelId: game.wolvesChannelId,
        seerChannelId: game.seerChannelId,
        witchChannelId: game.witchChannelId,
        cupidChannelId: game.cupidChannelId,
        phase: game.phase,
        subPhase: game.subPhase,
        dayCount: game.dayCount,
        captainId: game.captainId,
        startedAt: game.startedAt,
        endedAt: game.endedAt,
        nightVictim: game.nightVictim,
        witchKillTarget: game.witchKillTarget,
        witchSave: game.witchSave ? 1 : 0
      });

      // Mettre à jour les lovers (in-memory: [[id1, id2]], DB: flat pair)
      if (game.lovers && game.lovers.length > 0 && Array.isArray(game.lovers[0])) {
        const pair = game.lovers[0];
        this.db.setLovers(channelId, pair[0], pair[1]);
      }

      // Synchroniser les joueurs
      const dbPlayers = this.db.getPlayers(channelId);
      const dbPlayerIds = new Set(dbPlayers.map(p => p.id));
      
      // Ajouter les nouveaux joueurs
      for (const player of game.players) {
        if (!dbPlayerIds.has(player.id)) {
          this.db.addPlayer(channelId, player.id, player.username);
        }
        // Mettre à jour le statut
        this.db.updatePlayer(channelId, player.id, {
          role: player.role,
          alive: player.alive,
          inLove: player.inLove || false
        });
      }

      logger.debug('Game synced to DB', { channelId });
    } catch (error) {
      logger.error('Failed to sync game to DB', error);
    }
  }

  // Immediate save (synchronous) - Legacy pour compatibilité
  saveState() {
    if (this.saveInProgress) return;
    this.saveInProgress = true;
    
    try {
      // Synchroniser toutes les parties vers la DB
      for (const channelId of this.games.keys()) {
        this.syncGameToDb(channelId);
      }
      logger.debug('All games synced to DB', { gameCount: this.games.size });
    } catch (error) {
      logger.error('❌ Failed to sync games to DB', error);
    } finally {
      this.saveInProgress = false;
    }
  }

  loadState() {
    try {
      logger.info('Loading game state from database...');
      
      const allGames = this.db.getAllGames();
      
      for (const dbGame of allGames) {
        const channelId = dbGame.channel_id;
        
        // Charger les joueurs
        const players = this.db.getPlayers(channelId);
        const dead = players.filter(p => !p.alive);
        
        // Charger les lovers (DB retourne [id1, id2], en mémoire on veut [[id1, id2]])
        const loversFlat = this.db.getLovers(channelId);
        const lovers = loversFlat.length === 2 ? [loversFlat] : [];
        
        // Charger les potions
        const witchPotions = this.db.getWitchPotions(channelId);
        
        // Charger les logs (limités aux 100 derniers)
        const actionLog = this.db.getLogs(channelId, 100);
        
        // Créer l'objet game en mémoire
        const game = {
          mainChannelId: channelId,
          lobbyMessageId: dbGame.lobby_message_id,
          lobbyHostId: dbGame.lobby_host_id,
          voiceChannelId: dbGame.voice_channel_id,
          villageChannelId: dbGame.village_channel_id,
          wolvesChannelId: dbGame.wolves_channel_id,
          seerChannelId: dbGame.seer_channel_id,
          witchChannelId: dbGame.witch_channel_id,
          cupidChannelId: dbGame.cupid_channel_id,
          phase: dbGame.phase,
          subPhase: dbGame.sub_phase,
          dayCount: dbGame.day_count,
          captainId: dbGame.captain_id,
          captainVotes: new Map(), // Pas persisté dans la DB car temporaire
          captainVoters: new Map(), // Pas persisté dans la DB car temporaire
          lovers: lovers,
          players: players,
          dead: dead,
          votes: new Map(), // Charger depuis votes table si besoin
          voteVoters: new Map(),
          witchPotions: witchPotions,
          nightVictim: dbGame.night_victim_id || null,
          witchKillTarget: dbGame.witch_kill_target_id || null,
          witchSave: dbGame.witch_save === 1,
          rules: { 
            minPlayers: dbGame.min_players, 
            maxPlayers: dbGame.max_players 
          },
          actionLog: actionLog,
          startedAt: dbGame.started_at,
          endedAt: dbGame.ended_at,
          disableVoiceMute: dbGame.disable_voice_mute === 1
        };
        
        this.games.set(channelId, game);
      }
      
      logger.success('Game state loaded from DB', { gameCount: this.games.size });
    } catch (err) {
      logger.error('❌ Failed to load game state from DB', err);
    }
  }
}

const instance = new GameManager();
module.exports = instance;
module.exports.GameManager = GameManager;
