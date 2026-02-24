const ROLES = require("./roles");
const PHASES = require("./phases");
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { game: logger } = require('../utils/logger');
const GameDatabase = require('../database/db');
const gameMutex = require('./GameMutex');
const { t, translateRole, translateRoleDesc, tips } = require('../utils/i18n');
const { AchievementEngine, ACHIEVEMENTS } = require('./achievements');
const { getColor } = require('../utils/theme');

// Timeouts configurables (en ms)
const TIMEOUTS = {
  LOBBY_AUTO_CLEANUP: 60 * 60 * 1000, // 1h
  NIGHT_AFK: 120_000,                  // 120s (augmenté)
  HUNTER_SHOOT: 90_000,                // 90s (augmenté)
  DAY_DELIBERATION: 300_000,           // 5 min de discussion (augmenté)
  DAY_VOTE: 180_000,                   // 3 min pour voter (augmenté)
  CAPTAIN_VOTE: 120_000,               // 2 min pour le vote capitaine
  RECENT_COMMAND_WINDOW: 5_000,        // 5s
  RECENT_COMMAND_CLEANUP: 30_000,      // 30s
  RECENT_COMMAND_INTERVAL: 60_000      // 60s interval de nettoyage
};

class GameManager extends EventEmitter {
  constructor() {
    super();
    this.games = new Map(); // Cache en mémoire pour performance
    this.db = new GameDatabase(); // Base de données SQLite
    this.lobbyTimeouts = new Map(); // channelId -> timeoutId
    this.saveTimeout = null; // Debounce saveState calls
    this.saveInProgress = false;
    this.creationsInProgress = new Set(); // Track ongoing channel creation to prevent duplicates
    this.recentCommands = new Map(); // Cache pour déduplication: "command:channelId:userId" -> timestamp
    this.dirtyGames = new Set(); // Track which games need DB sync
    this.gameMutex = gameMutex; // Async mutex per game
    
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
        const guild = bot ? bot.guilds.cache.get(game.guildId) : null;
        if (guild) {
          this._emitGameEvent(game, 'gameEnded', { victor: null, reason: 'timeout' });
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

  // Nettoyer tous les timers d'une partie (AFK nuit, chasseur, capitaine)
  clearGameTimers(game) {
    this.clearNightAfkTimeout(game);
    this.clearDayTimeout(game);
    this.clearCaptainVoteTimeout(game);
    if (game._hunterTimer) {
      clearTimeout(game._hunterTimer);
      game._hunterTimer = null;
    }
  }

  // --- Captain vote timeout ---
  startCaptainVoteTimeout(guild, game) {
    this.clearCaptainVoteTimeout(game);
    game._captainVoteTimer = setTimeout(async () => {
      try {
        if (game.subPhase !== PHASES.VOTE_CAPITAINE) return;
        if (game.captainId) return; // Déjà élu

        const mainChannel = game.villageChannelId
          ? await guild.channels.fetch(game.villageChannelId)
          : await guild.channels.fetch(game.mainChannelId);

        // Tenter de résoudre les votes existants\n        const res = this.resolveCaptainVote(game.mainChannelId);
        if (res.ok) {
          const msgKey = res.wasTie ? 'game.captain_random_elected' : 'game.captain_auto_elected';
          await this.sendLogged(mainChannel, t(msgKey, { name: res.username }), { type: 'captainAutoElected' });
          this.logAction(game, `Capitaine auto-élu (timeout): ${res.username}${res.wasTie ? ' (égalité)' : ''}`);
          // Envoyer le DM au capitaine
          try {
            const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
            const pathMod = require('path');
            const user = await guild.client.users.fetch(res.winnerId);
            const imageName = 'capitaine.webp';
            const imagePath = pathMod.join(__dirname, '..', 'img', imageName);
            const embed = new EmbedBuilder()
              .setTitle(t('cmd.captain.dm_title'))
              .setDescription(t('cmd.captain.dm_desc'))
              .setColor(0xFFD166)
              .setImage(`attachment://${imageName}`);
            await user.send({ embeds: [embed], files: [new AttachmentBuilder(imagePath, { name: imageName })] });
          } catch (e) { /* DM failure ignored */ }
        } else if (res.reason === 'no_votes') {
          // Aucun vote : choisir un joueur vivant au hasard
          const alivePlayers = game.players.filter(p => p.alive);
          if (alivePlayers.length > 0) {
            const random = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            game.captainId = random.id;
            this.db.updateGame(game.mainChannelId, { captainId: random.id });
            game.captainVotes.clear();
            game.captainVoters.clear();
            await this.sendLogged(mainChannel, t('game.captain_random_no_votes', { name: random.username }), { type: 'captainRandomNoVotes' });
            this.logAction(game, `Capitaine élu au hasard (aucun vote): ${random.username}`);
          }
        }

        // Avancer vers la délibération
        await this.advanceSubPhase(guild, game);
      } catch (e) {
        logger.error('Captain vote timeout error', { error: e.message });
      }
    }, TIMEOUTS.CAPTAIN_VOTE);
  }

  clearCaptainVoteTimeout(game) {
    if (game._captainVoteTimer) {
      clearTimeout(game._captainVoteTimer);
      game._captainVoteTimer = null;
    }
  }

  /**
   * Arrête le relais d'écoute de la Petite Fille et la notifie
   */
  async stopListenRelay(game) {
    if (!game.listenRelayUserId) return;
    try {
      // Tenter de notifier la petite fille que l'écoute est terminée
      const client = require.main?.exports?.client;
      if (client) {
        const user = await client.users.fetch(game.listenRelayUserId);
        await user.send(t('cmd.listen.relay_ended'));
      }
    } catch (e) {
      // ignore DM errors
    }
    game.listenRelayUserId = null;
  }

  // Nettoyage global (pour shutdown propre)
  destroy() {
    // Clear recentCommands interval
    if (this._recentCommandsInterval) {
      clearInterval(this._recentCommandsInterval);
      this._recentCommandsInterval = null;
    }
    // Clear debounced save timeout
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
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
    // Save state (force all) and close DB
    this.saveState(true);
    this.gameMutex.destroy();
    if (this.db) {
      this.db.close();
    }
  }

  /**
   * Mark a game as needing DB sync (dirty flag).
   * @param {string} channelId
   */
  markDirty(channelId) {
    this.dirtyGames.add(channelId);
  }

  /**
   * Set sub-phase with FSM validation + dirty marking.
   * @param {object} game
   * @param {string} newSubPhase
   */
  _setSubPhase(game, newSubPhase) {
    const from = game.subPhase;
    if (!PHASES.isValidTransition(from, newSubPhase)) {
      logger.warn('Invalid FSM transition attempted', { from, to: newSubPhase, channelId: game.mainChannelId });
      // Still allow it for backward compatibility, but log loudly
    }
    game.subPhase = newSubPhase;
    this.markDirty(game.mainChannelId);
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
      guildId: options.guildId || null,
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
      guildId: options.guildId || null,
      lobbyMessageId: null,
      lobbyHostId: options.lobbyHostId || null,
      voiceChannelId: null,
      villageChannelId: null,
      wolvesChannelId: null,
      whiteWolfChannelId: null,
      thiefChannelId: null,
      seerChannelId: null,
      witchChannelId: null,
      cupidChannelId: null,
      salvateurChannelId: null,
      spectatorChannelId: null,
      phase: PHASES.NIGHT,
      subPhase: PHASES.LOUPS, // commence par les loups
      dayCount: 0,
      captainId: null,
      captainVotes: new Map(),
      captainVoters: new Map(),
      lovers: [],
      players: [],
      dead: [],
      votes: new Map(),
      voteVoters: new Map(),
      witchPotions: { life: true, death: true },
      nightVictim: null,
      whiteWolfKillTarget: null,
      thiefExtraRoles: [],
      witchKillTarget: null,
      witchSave: false,
      protectedPlayerId: null,
      lastProtectedPlayerId: null,
      villageRolesPowerless: false,
      listenRelayUserId: null,
      listenHintsGiven: [],
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
    
    this._emitGameEvent(this.games.get(channelId), 'gameCreated', { hostId: options.lobbyHostId });
    return true;
  }

  getGameByChannelId(channelId) {
    if (this.games.has(channelId)) return this.games.get(channelId);

    for (const game of this.games.values()) {
      const ids = [
        game.mainChannelId,
        game.villageChannelId,
        game.wolvesChannelId,
        game.whiteWolfChannelId,
        game.thiefChannelId,
        game.seerChannelId,
        game.witchChannelId,
        game.cupidChannelId,
        game.salvateurChannelId,
        game.spectatorChannelId,
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
    // Emit for web dashboard
    this._emitGameEvent(game, 'actionLog', { text });
  }

  /**
   * Emit a game event for the web dashboard / WebSocket bridge.
   * All events include the game's mainChannelId and guildId for routing.
   */
  _emitGameEvent(game, eventName, data = {}) {
    if (!game) return;
    try {
      this.emit('gameEvent', {
        event: eventName,
        gameId: game.mainChannelId,
        guildId: game.guildId,
        timestamp: Date.now(),
        ...data
      });
    } catch (e) { /* never let event emission crash the bot */ }
  }

  /**
   * Returns a sanitized snapshot of the game state for the web layer.
   * Strips Discord-specific objects, keeps only serializable data.
   */
  getGameSnapshot(game) {
    if (!game) return null;
    // Resolve guild name from Discord client cache if available
    let guildName = null;
    try {
      if (this.client && game.guildId) {
        const guild = this.client.guilds.cache.get(game.guildId);
        if (guild) guildName = guild.name;
      }
    } catch (_) { /* ignore */ }

    return {
      gameId: game.mainChannelId,
      guildId: game.guildId,
      guildName,
      phase: game.phase,
      subPhase: game.subPhase,
      dayCount: game.dayCount || 0,
      captainId: game.captainId,
      players: (game.players || []).map(p => ({
        id: p.id,
        username: p.username,
        avatar: p.avatar || null,
        role: p.role,
        alive: p.alive,
        inLove: p.inLove || false,
        isCaptain: p.id === game.captainId,
        idiotRevealed: p.idiotRevealed || false
      })),
      dead: (game.dead || []).map(p => ({
        id: p.id,
        username: p.username,
        avatar: p.avatar || null,
        role: p.role
      })),
      lovers: game.lovers || [],
      nightVictim: game.nightVictim,
      witchPotions: game.witchPotions,
      villageRolesPowerless: game.villageRolesPowerless || false,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
      actionLog: (game.actionLog || []).slice(-30),
      votes: game.votes ? Object.fromEntries(game.votes) : {},
      voteVoters: game.voteVoters ? Object.fromEntries(game.voteVoters) : {},
      lobbyHostId: game.lobbyHostId,
      rules: game.rules,
      // Additional state fields
      wolfVotes: game.wolfVotes || null,
      protectedPlayerId: game.protectedPlayerId || null,
      witchKillTarget: game.witchKillTarget || null,
      witchSave: game.witchSave || false,
      whiteWolfKillTarget: game.whiteWolfKillTarget || null,
      thiefExtraRoles: game.thiefExtraRoles || [],
      listenRelayUserId: game.listenRelayUserId || null,
      disableVoiceMute: game.disableVoiceMute || false
    };
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

  /**
   * Announce a player's role when they die (themed embed with role image)
   */
  async announceDeathReveal(channel, player, cause = 'generic') {
    try {
      const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
      const { getRoleImageName } = require('../utils/roleHelpers');
      const pathMod = require('path');

      const roleName = translateRole(player.role) || t('summary.no_role');
      const isWolf = player.role === ROLES.WEREWOLF || player.role === ROLES.WHITE_WOLF;
      
      const causeText = cause === 'wolves' ? t('death.cause_wolves')
        : cause === 'village' ? t('death.cause_village')
        : cause === 'witch' ? t('death.cause_witch')
        : cause === 'hunter' ? t('death.cause_hunter')
        : cause === 'love' ? t('death.cause_love')
        : cause === 'white_wolf' ? t('death.cause_white_wolf')
        : t('death.cause_generic');

      const color = isWolf ? 0xE74C3C : 0x3498DB;

      const embed = new EmbedBuilder()
        .setTitle(`💀 ${player.username}`)
        .setDescription(t('death.reveal_desc', { 
          name: player.username, 
          role: roleName,
          cause: causeText
        }))
        .setColor(color)
        .setFooter({ text: isWolf ? t('death.was_wolf') : t('death.was_innocent') });

      const imageName = getRoleImageName(player.role);
      const files = [];
      if (imageName) {
        const imagePath = pathMod.join(__dirname, '..', 'img', imageName);
        try {
          files.push(new AttachmentBuilder(imagePath, { name: imageName }));
          embed.setThumbnail(`attachment://${imageName}`);
        } catch (e) { /* image not found, skip */ }
      }

      await channel.send({ embeds: [embed], files });
    } catch (err) {
      logger.warn('Failed to send death reveal', { error: err.message });
    }
  }

  /**
   * Send a DM notification to a player that it's their turn to act
   */
  async notifyTurn(guild, game, role) {
    try {
      const client = require.main?.exports?.client;
      if (!client) return;
      
      const { EmbedBuilder } = require('discord.js');
      const players = this.getAliveRealPlayersByRole(game, role);
      
      for (const player of players) {
        try {
          const user = await client.users.fetch(player.id);
          const roleName = translateRole(role);
          
          const embed = new EmbedBuilder()
            .setTitle(t('dm.your_turn_title'))
            .setDescription(t('dm.your_turn_desc', { role: roleName }))
            .setColor(0xF39C12)
            .setFooter({ text: t('dm.your_turn_footer') })
            .setTimestamp();

          await user.send({ embeds: [embed] });
        } catch (e) {
          // DM failed (user has DMs disabled), ignore
        }
      }
    } catch (err) {
      logger.warn('Failed to send turn notifications', { error: err.message });
    }
  }

  /**
   * Initialize the AchievementEngine (called once on bot startup)
   */
  initAchievements() {
    try {
      this.achievements = new AchievementEngine(this.db.db);
      logger.success('Achievement engine initialized');
    } catch (err) {
      logger.error('Failed to initialize achievements', { error: err.message });
    }
  }

  async transitionToDay(guild, game) {
    if (game.phase !== PHASES.NIGHT) return;
    const release = await this.gameMutex.acquire(game.mainChannelId);

    try {
      // Re-check after acquiring lock
      if (game.phase !== PHASES.NIGHT) return;
      const newPhase = await this.nextPhase(guild, game);
      if (newPhase !== PHASES.DAY) return;

      if (game.voiceChannelId) {
        this.playAmbience(game.voiceChannelId, 'day_ambience.mp3');
      }

      const mainChannel = game.villageChannelId
        ? await guild.channels.fetch(game.villageChannelId)
        : await guild.channels.fetch(game.mainChannelId);

      await this.sendLogged(mainChannel, t('game.day_begins'), { type: 'transitionToDay' });

      // Collecter les morts de la nuit pour vérifier le chasseur après
      const nightDeaths = [];
      let savedVictimId = null;

      if (game.nightVictim) {
        savedVictimId = game.witchSave ? game.nightVictim : null;
        if (game.witchSave) {
          await this.sendLogged(mainChannel, t('game.witch_saved'), { type: 'witchSave' });
          this.logAction(game, 'Sorciere sauve la victime des loups');
          logger.info('Witch life potion active — nightVictim saved', { nightVictim: game.nightVictim });
        } else if (game.protectedPlayerId && game.protectedPlayerId === game.nightVictim) {
          // Salvateur a protégé la victime des loups
          const protectedPlayer = game.players.find(p => p.id === game.nightVictim);
          if (protectedPlayer) {
            await this.sendLogged(mainChannel, t('game.salvateur_protected', { name: protectedPlayer.username }), { type: 'salvateurSave' });
            this.logAction(game, `Salvateur protège ${protectedPlayer.username} de l'attaque des loups`);

            // Track achievement: salvateur save
            if (this.achievements) {
              const salvateur = game.players.find(p => p.role === ROLES.SALVATEUR && p.alive);
              if (salvateur) {
                try { this.achievements.trackEvent(salvateur.id, 'salvateur_save'); } catch (e) { /* ignore */ }
              }
            }
          }
        } else {
          const victimPlayer = game.players.find(p => p.id === game.nightVictim);
          if (victimPlayer && victimPlayer.alive) {
            // Vérifier si c'est l'Ancien avec une vie supplémentaire
            if (victimPlayer.role === ROLES.ANCIEN && victimPlayer.ancienExtraLife) {
              victimPlayer.ancienExtraLife = false;
              await this.sendLogged(mainChannel, t('game.ancien_survives', { name: victimPlayer.username }), { type: 'ancienSurvives' });
              this.logAction(game, `Ancien ${victimPlayer.username} survit à l'attaque (vie supplémentaire)`);
            } else {
              if (victimPlayer.role === ROLES.ANCIEN && !victimPlayer.ancienExtraLife) {
                await this.sendLogged(mainChannel, t('game.ancien_final_death', { name: victimPlayer.username }), { type: 'ancienFinalDeath' });
              }
              if (game.voiceChannelId) {
                this.playAmbience(game.voiceChannelId, 'death.mp3');
              }
              await this.sendLogged(mainChannel, t('game.night_victim', { name: victimPlayer.username }), { type: 'nightVictim' });
              const collateral = this.kill(game.mainChannelId, game.nightVictim);
              nightDeaths.push(victimPlayer);
              this.logAction(game, `Mort la nuit: ${victimPlayer.username}`);
              await this.announceDeathReveal(mainChannel, victimPlayer, 'wolves');
              for (const dead of collateral) {
                await this.sendLogged(mainChannel, t('game.lover_death', { name: dead.username }), { type: 'loverDeath' });
                nightDeaths.push(dead);
                this.logAction(game, `Mort d'amour: ${dead.username}`);
                await this.announceDeathReveal(mainChannel, dead, 'love');
              }
            }
          }
        }
        game.nightVictim = null;
      }

      // Mettre à jour la protection du Salvateur pour la nuit suivante
      game.lastProtectedPlayerId = game.protectedPlayerId;
      game.protectedPlayerId = null;

      // Résoudre la potion de mort de la sorcière (à l'aube)
      if (game.witchKillTarget) {
        // Sécurité: ne pas tuer le joueur qui vient d'être sauvé par la potion de vie
        if (savedVictimId && game.witchKillTarget === savedVictimId) {
          logger.warn('witchKillTarget matches saved victim — skipping death potion', { witchKillTarget: game.witchKillTarget, savedVictimId });
          game.witchKillTarget = null;
        } else {
          const witchVictim = game.players.find(p => p.id === game.witchKillTarget);
          if (witchVictim && witchVictim.alive) {
            await this.sendLogged(mainChannel, t('game.witch_kill', { name: witchVictim.username }), { type: 'witchKill' });
            const collateral = this.kill(game.mainChannelId, game.witchKillTarget);
            nightDeaths.push(witchVictim);
            this.logAction(game, `Empoisonné: ${witchVictim.username}`);
            await this.announceDeathReveal(mainChannel, witchVictim, 'witch');
            for (const dead of collateral) {
              await this.sendLogged(mainChannel, t('game.lover_death', { name: dead.username }), { type: 'loverDeath' });
              nightDeaths.push(dead);
              this.logAction(game, `Mort d'amour: ${dead.username}`);
              await this.announceDeathReveal(mainChannel, dead, 'love');
            }
          }
          game.witchKillTarget = null;
        }
      }

      // Résoudre le kill du Loup Blanc (à l'aube)
      if (game.whiteWolfKillTarget) {
        const wwVictim = game.players.find(p => p.id === game.whiteWolfKillTarget);
        if (wwVictim && wwVictim.alive) {
          await this.sendLogged(mainChannel, t('game.white_wolf_kill', { name: wwVictim.username }), { type: 'whiteWolfKill' });
          const collateral = this.kill(game.mainChannelId, game.whiteWolfKillTarget);
          nightDeaths.push(wwVictim);
          this.logAction(game, `Dévoré par le Loup Blanc: ${wwVictim.username}`);
          await this.announceDeathReveal(mainChannel, wwVictim, 'white_wolf');
          for (const dead of collateral) {
            await this.sendLogged(mainChannel, t('game.lover_death', { name: dead.username }), { type: 'loverDeath' });
            nightDeaths.push(dead);
            this.logAction(game, `Mort d'amour: ${dead.username}`);
            await this.announceDeathReveal(mainChannel, dead, 'love');
          }
        }
        game.whiteWolfKillTarget = null;
      }

      game.witchSave = false;
      this.scheduleSave();

      // Appliquer les lockouts de channels pour les joueurs morts
      await this.applyDeadPlayerLockouts(guild);

      // Vérifier si un chasseur est mort cette nuit — il doit tirer (sauf si pouvoirs perdus)
      for (const dead of nightDeaths) {
        if (dead.role === ROLES.HUNTER && !game.villageRolesPowerless) {
          game._hunterMustShoot = dead.id;
          await this.sendLogged(mainChannel, t('game.hunter_death', { name: dead.username }), { type: 'hunterDeath' });
          this.startHunterTimeout(guild, game, dead.id);
          break;
        }
      }

      // Vérifier victoire avant d'avancer les sous-phases du jour
      const victoryResult = this.checkWinner(game);
      if (victoryResult) {
        await this.announceVictoryIfAny(guild, game);
      } else {
        // Avancer vers VOTE_CAPITAINE ou DELIBERATION
        await this.advanceSubPhase(guild, game);
      }
    } finally {
      release();
    }
  }

  async transitionToNight(guild, game) {
    if (game.phase !== PHASES.DAY) return;
    const release = await this.gameMutex.acquire(game.mainChannelId);
    this.clearDayTimeout(game);

    try {
      // Re-check after acquiring lock
      if (game.phase !== PHASES.DAY) return;
      // IMPORTANT: Snapshot votes BEFORE nextPhase clears them
      const voteSnapshot = Array.from(game.votes.entries()).sort((a, b) => b[1] - a[1]);

      const mainChannel = game.villageChannelId
        ? await guild.channels.fetch(game.villageChannelId)
        : await guild.channels.fetch(game.mainChannelId);

      // --- Résolution des votes AVANT de changer de phase ---
      if (voteSnapshot.length > 0) {
        const [votedId, voteCount] = voteSnapshot[0];
        const tied = voteSnapshot.filter(([, c]) => c === voteCount);

        if (tied.length > 1) {
          const tiedNames = tied.map(([id]) => {
            const p = game.players.find(pl => pl.id === id);
            return p ? `**${p.username}**` : id;
          }).join(', ');

          if (game.captainId) {
            // Égalité + capitaine : on reste en JOUR, le capitaine départage
            game._captainTiebreak = tied.map(([id]) => id);
            game.votes.clear();
            if (game.voteVoters) game.voteVoters.clear();
            await this.sendLogged(mainChannel, t('game.vote_tie_captain', { names: tiedNames, count: voteCount, captainId: game.captainId }), { type: 'voteTie' });
            this.logAction(game, `Égalité au vote — capitaine doit départager: ${tiedNames}`);
            return; // On NE passe PAS à la nuit
          } else {
            await this.sendLogged(mainChannel, t('game.vote_tie_no_captain', { names: tiedNames, count: voteCount }), { type: 'voteTie' });
            this.logAction(game, `Égalité au vote, pas d'élimination`);
          }
        } else {
          const votedPlayer = game.players.find(p => p.id === votedId);
          if (votedPlayer && votedPlayer.alive) {
            // Idiot du Village : révélé mais pas tué, perd le droit de vote
            if (votedPlayer.role === ROLES.IDIOT && !votedPlayer.idiotRevealed) {
              votedPlayer.idiotRevealed = true;
              await this.sendLogged(mainChannel, t('game.idiot_revealed', { name: votedPlayer.username }), { type: 'idiotRevealed' });
              this.logAction(game, `Idiot du Village ${votedPlayer.username} révélé mais survit`);
            } else {
              // Ancien tué par le village : perte des pouvoirs spéciaux
              if (votedPlayer.role === ROLES.ANCIEN) {
                game.villageRolesPowerless = true;
                await this.sendLogged(mainChannel, t('game.ancien_power_drain', { name: votedPlayer.username }), { type: 'ancienPowerDrain' });
                this.logAction(game, `Ancien ${votedPlayer.username} tué par le village — pouvoirs perdus`);
              }

              if (game.voiceChannelId) {
                this.playAmbience(game.voiceChannelId, 'death.mp3');
              }
              await this.sendLogged(mainChannel, t('game.vote_result', { name: votedPlayer.username, count: voteCount }), { type: 'dayVoteResult' });
              const collateral = this.kill(game.mainChannelId, votedId);
              this.logAction(game, `Vote du village: ${votedPlayer.username} elimine`);
              await this.announceDeathReveal(mainChannel, votedPlayer, 'village');

              for (const dead of collateral) {
                await this.sendLogged(mainChannel, t('game.lover_death', { name: dead.username }), { type: 'loverDeath' });
                this.logAction(game, `Mort d'amour: ${dead.username}`);
                await this.announceDeathReveal(mainChannel, dead, 'love');
              }

              // Vérifier chasseur (sauf si pouvoirs perdus)
              if (votedPlayer.role === ROLES.HUNTER && !game.villageRolesPowerless) {
                game._hunterMustShoot = votedPlayer.id;
                await this.sendLogged(mainChannel, t('game.hunter_death', { name: votedPlayer.username }), { type: 'hunterDeath' });
                this.startHunterTimeout(guild, game, votedPlayer.id);
              }
            }
          }
        }
      }

      // Appliquer les lockouts de channels pour les joueurs morts
      await this.applyDeadPlayerLockouts(guild);

      // Vérifier victoire après les éliminations du jour
      const victoryCheck = this.checkWinner(game);
      if (victoryCheck) {
        await this.announceVictoryIfAny(guild, game);
        return;
      }

      // Maintenant on passe à la nuit
      game._captainTiebreak = null;
      const newPhase = await this.nextPhase(guild, game);
      if (newPhase !== PHASES.NIGHT) return;

      if (game.voiceChannelId) {
        this.playAmbience(game.voiceChannelId, 'night_ambience.mp3');
      }

      await this.sendLogged(mainChannel, t('game.night_falls'), { type: 'transitionToNight' });

      // Lancer le timeout AFK pour les loups
      this.startNightAfkTimeout(guild, game);

    } finally {
      release();
    }
  }

  async announceVictoryIfAny(guild, game) {
    if (game.phase === PHASES.ENDED) return;
    const victor = this.checkWinner(game);
    if (victor === null) return;

    // Traduire le résultat pour l'affichage
    const victorDisplay = t(`game.victory_${victor}_display`) || victor;

    game.phase = PHASES.ENDED;
    game.endedAt = Date.now();
    this.clearGameTimers(game);
    this.logAction(game, `Victoire: ${victorDisplay}`);

    // Archiver la partie dans l'historique
    try { this.db.saveGameHistory(game, victor); } catch (e) { /* ignore */ }

    // Unmute tous les joueurs à la fin de la partie
    await this.updateVoicePerms(guild, game);

    const mainChannel = game.villageChannelId
      ? await guild.channels.fetch(game.villageChannelId)
      : await guild.channels.fetch(game.mainChannelId);

    if (game.voiceChannelId) {
      if (victor === 'wolves' || victor === 'white_wolf') {
        this.playAmbience(game.voiceChannelId, 'victory_wolves.mp3');
      } else {
        this.playAmbience(game.voiceChannelId, 'victory_villagers.mp3');
      }
    }

    await this.sendLogged(mainChannel, t('game.victory', { victor: victorDisplay }), { type: 'victory' });

    // Enregistrer dans le monitoring
    try {
      const MetricsCollector = require('../monitoring/metrics');
      const metrics = MetricsCollector.getInstance();
      metrics.recordGameCompleted();
    } catch {}

    // L4: Mettre à jour les stats des joueurs
    try {
      const winningTeam = victor; // 'wolves', 'village', 'white_wolf', 'lovers', 'draw'
      for (const p of game.players) {
        const isWolfRole = p.role === ROLES.WEREWOLF || p.role === ROLES.WHITE_WOLF;
        const isWinner = winningTeam === 'draw' ? false
          : winningTeam === 'lovers' ? (game.lovers && game.lovers[0] && game.lovers[0].includes(p.id))
          : winningTeam === 'white_wolf' ? (p.role === ROLES.WHITE_WOLF)
          : winningTeam === 'wolves' ? isWolfRole
          : !isWolfRole; // village wins
        this.db.updatePlayerStats(p.id, p.username, {
          games_played: 1,
          games_won: isWinner ? 1 : 0,
          times_killed: p.alive ? 0 : 1,
          times_survived: p.alive ? 1 : 0,
          favorite_role: p.role || null
        }, game.guildId);
      }
    } catch (e) {
      this.logAction(game, `Erreur stats joueurs: ${e.message}`);
    }

    // L5: Achievements & ELO
    let eloChanges = null;
    let newAchievements = null;
    if (this.achievements) {
      try {
        eloChanges = this.achievements.calculateElo(game, victor);
        newAchievements = this.achievements.processGameEnd(game, victor);
      } catch (e) {
        logger.error('Achievement/ELO processing error', { error: e.message });
      }
    }

    await this.sendGameSummary(guild, game, victorDisplay, mainChannel, eloChanges, newAchievements);

    this._emitGameEvent(game, 'gameEnded', {
      victor,
      victorDisplay,
      players: game.players.map(p => ({ id: p.id, username: p.username, role: p.role, alive: p.alive })),
      dayCount: game.dayCount,
      duration: game.endedAt - game.startedAt
    });
  }

  formatDurationMs(ms) {
    if (!ms || ms < 0) return 'N/A';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}m ${sec}s`;
  }

  async sendGameSummary(guild, game, victor, mainChannel, eloChanges = null, newAchievements = null) {
    try {
      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

      const duration = game.startedAt && game.endedAt
        ? this.formatDurationMs(game.endedAt - game.startedAt)
        : 'N/A';

      // Player list with ELO changes
      const players = game.players
        .map(p => {
          let line = `${p.alive ? '✅' : '💀'} ${p.username} — ${p.role ? translateRole(p.role) : t('summary.no_role')}`;
          if (eloChanges && eloChanges.has(p.id)) {
            const elo = eloChanges.get(p.id);
            const arrow = elo.change >= 0 ? '📈' : '📉';
            const tier = AchievementEngine.getEloTier(elo.newElo);
            line += ` ${arrow} ${elo.change >= 0 ? '+' : ''}${elo.change} (${tier.emoji} ${elo.newElo})`;
          }
          return line;
        })
        .join('\n');

      // Detailed timeline
      const timeline = this._buildTimeline(game);

      // Store previous players for rematch
      game._previousPlayers = game.players.map(p => ({ id: p.id, username: p.username }));

      const embed = new EmbedBuilder()
        .setTitle(t('summary.title'))
        .setColor(getColor(game.guildId, 'special'))
        .addFields(
          { name: t('summary.winner'), value: victor, inline: true },
          { name: t('summary.duration'), value: duration, inline: true },
          { name: `📊 ${t('summary.days')}`, value: `${game.dayCount || 0}`, inline: true },
          { name: t('summary.players'), value: players.slice(0, 1024) || t('summary.no_players'), inline: false }
        );

      // Add timeline
      if (timeline) {
        embed.addFields({ name: `📜 ${t('summary.timeline')}`, value: timeline.slice(0, 1024), inline: false });
      }

      // Add achievement announcements
      if (newAchievements && newAchievements.size > 0) {
        const achLines = [];
        for (const [playerId, achievementIds] of newAchievements) {
          const player = game.players.find(p => p.id === playerId);
          if (!player) continue;
          for (const achId of achievementIds) {
            const ach = ACHIEVEMENTS[achId];
            if (ach) {
              achLines.push(`${ach.emoji} **${player.username}** — ${t(`achievement.${achId}`)}`);
            }
          }
        }
        if (achLines.length > 0) {
          embed.addFields({ 
            name: `🏅 ${t('summary.achievements_unlocked')}`, 
            value: achLines.join('\n').slice(0, 1024), 
            inline: false 
          });
        }
      }

      embed.setTimestamp(new Date());

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`game_rematch:${game.mainChannelId}`)
          .setLabel(t('ui.btn.rematch'))
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`game_restart:${game.mainChannelId}`)
          .setLabel(t('ui.btn.restart'))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`game_cleanup:${game.mainChannelId}`)
          .setLabel(t('ui.btn.cleanup'))
          .setStyle(ButtonStyle.Danger)
      );

      await this.sendLogged(mainChannel, { embeds: [embed], components: [row] }, { type: 'summary' });
    } catch (err) {
      logger.error('Failed to send game summary', err);
    }
  }

  /**
   * Build a detailed timeline for post-game summary
   * Groups actions by day/night phases for readability
   */
  _buildTimeline(game) {
    const logs = game.actionLog || [];
    if (logs.length === 0) return null;

    const keyEvents = logs.filter(a => {
      const t = a.text || '';
      return t.includes('Mort') || t.includes('elimine') || t.includes('Empoisonné') || 
             t.includes('sauve') || t.includes('protège') || t.includes('Victoire') ||
             t.includes('Capitaine') || t.includes('chasseur') || t.includes('Chasseur') ||
             t.includes('pouvoirs perdus') || t.includes('révélé') || t.includes('survit') ||
             t.includes('espionne') || t.includes('Partie demarree');
    });

    if (keyEvents.length === 0) return null;

    return keyEvents.slice(-15).map(a => `• ${a.text}`).join('\n');
  }

  // Enchaînement logique des sous-phases
  async advanceSubPhase(guild, game) {
    // Vérifier la victoire à chaque sous-phase
    const victory = this.checkWinner(game);
    if (victory) {
      await this.announceVictoryIfAny(guild, game);
      return; // Stopper l'enchaînement des phases
    }
    switch (game.subPhase) {
      case PHASES.VOLEUR:
        // Après le Voleur, vérifier si Cupidon est en jeu (première nuit uniquement)
        if (this.hasAliveRealRole(game, ROLES.CUPID)) {
          this._setSubPhase(game, PHASES.CUPIDON);
          await this.announcePhase(guild, game, t('phase.cupid_wakes') || 'Cupidon se réveille...');
          this.notifyTurn(guild, game, ROLES.CUPID);
        } else if (this.hasAliveRealRole(game, ROLES.SALVATEUR) && !game.villageRolesPowerless) {
          this._setSubPhase(game, PHASES.SALVATEUR);
          await this.announcePhase(guild, game, t('phase.salvateur_wakes'));
          this.notifyTurn(guild, game, ROLES.SALVATEUR);
        } else {
          this._setSubPhase(game, PHASES.LOUPS);
          await this.announcePhase(guild, game, t('phase.wolves_wake'));
          this.notifyTurn(guild, game, ROLES.WEREWOLF);
        }
        break;
      case PHASES.CUPIDON:
        // Après Cupidon, vérifier si Salvateur est en jeu
        if (this.hasAliveRealRole(game, ROLES.SALVATEUR) && !game.villageRolesPowerless) {
          this._setSubPhase(game, PHASES.SALVATEUR);
          await this.announcePhase(guild, game, t('phase.salvateur_wakes'));
          this.notifyTurn(guild, game, ROLES.SALVATEUR);
        } else {
          this._setSubPhase(game, PHASES.LOUPS);
          await this.announcePhase(guild, game, t('phase.wolves_wake'));
          this.notifyTurn(guild, game, ROLES.WEREWOLF);
        }
        break;
      case PHASES.SALVATEUR:
        this._setSubPhase(game, PHASES.LOUPS);
        await this.announcePhase(guild, game, t('phase.wolves_wake'));
        this.notifyTurn(guild, game, ROLES.WEREWOLF);
        break;
      case PHASES.LOUPS:
        this.stopListenRelay(game);
        // Après les loups, vérifier si le Loup Blanc se réveille (nuits impaires, dayCount >= 1)
        const isOddNight = (game.dayCount || 0) % 2 === 1;
        if (isOddNight && this.hasAliveRealRole(game, ROLES.WHITE_WOLF)) {
          this._setSubPhase(game, PHASES.LOUP_BLANC);
          await this.announcePhase(guild, game, t('phase.white_wolf_wakes'));
          this.notifyTurn(guild, game, ROLES.WHITE_WOLF);
        } else if (this.hasAliveRealRole(game, ROLES.WITCH) && !game.villageRolesPowerless) {
          this._setSubPhase(game, PHASES.SORCIERE);
          await this.announcePhase(guild, game, t('phase.witch_wakes'));
          this.notifyTurn(guild, game, ROLES.WITCH);
        } else if (this.hasAliveRealRole(game, ROLES.SEER) && !game.villageRolesPowerless) {
          this._setSubPhase(game, PHASES.VOYANTE);
          await this.announcePhase(guild, game, t('phase.seer_wakes'));
          this.notifyTurn(guild, game, ROLES.SEER);
        } else {
          this._setSubPhase(game, PHASES.REVEIL);
          await this.announcePhase(guild, game, t('phase.village_wakes'));
        }
        break;
      case PHASES.LOUP_BLANC:
        if (this.hasAliveRealRole(game, ROLES.WITCH) && !game.villageRolesPowerless) {
          this._setSubPhase(game, PHASES.SORCIERE);
          await this.announcePhase(guild, game, t('phase.witch_wakes'));
          this.notifyTurn(guild, game, ROLES.WITCH);
        } else if (this.hasAliveRealRole(game, ROLES.SEER) && !game.villageRolesPowerless) {
          this._setSubPhase(game, PHASES.VOYANTE);
          await this.announcePhase(guild, game, t('phase.seer_wakes'));
          this.notifyTurn(guild, game, ROLES.SEER);
        } else {
          this._setSubPhase(game, PHASES.REVEIL);
          await this.announcePhase(guild, game, t('phase.village_wakes'));
        }
        break;
      case PHASES.SORCIERE:
        if (this.hasAliveRealRole(game, ROLES.SEER) && !game.villageRolesPowerless) {
          this._setSubPhase(game, PHASES.VOYANTE);
          await this.announcePhase(guild, game, t('phase.seer_wakes'));
          this.notifyTurn(guild, game, ROLES.SEER);
        } else {
          this._setSubPhase(game, PHASES.REVEIL);
          await this.announcePhase(guild, game, t('phase.village_wakes'));
        }
        break;
      case PHASES.VOYANTE:
        this._setSubPhase(game, PHASES.REVEIL);
        await this.announcePhase(guild, game, t('phase.village_wakes'));
        break;
      case PHASES.REVEIL:
        // Si premier jour et pas de capitaine, ou si le capitaine est mort, on refait un vote capitaine
        const isFirstDay = (game.dayCount || 0) === 1;
        const captain = game.captainId ? game.players.find(p => p.id === game.captainId) : null;
        const captainDead = !captain || !captain.alive;
        if ((isFirstDay && !game.captainId) || captainDead) {
          game.captainId = null; // reset
          this._setSubPhase(game, PHASES.VOTE_CAPITAINE);
          await this.announcePhase(guild, game, t('phase.captain_vote_announce'));
          this.startCaptainVoteTimeout(guild, game);
        } else {
          this._setSubPhase(game, PHASES.DELIBERATION);
          await this.announcePhase(guild, game, t('phase.deliberation_announce'));
          this.startDayTimeout(guild, game, 'deliberation');
        }
        break;
      case PHASES.VOTE_CAPITAINE:
        this._setSubPhase(game, PHASES.DELIBERATION);
        await this.announcePhase(guild, game, t('phase.deliberation_announce'));
        this.startDayTimeout(guild, game, 'deliberation');
        break;
      case PHASES.DELIBERATION:
        // Passage en phase de vote
        this._setSubPhase(game, PHASES.VOTE);
        await this.announcePhase(guild, game, t('phase.vote_announce'));
        this.startDayTimeout(guild, game, 'vote');
        break;
      case PHASES.VOTE:
      default:
        this._setSubPhase(game, PHASES.LOUPS);
        await this.announcePhase(guild, game, t('phase.night_wolves_wake'));
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
          game.wolfVotes = null; // Reset wolf consensus on timeout
          await this.sendLogged(mainChannel, t('game.afk_wolves'), { type: 'afkTimeout' });
          this.logAction(game, 'AFK timeout: loups');
        } else if (currentSub === PHASES.SORCIERE) {
          await this.sendLogged(mainChannel, t('game.afk_witch'), { type: 'afkTimeout' });
          this.logAction(game, 'AFK timeout: sorcière');
        } else if (currentSub === PHASES.VOYANTE) {
          await this.sendLogged(mainChannel, t('game.afk_seer'), { type: 'afkTimeout' });
          this.logAction(game, 'AFK timeout: voyante');
        } else if (currentSub === PHASES.SALVATEUR) {
          await this.sendLogged(mainChannel, t('game.afk_salvateur'), { type: 'afkTimeout' });
          this.logAction(game, 'AFK timeout: salvateur');
        } else if (currentSub === PHASES.LOUP_BLANC) {
          await this.sendLogged(mainChannel, t('game.afk_white_wolf'), { type: 'afkTimeout' });
          this.logAction(game, 'AFK timeout: loup blanc');
        } else if (currentSub === PHASES.VOLEUR) {
          await this.sendLogged(mainChannel, t('game.afk_thief'), { type: 'afkTimeout' });
          this.logAction(game, 'AFK timeout: voleur');
        } else {
          return; // Pas de timeout pour les autres sous-phases
        }

        await this.advanceSubPhase(guild, game);

        // Si on est encore en nuit avec une sous-phase qui attend une action, relancer le timer
        if (game.phase === PHASES.NIGHT && [PHASES.VOLEUR, PHASES.LOUPS, PHASES.LOUP_BLANC, PHASES.SORCIERE, PHASES.VOYANTE, PHASES.SALVATEUR].includes(game.subPhase)) {
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
        await this.sendLogged(mainChannel, t('game.hunter_timeout'), { type: 'hunterTimeout' });
        this.logAction(game, 'AFK timeout: chasseur');
        await this.announceVictoryIfAny(guild, game);
      } catch (e) {
        logger.error('Hunter timeout error', { error: e.message });
      }
    }, HUNTER_DELAY);
  }

  // --- Day timeout ---
  // Auto-ends deliberation or vote if players are AFK during the day
  startDayTimeout(guild, game, type = 'deliberation') {
    this.clearDayTimeout(game);
    const delay = type === 'vote' ? TIMEOUTS.DAY_VOTE : TIMEOUTS.DAY_DELIBERATION;
    const label = type === 'vote' ? 'vote' : 'deliberation';

    game._dayTimer = setTimeout(async () => {
      try {
        if (game.phase !== PHASES.DAY) return;

        const mainChannel = game.villageChannelId
          ? await guild.channels.fetch(game.villageChannelId)
          : await guild.channels.fetch(game.mainChannelId);

        if (type === 'deliberation') {
          // End of deliberation → move to vote phase
          await this.sendLogged(mainChannel, t('game.afk_deliberation'), { type: 'afkTimeout' });
          this.logAction(game, 'Timeout: fin de la délibération');
          this._setSubPhase(game, PHASES.VOTE);
          await this.announcePhase(guild, game, t('phase.vote_announce'));
          this.startDayTimeout(guild, game, 'vote');
        } else {
          // End of vote → transition to night (even with 0 votes)
          await this.sendLogged(mainChannel, t('game.afk_vote'), { type: 'afkTimeout' });
          this.logAction(game, 'Timeout: fin du vote');
          await this.transitionToNight(guild, game);
        }
      } catch (e) {
        logger.error('Day timeout error', { error: e.message, type: label });
      }
    }, delay);
  }

  clearDayTimeout(game) {
    if (game._dayTimer) {
      clearTimeout(game._dayTimer);
      game._dayTimer = null;
    }
  }

  join(channelId, user) {
    const game = this.games.get(channelId);
    if (!game || game.phase !== PHASES.NIGHT) return false;

    // Block joins after game has started
    if (game.startedAt) return false;

    if (game.players.some(p => p.id === user.id)) return false;

    game.players.push({
      id: user.id,
      username: user.username,
      avatar: (typeof user.displayAvatarURL === 'function') ? user.displayAvatarURL({ size: 64, extension: 'png' }) : null,
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
    this._emitGameEvent(game, 'playerJoined', { playerId: user.id, username: user.username, playerCount: game.players.length });
    return true;
  }

  start(channelId, rolesOverride = null) {
    const game = this.games.get(channelId);
    const minRequired = (game && game.rules && game.rules.minPlayers) || 5;
    if (!game || game.players.length < minRequired) return null;

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
      // 1 loup si 5 joueurs, 2 loups à partir de 6
      if (game.players.length <= 5) {
        rolesPool = [
          ROLES.WEREWOLF,
          ROLES.SEER,
          ROLES.WITCH,
          ROLES.HUNTER
        ];
      } else {
        rolesPool = [
          ROLES.WEREWOLF,
          ROLES.WEREWOLF,
          ROLES.SEER,
          ROLES.WITCH,
          ROLES.HUNTER
        ];
      }

      // Si au moins 6 joueurs, ajouter la Petite Fille
      if (game.players.length >= 6) {
        rolesPool.push(ROLES.PETITE_FILLE);
      }
      // Si au moins 7 joueurs, ajouter Cupidon
      if (game.players.length >= 7) {
        rolesPool.push(ROLES.CUPID);
      }
      // Si au moins 8 joueurs, ajouter le Voleur
      if (game.players.length >= 8) {
        rolesPool.push(ROLES.THIEF);
      }
      // Si au moins 9 joueurs, ajouter le Salvateur
      if (game.players.length >= 9) {
        rolesPool.push(ROLES.SALVATEUR);
      }
      // Si au moins 10 joueurs, ajouter l'Ancien
      if (game.players.length >= 10) {
        rolesPool.push(ROLES.ANCIEN);
      }
      // Si au moins 11 joueurs, ajouter le Loup Blanc
      if (game.players.length >= 11) {
        rolesPool.push(ROLES.WHITE_WOLF);
      }
      // Si au moins 12 joueurs, ajouter l'Idiot du Village
      if (game.players.length >= 12) {
        rolesPool.push(ROLES.IDIOT);
      }
    }

    // Filtrer les rôles selon la configuration de la guilde (rôles activés)
    const ConfigManager = require('../utils/config');
    const configInstance = ConfigManager.getInstance();
    const enabledRoles = configInstance.getEnabledRoles(game.guildId || null);
    // Toujours garder Loup-Garou et Villageois (mandatory)
    rolesPool = rolesPool.filter(role => {
      if (role === ROLES.WEREWOLF || role === ROLES.VILLAGER) return true;
      return enabledRoles.includes(role);
    });

    // Si le Voleur est dans la pool, ajouter 2 cartes supplémentaires pour le choix
    const hasThiefInPool = rolesPool.includes(ROLES.THIEF);
    const extraRolesCount = hasThiefInPool ? 2 : 0;

    // Compléter avec des villageois si nécessaire (+ extra pour le voleur)
    const totalNeeded = game.players.length + extraRolesCount;
    if (rolesPool.length < totalNeeded) {
      rolesPool.push(...Array(totalNeeded - rolesPool.length).fill(ROLES.VILLAGER));
    }

    // If rolesPool is longer than needed, trim
    rolesPool = rolesPool.slice(0, totalNeeded);

    // Mélanger la pool
    for (let i = rolesPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rolesPool[i], rolesPool[j]] = [rolesPool[j], rolesPool[i]];
    }

    // Si le Voleur est en jeu, extraire 2 cartes pour le choix du Voleur
    // (on s'assure que le Voleur lui-même n'est pas dans les cartes extras)
    game.thiefExtraRoles = [];
    if (hasThiefInPool) {
      // D'abord assigner le rôle THIEF au joueur voleur
      const thiefIndex = rolesPool.indexOf(ROLES.THIEF);
      rolesPool.splice(thiefIndex, 1);
      // Prendre 2 cartes aléatoires parmi les rôles restants (hors THIEF)
      const card1 = rolesPool.splice(Math.floor(Math.random() * rolesPool.length), 1)[0];
      const card2 = rolesPool.splice(Math.floor(Math.random() * rolesPool.length), 1)[0];
      game.thiefExtraRoles = [card1, card2];
      // Remettre THIEF dans la pool pour distribution
      rolesPool.push(ROLES.THIEF);
    }

    // Distribuer les rôles aléatoirement
    game.players.forEach(p => {
      const role = rolesPool.splice(Math.floor(Math.random() * rolesPool.length), 1)[0];
      p.role = role;
      // Synchroniser avec la DB
      this.db.updatePlayer(channelId, p.id, { role: role });
    });

    game.startedAt = Date.now();

    // Clear lobby timeout — game is now active
    this.clearLobbyTimeout(channelId);
    
    // Déterminer la première sous-phase nocturne
    // Ordre: VOLEUR → CUPIDON → SALVATEUR → LOUPS
    const hasThief = game.players.some(p => p.role === ROLES.THIEF && p.alive);
    if (hasThief && game.thiefExtraRoles.length === 2) {
      this._setSubPhase(game, PHASES.VOLEUR);
    } else {
      const hasCupid = game.players.some(p => p.role === ROLES.CUPID && p.alive);
      if (hasCupid) {
        this._setSubPhase(game, PHASES.CUPIDON);
      } else {
        const hasSalvateur = game.players.some(p => p.role === ROLES.SALVATEUR && p.alive);
        if (hasSalvateur) {
          this._setSubPhase(game, PHASES.SALVATEUR);
        }
      }
    }

    // Initialiser les vies de l'Ancien (1 vie supplémentaire)
    const ancienPlayer = game.players.find(p => p.role === ROLES.ANCIEN);
    if (ancienPlayer) {
      ancienPlayer.ancienExtraLife = true;
    }

    // Mettre à jour startedAt dans la DB
    this.db.updateGame(channelId, { startedAt: game.startedAt });
    
    this.logAction(game, 'Partie demarree');
    for (const p of game.players) {
      this.logAction(game, `${p.username} => ${p.role}`);
    }

    this._emitGameEvent(game, 'gameStarted', {
      players: game.players.map(p => ({ id: p.id, username: p.username, role: p.role })),
      subPhase: game.subPhase
    });

    return game;
  }

  /**
   * Post-start : permissions, voice, DMs rôles, messages channels privés, message village.
   * Centralise la logique dupliquée entre start.js, debug-start-force.js et lobby_start.
   */
  async postStartGame(guild, game, client, interaction = null) {
    const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
    const pathMod = require('path');
    const { getRoleDescription, getRoleImageName } = require('../utils/roleHelpers');

    const updateProgress = async (msg) => {
      if (!interaction) return;
      try { await interaction.editReply({ content: msg }); } catch {}
    };

    // 1. Permissions channels
    await updateProgress(t('progress.permissions'));
    const setupSuccess = await this.updateChannelPermissions(guild, game);
    if (!setupSuccess) return false;

    // 2. Permissions vocales
    await updateProgress(t('progress.voice'));
    await this.updateVoicePerms(guild, game);

    // 3. Envoyer les rôles en DM
    await updateProgress(t('progress.dm'));
    for (const player of game.players) {
      if (typeof player.id !== 'string' || !/^\d+$/.test(player.id)) continue;
      try {
        const user = await client.users.fetch(player.id);
        const embed = new EmbedBuilder()
          .setTitle(t('role.dm_title', { role: translateRole(player.role) }))
          .setDescription(translateRoleDesc(player.role))
          .setColor(getColor(game.guildId, 'primary'));

        const imageName = getRoleImageName(player.role);
        const files = [];
        if (imageName) {
          const imagePath = pathMod.join(__dirname, '..', 'img', imageName);
          files.push(new AttachmentBuilder(imagePath, { name: imageName }));
          embed.setImage(`attachment://${imageName}`);
        }

        logger.info('DM send', { userId: user.id, username: user.username, content: '[role embed]' });
        await user.send({ embeds: [embed], files });
      } catch (err) {
        logger.warn(`Erreur envoi DM rôle à ${player.id}:`, { error: err.message });
      }
    }

    // 4. Messages dans les channels privés
    await updateProgress(t('progress.channels'));
    if (game.wolvesChannelId) {
      try {
        const wolvesChannel = await guild.channels.fetch(game.wolvesChannelId);
        const wolves = game.players.filter(p => p.role === ROLES.WEREWOLF || p.role === ROLES.WHITE_WOLF);
        // Ping les loups pour les identifier dans le channel
        const wolfPings = wolves.map(w => `<@${w.id}>`).join(' ');
        const wolfNames = wolves.map(w => `🐺 **${w.username}**`).join('\n');
        await this.sendLogged(wolvesChannel, t('welcome.wolves', { n: wolves.length }) + `\n\n${t('welcome.wolves_members')}\n${wolfNames}\n\n${wolfPings}`, { type: 'wolvesWelcome' });
      } catch (e) { logger.warn('Failed to send wolves welcome', { error: e.message }); }
    }

    if (game.whiteWolfChannelId) {
      try {
        const whiteWolfChannel = await guild.channels.fetch(game.whiteWolfChannelId);
        await this.sendLogged(whiteWolfChannel, t('welcome.white_wolf'), { type: 'whiteWolfWelcome' });
      } catch (e) { logger.warn('Failed to send white wolf welcome', { error: e.message }); }
    }

    if (game.thiefChannelId) {
      try {
        const thiefChannel = await guild.channels.fetch(game.thiefChannelId);
        await this.sendLogged(thiefChannel, t('welcome.thief'), { type: 'thiefWelcome' });
        // Si le voleur a des cartes à choisir, afficher les cartes
        if (game.thiefExtraRoles && game.thiefExtraRoles.length === 2) {
          const { translateRole } = require('../utils/i18n');
          const role1Name = translateRole(game.thiefExtraRoles[0]);
          const role2Name = translateRole(game.thiefExtraRoles[1]);
          const bothWolves = (game.thiefExtraRoles[0] === ROLES.WEREWOLF || game.thiefExtraRoles[0] === ROLES.WHITE_WOLF) &&
                             (game.thiefExtraRoles[1] === ROLES.WEREWOLF || game.thiefExtraRoles[1] === ROLES.WHITE_WOLF);
          const cardsMsg = bothWolves
            ? t('cmd.steal.cards_must_take', { role1: role1Name, role2: role2Name })
            : t('cmd.steal.cards', { role1: role1Name, role2: role2Name });
          await this.sendLogged(thiefChannel, cardsMsg, { type: 'thiefCards' });
        }
      } catch (e) { logger.warn('Failed to send thief welcome', { error: e.message }); }
    }

    if (game.seerChannelId) {
      try {
        const seerChannel = await guild.channels.fetch(game.seerChannelId);
        await this.sendLogged(seerChannel, t('welcome.seer'), { type: 'seerWelcome' });
      } catch (e) { logger.warn('Failed to send seer welcome', { error: e.message }); }
    }

    if (game.witchChannelId) {
      try {
        const witchChannel = await guild.channels.fetch(game.witchChannelId);
        await this.sendLogged(witchChannel, t('welcome.witch'), { type: 'witchWelcome' });
      } catch (e) { logger.warn('Failed to send witch welcome', { error: e.message }); }
    }

    if (game.cupidChannelId) {
      try {
        const cupidChannel = await guild.channels.fetch(game.cupidChannelId);
        await this.sendLogged(cupidChannel, t('welcome.cupid'), { type: 'cupidWelcome' });
      } catch (e) { logger.warn('Failed to send cupid welcome', { error: e.message }); }
    }

    if (game.salvateurChannelId) {
      try {
        const salvateurChannel = await guild.channels.fetch(game.salvateurChannelId);
        await this.sendLogged(salvateurChannel, t('welcome.salvateur'), { type: 'salvateurWelcome' });
      } catch (e) { logger.warn('Failed to send salvateur welcome', { error: e.message }); }
    }

    // 5. Message dans le channel village
    await updateProgress(t('progress.done'));
    try {
      const villageChannel = game.villageChannelId
        ? await guild.channels.fetch(game.villageChannelId)
        : await guild.channels.fetch(game.mainChannelId);

      const nightMsg = game.subPhase === PHASES.VOLEUR
        ? t('game.night_start_thief')
        : game.subPhase === PHASES.CUPIDON
          ? t('game.night_start_cupid')
          : t('game.night_start_default');

      await this.sendLogged(villageChannel, nightMsg, { type: 'nightStart' });
    } catch (e) { logger.warn('Failed to send village night message', { error: e.message }); }

    // 6. Lancer le timeout AFK si on est en sous-phase qui attend une action
    if ([PHASES.VOLEUR, PHASES.LOUPS, PHASES.SALVATEUR].includes(game.subPhase)) {
      this.startNightAfkTimeout(guild, game);
    }

    return true;
  }

  async createInitialChannels(guild, mainChannelId, game, categoryId = null) {
    const timer = logger.startTimer('createInitialChannels');
    try {
      // Validate category exists before using it
      if (categoryId) {
        try {
          const cat = await guild.channels.fetch(categoryId);
          if (!cat || cat.type !== 4) {
            logger.warn('Category invalid, creating channels without parent', { categoryId });
            categoryId = null;
          }
        } catch {
          logger.warn('Category not found, creating channels without parent', { categoryId });
          categoryId = null;
        }
      }

      logger.info("Creating initial game channels...", { mainChannelId, categoryId });
      
      // Créer le channel village (visible de tous) pour les messages système
      logger.debug("Creating village channel...");
      const villageChannel = await guild.channels.create({
        name: t('channel.village'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined
      });
      game.villageChannelId = villageChannel.id;
      logger.success("✅ Village channel created", { id: villageChannel.id });

      // Créer le channel des loups (accessible à tous pour l'instant)
      logger.debug("Creating wolves channel...");
      const wolvesChannel = await guild.channels.create({
        name: t('channel.wolves'),
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
        name: t('channel.seer'),
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
        name: t('channel.witch'),
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
        name: t('channel.cupid'),
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

      // Créer le channel du Salvateur
      logger.debug("Creating salvateur channel...");
      const salvateurChannel = await guild.channels.create({
        name: t('channel.salvateur'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: ["ViewChannel"]
          }
        ]
      });
      game.salvateurChannelId = salvateurChannel.id;
      logger.success("✅ Salvateur channel created", { id: salvateurChannel.id });

      // Créer le channel du Loup Blanc
      logger.debug("Creating white wolf channel...");
      const whiteWolfChannel = await guild.channels.create({
        name: t('channel.white_wolf'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: ["ViewChannel"]
          }
        ]
      });
      game.whiteWolfChannelId = whiteWolfChannel.id;
      logger.success("✅ White Wolf channel created", { id: whiteWolfChannel.id });

      // Créer le channel du Voleur
      logger.debug("Creating thief channel...");
      const thiefChannel = await guild.channels.create({
        name: t('channel.thief'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: ["ViewChannel"]
          }
        ]
      });
      game.thiefChannelId = thiefChannel.id;
      logger.success("✅ Thief channel created", { id: thiefChannel.id });

      // Créer le channel spectateurs (pour les morts)
      logger.debug("Creating spectator channel...");
      const spectatorChannel = await guild.channels.create({
        name: t('channel.spectator'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: ["ViewChannel"]
          }
        ]
      });
      game.spectatorChannelId = spectatorChannel.id;
      logger.success("✅ Spectator channel created", { id: spectatorChannel.id });

      // Créer le channel vocal
      logger.debug("Creating voice channel...");
      const voiceChannel = await guild.channels.create({
        name: t('channel.voice'),
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
        salvateurChannelId: game.salvateurChannelId,
        thiefChannelId: game.thiefChannelId,
        spectatorChannelId: game.spectatorChannelId,
        voiceChannelId: game.voiceChannelId
      });

      timer.end();
      logger.success("✅ All initial channels created successfully", { 
        channelCount: 10,
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
      for (const p of game.players.filter(p => (p.role === ROLES.WEREWOLF || p.role === ROLES.WHITE_WOLF) && p.alive)) {
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

      // Mettre à jour le channel du Loup Blanc
      if (game.whiteWolfChannelId) {
        try {
          const whiteWolfChannel = await guild.channels.fetch(game.whiteWolfChannelId);
          const whiteWolfPlayer = game.players.find(p => p.role === ROLES.WHITE_WOLF && p.alive);
          const whiteWolfPerms = [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }
          ];
          if (whiteWolfPlayer) {
            try {
              await guild.members.fetch(whiteWolfPlayer.id);
              whiteWolfPerms.push({
                id: whiteWolfPlayer.id,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
              });
            } catch (err) {
              logger.warn(`Ignored non-guild member for white wolf permissions`, { playerId: whiteWolfPlayer.id });
            }
          }
          await whiteWolfChannel.permissionOverwrites.set(whiteWolfPerms);
          logger.success("✅ White Wolf channel permissions updated");
        } catch (e) { logger.warn('Failed to update white wolf channel permissions', { error: e.message }); }
      }

      // Mettre à jour le channel du Voleur
      if (game.thiefChannelId) {
        try {
          const thiefChannel = await guild.channels.fetch(game.thiefChannelId);
          const thiefPlayer = game.players.find(p => p.role === ROLES.THIEF && p.alive);
          const thiefPerms = [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }
          ];
          if (thiefPlayer) {
            try {
              await guild.members.fetch(thiefPlayer.id);
              thiefPerms.push({
                id: thiefPlayer.id,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
              });
            } catch (err) {
              logger.warn(`Ignored non-guild member for thief permissions`, { playerId: thiefPlayer.id });
            }
          }
          await thiefChannel.permissionOverwrites.set(thiefPerms);
          logger.success("✅ Thief channel permissions updated");
        } catch (e) { logger.warn('Failed to update thief channel permissions', { error: e.message }); }
      }

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

      // Mettre à jour le channel du Salvateur
      if (game.salvateurChannelId) {
        const salvateurChannel = await guild.channels.fetch(game.salvateurChannelId);
        const salvateurPlayer = game.players.find(p => p.role === ROLES.SALVATEUR && p.alive);
        const salvateurPerms = [ { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] } ];
        if (salvateurPlayer) {
          try {
            await guild.members.fetch(salvateurPlayer.id);
            salvateurPerms.push({
              id: salvateurPlayer.id,
              allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
            });
          } catch (err) {
            logger.warn(`Ignored non-guild member for salvateur permissions`, { playerId: salvateurPlayer.id });
          }
        }
        await salvateurChannel.permissionOverwrites.set(salvateurPerms);
        logger.success("✅ Salvateur channel permissions updated");
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
      { id: game.salvateurChannelId, name: 'salvateur' },
      { id: game.whiteWolfChannelId, name: 'whiteWolf' },
      { id: game.thiefChannelId, name: 'thief' },
      { id: game.spectatorChannelId, name: 'spectator' },
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
      'salvateur', '🛡️-salvateur', '🛡-salvateur',
      'spectateurs', 'spectators', '👻-spectateurs', '👻-spectators',
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
        // Never delete categories (type 4)
        if (channel.type === 4) continue;
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
              game.salvateurChannelId,
              game.spectatorChannelId,
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
      const channels = allChannels.filter(ch => ch.parentId === categoryId && ch.type !== 4 && gameChannelNames.includes(ch.name));

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
      // Le jour ou partie terminée : unmute tout le monde
      else if (game.phase === PHASES.DAY || game.phase === PHASES.ENDED) {
        for (const member of voiceChannel.members.values()) {
          try {
            const botId = guild.members.me ? guild.members.me.id : null;
            if (botId && member.id === botId) continue;
          } catch (err) {
            // ignore
          }

          const player = game.players.find(p => p.id === member.id);
          if (player) {
            await member.voice.setMute(false);
          }
        }
      }
    } catch (error) {
      logger.error("❌ Failed to update voice permissions", error);
    }
  }

  async nextPhase(guild, game) {
    // Guard: never toggle an ENDED game back
    if (game.phase === PHASES.ENDED) {
      logger.warn('nextPhase called on ENDED game, ignoring', { channelId: game.mainChannelId });
      return game.phase;
    }

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
      game.wolfVotes = null; // Reset wolf consensus votes
      // Première nuit avec Cupidon vivant : sous-phase CUPIDON d'abord
      const isFirstNight = (game.dayCount || 0) === 0;
      const cupidAlive = this.hasAliveRealRole(game, ROLES.CUPID);
      const cupidNotUsed = !game.lovers || game.lovers.length === 0;
      if (isFirstNight && cupidAlive && cupidNotUsed) {
        this._setSubPhase(game, PHASES.CUPIDON);
      } else {
        // Si Salvateur en jeu et pas de perte de pouvoirs, sous-phase SALVATEUR
        const salvateurAlive = this.hasAliveRealRole(game, ROLES.SALVATEUR);
        if (salvateurAlive && !game.villageRolesPowerless) {
          this._setSubPhase(game, PHASES.SALVATEUR);
        } else {
          this._setSubPhase(game, PHASES.LOUPS);
        }
      }
    } else {
      this._setSubPhase(game, PHASES.REVEIL);
    }

    // Mettre à jour les permissions vocales
    await this.updateVoicePerms(guild, game);

    this._emitGameEvent(game, 'phaseChanged', {
      phase: game.phase,
      subPhase: game.subPhase,
      dayCount: game.dayCount
    });

    return game.phase;
  }

  voteCaptain(channelId, voterId, targetId) {
    const game = this.games.get(channelId);
    if (!game) return { ok: false, reason: "no_game" };
    if (game.phase !== PHASES.DAY) return { ok: false, reason: "not_day" };
    if (game.subPhase !== PHASES.VOTE_CAPITAINE) return { ok: false, reason: "wrong_phase" };
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

    // Vérifier si tous les joueurs vivants ont voté
    const alivePlayers = game.players.filter(p => p.alive);
    const allVoted = alivePlayers.length > 0 && alivePlayers.every(p => game.captainVoters.has(p.id));

    if (allVoted) {
      // Résoudre automatiquement le vote
      const resolution = this.resolveCaptainVote(channelId);
      return { ok: true, allVoted: true, resolution };
    }

    return { ok: true, allVoted: false, voted: game.captainVoters.size, total: alivePlayers.length };
  }

  /**
   * Résout le vote du capitaine (utilisé par auto-resolve et timeout)
   */
  resolveCaptainVote(channelId) {
    const game = this.games.get(channelId);
    if (!game) return { ok: false, reason: "no_game" };
    if (game.captainId) return { ok: false, reason: "already_set" };
    if (game.subPhase !== PHASES.VOTE_CAPITAINE) return { ok: false, reason: "wrong_phase" };

    const entries = Array.from(game.captainVotes.entries());
    if (entries.length === 0) return { ok: false, reason: "no_votes" };

    entries.sort((a, b) => b[1] - a[1]);
    const top = entries[0][1];
    const tied = entries.filter(e => e[1] === top).map(e => e[0]);

    if (tied.length > 1) {
      // Égalité : choisir au hasard parmi les ex-aequo
      const randomId = tied[Math.floor(Math.random() * tied.length)];
      const winner = game.players.find(p => p.id === randomId);
      if (winner) {
        game.captainId = randomId;
        this.db.updateGame(channelId, { captainId: randomId });
        game.captainVotes.clear();
        game.captainVoters.clear();
        this.clearCaptainVoteTimeout(game);
        return { ok: true, winnerId: randomId, username: winner.username, wasTie: true, tied };
      }
    }

    const winnerId = entries[0][0];
    const winner = game.players.find(p => p.id === winnerId);
    if (!winner) return { ok: false, reason: "winner_not_found" };

    game.captainId = winnerId;
    this.db.updateGame(channelId, { captainId: winnerId });
    game.captainVotes.clear();
    game.captainVoters.clear();
    this.clearCaptainVoteTimeout(game);

    return { ok: true, winnerId, username: winner.username, wasTie: false };
  }

  // Alias pour compatibilité des tests et du timeout
  declareCaptain(channelId) {
    return this.resolveCaptainVote(channelId);
  }

  getAlive(channelId) {
    const game = this.games.get(channelId);
    if (!game) return [];
    return game.players.filter(p => p.alive);
  }

  kill(channelId, playerId) {
    const game = this.games.get(channelId);
    if (!game) return [];
    const player = game.players.find(p => p.id === playerId);
    if (!player || !player.alive) return [];
    player.alive = false;
    game.dead.push(player);
    
    // Synchroniser avec la DB
    this.db.updatePlayer(channelId, playerId, { alive: false });
    
    this._emitGameEvent(game, 'playerKilled', { playerId, username: player.username, role: player.role });
    
    // Révoquer l'accès aux channels privés du rôle
    this._pendingLockouts = this._pendingLockouts || [];
    this._pendingLockouts.push({ channelId, playerId, role: player.role });
    
    // Si la victime fait partie d'un couple d'amoureux, l'autre meurt aussi
    const collateralDeaths = [];
    if (game.lovers && Array.isArray(game.lovers)) {
      for (const pair of game.lovers) {
        if (Array.isArray(pair) && pair.includes(playerId)) {
          const otherId = pair[0] === playerId ? pair[1] : pair[0];
          const other = game.players.find(p => p.id === otherId);
          if (other && other.alive) {
            other.alive = false;
            game.dead.push(other);
            collateralDeaths.push(other);
            // Synchroniser avec la DB
            this.db.updatePlayer(channelId, otherId, { alive: false });
            // Révoquer l'accès pour l'amoureux aussi
            this._pendingLockouts.push({ channelId, playerId: otherId, role: other.role });
          }
        }
      }
    }
    return collateralDeaths;
  }

  /**
   * Révoque l'accès aux channels privés pour les joueurs morts.
   * Doit être appelé avec un guild après kill() pour appliquer les changements Discord.
   */
  async applyDeadPlayerLockouts(guild) {
    if (!this._pendingLockouts || this._pendingLockouts.length === 0) return;
    const lockouts = this._pendingLockouts.splice(0);

    for (const { channelId, playerId } of lockouts) {
      const game = this.games.get(channelId);
      if (!game) continue;

      // Tous les salons privés de la partie
      const allRoleChannels = [
        game.wolvesChannelId,
        game.whiteWolfChannelId,
        game.thiefChannelId,
        game.seerChannelId,
        game.witchChannelId,
        game.cupidChannelId,
        game.salvateurChannelId,
        game.villageChannelId
      ].filter(Boolean);

      for (const roleChannelId of allRoleChannels) {
        try {
          const channel = await guild.channels.fetch(roleChannelId);
          if (!channel) continue;
          // Les morts voient tout mais ne peuvent plus écrire
          await channel.permissionOverwrites.edit(playerId, {
            ViewChannel: true,
            SendMessages: false
          });
        } catch (e) {
          logger.warn('Failed to set dead player read-only', { playerId, roleChannelId, error: e.message });
        }
      }

      // Ajouter le joueur mort au channel spectateurs avec droit d'écriture
      if (game.spectatorChannelId) {
        try {
          const spectatorChannel = await guild.channels.fetch(game.spectatorChannelId);
          if (spectatorChannel) {
            await spectatorChannel.permissionOverwrites.edit(playerId, {
              ViewChannel: true,
              SendMessages: true
            });
            // Envoyer un message de bienvenue si c'est le premier mort
            const deadCount = game.players.filter(p => !p.alive).length;
            if (deadCount === 1) {
              await spectatorChannel.send(t('welcome.spectator'));
            }
            await spectatorChannel.send(`👻 <@${playerId}> ${t('game.spectator_joined')}`);
          }
        } catch (e) {
          logger.warn('Failed to add dead player to spectator channel', { playerId, error: e.message });
        }
      }

      logger.debug('Dead player set to read-only on all channels + spectator access', { playerId });
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
   * @returns {string|null} - 'wolves', 'village', 'white_wolf', 'lovers' ou null
   */
  checkWinner(game) {
    const alivePlayers = game.players.filter(p => p.alive);
    
    if (alivePlayers.length === 0) {
      return 'draw'; // Tout le monde est mort — égalité
    }

    // Helper : est-ce un loup (normal ou blanc) ?
    const isWolfRole = (role) => role === ROLES.WEREWOLF || role === ROLES.WHITE_WOLF;

    // Compter les loups vivants (tous types confondus)
    const aliveWolves = alivePlayers.filter(p => isWolfRole(p.role));
    const aliveVillagers = alivePlayers.filter(p => !isWolfRole(p.role));

    // Victoire du Loup Blanc : il est le dernier survivant
    const aliveWhiteWolf = alivePlayers.filter(p => p.role === ROLES.WHITE_WOLF);
    if (aliveWhiteWolf.length === 1 && alivePlayers.length === 1) {
      return 'white_wolf';
    }

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

    // Condition de victoire des loups (per-guild config)
    const ConfigManager = require('../utils/config');
    const config = ConfigManager.getInstance();
    const wolfWinCondition = config.getWolfWinCondition(game.guildId || null);
    if (wolfWinCondition === 'majority') {
      // Victoire des loups : autant ou plus de loups que de non-loups
      if (aliveWolves.length >= aliveVillagers.length) {
        return 'wolves';
      }
    }
    // En mode 'elimination', les loups doivent tuer TOUS les non-loups (géré par le check ci-dessus: aliveVillagers.length === 0)

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

  // Synchronise une partie du cache vers la base de données (wrapped in transaction)
  syncGameToDb(channelId) {
    const game = this.games.get(channelId);
    if (!game) return;

    const self = this;
    const syncFn = this.db.transaction(function() {
      // Mettre à jour la partie (all state fields including previously missing ones)
      self.db.updateGame(channelId, {
        lobbyMessageId: game.lobbyMessageId,
        lobbyHostId: game.lobbyHostId,
        voiceChannelId: game.voiceChannelId,
        villageChannelId: game.villageChannelId,
        wolvesChannelId: game.wolvesChannelId,
        seerChannelId: game.seerChannelId,
        witchChannelId: game.witchChannelId,
        cupidChannelId: game.cupidChannelId,
        salvateurChannelId: game.salvateurChannelId,
        thiefChannelId: game.thiefChannelId,
        whiteWolfChannelId: game.whiteWolfChannelId,
        spectatorChannelId: game.spectatorChannelId,
        phase: game.phase,
        subPhase: game.subPhase,
        dayCount: game.dayCount,
        captainId: game.captainId,
        startedAt: game.startedAt,
        endedAt: game.endedAt,
        nightVictim: game.nightVictim,
        witchKillTarget: game.witchKillTarget,
        witchSave: game.witchSave ? 1 : 0,
        // Previously missing — now persisted
        whiteWolfKillTarget: game.whiteWolfKillTarget || null,
        protectedPlayerId: game.protectedPlayerId || null,
        lastProtectedPlayerId: game.lastProtectedPlayerId || null,
        villageRolesPowerless: game.villageRolesPowerless ? 1 : 0,
        listenHintsGiven: JSON.stringify(game.listenHintsGiven || []),
        thiefExtraRoles: JSON.stringify(game.thiefExtraRoles || [])
      });

      // Mettre à jour les lovers (in-memory: [[id1, id2]], DB: flat pair)
      if (game.lovers && game.lovers.length > 0 && Array.isArray(game.lovers[0])) {
        const pair = game.lovers[0];
        self.db.setLovers(channelId, pair[0], pair[1]);
      }

      // Synchroniser les joueurs
      const dbPlayers = self.db.getPlayers(channelId);
      const dbPlayerIds = new Set(dbPlayers.map(p => p.id));
      
      // Ajouter les nouveaux joueurs
      for (const player of game.players) {
        if (!dbPlayerIds.has(player.id)) {
          self.db.addPlayer(channelId, player.id, player.username);
        }
        // Mettre à jour le statut
        self.db.updatePlayer(channelId, player.id, {
          role: player.role,
          alive: player.alive,
          inLove: player.inLove || false
        });
      }
    });

    try {
      syncFn();
      logger.debug('Game synced to DB (transaction)', { channelId });
    } catch (error) {
      logger.error('Failed to sync game to DB', error);
    }
  }

  // Immediate save — only syncs dirty games (or all on force)
  saveState(force = false) {
    if (this.saveInProgress) return;
    this.saveInProgress = true;
    
    try {
      const toSync = force ? Array.from(this.games.keys()) : Array.from(this.dirtyGames);
      for (const channelId of toSync) {
        if (this.games.has(channelId)) {
          this.syncGameToDb(channelId);
        }
      }
      this.dirtyGames.clear();
      if (toSync.length > 0) {
        logger.debug('Games synced to DB', { count: toSync.length });
      }
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
          guildId: dbGame.guild_id || null,
          lobbyMessageId: dbGame.lobby_message_id,
          lobbyHostId: dbGame.lobby_host_id,
          voiceChannelId: dbGame.voice_channel_id,
          villageChannelId: dbGame.village_channel_id,
          wolvesChannelId: dbGame.wolves_channel_id,
          seerChannelId: dbGame.seer_channel_id,
          witchChannelId: dbGame.witch_channel_id,
          cupidChannelId: dbGame.cupid_channel_id,
          salvateurChannelId: dbGame.salvateur_channel_id || null,
          whiteWolfChannelId: dbGame.white_wolf_channel_id || null,
          thiefChannelId: dbGame.thief_channel_id || null,
          spectatorChannelId: dbGame.spectator_channel_id || null,
          phase: dbGame.phase,
          subPhase: dbGame.sub_phase,
          dayCount: dbGame.day_count,
          captainId: dbGame.captain_id,
          captainVotes: new Map(),
          captainVoters: new Map(),
          lovers: lovers,
          players: players,
          dead: dead,
          votes: new Map(),
          voteVoters: new Map(),
          witchPotions: witchPotions,
          nightVictim: dbGame.night_victim_id || null,
          witchKillTarget: dbGame.witch_kill_target_id || null,
          witchSave: dbGame.witch_save === 1,
          // v3.2 — now persisted properly instead of heuristic restore
          whiteWolfKillTarget: dbGame.white_wolf_kill_target_id || null,
          protectedPlayerId: dbGame.protected_player_id || null,
          lastProtectedPlayerId: dbGame.last_protected_player_id || null,
          villageRolesPowerless: dbGame.village_roles_powerless === 1,
          listenRelayUserId: null, // Runtime-only (relay dies on restart)
          listenHintsGiven: JSON.parse(dbGame.listen_hints_given || '[]'),
          thiefExtraRoles: JSON.parse(dbGame.thief_extra_roles || '[]'),
          rules: { 
            minPlayers: dbGame.min_players, 
            maxPlayers: dbGame.max_players 
          },
          actionLog: actionLog,
          startedAt: dbGame.started_at,
          endedAt: dbGame.ended_at,
          disableVoiceMute: dbGame.disable_voice_mute === 1
        };

        // Fallback: restore villageRolesPowerless from logs if column was 0 but logs say otherwise
        if (!game.villageRolesPowerless && actionLog.some(a => a.text && a.text.includes('pouvoirs perdus'))) {
          game.villageRolesPowerless = true;
        }

        // Restaurer ancienExtraLife : si l'Ancien est vivant et pas de log de survie, il a encore sa vie
        const ancienPlayer = players.find(p => p.role === 'Ancien');
        if (ancienPlayer && ancienPlayer.alive) {
          const ancienUsedLife = actionLog.some(a => a.text && a.text.includes('vie supplémentaire'));
          ancienPlayer.ancienExtraLife = !ancienUsedLife;
        }
        
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
