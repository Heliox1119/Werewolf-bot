const ROLES = require("./roles");
const PHASES = require("./phases");
const BalanceMode = require('./balanceMode');
const { generateRoles } = require('./roleGeneration');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { game: logger } = require('../utils/logger');
const GameDatabase = require('../database/db');
const gameMutex = require('./GameMutex');
const { t, translateRole, translateRoleDesc, tips } = require('../utils/i18n');
const { AchievementEngine, ACHIEVEMENTS } = require('./achievements');
const { getColor } = require('../utils/theme');
const nightEngine = require('./nightResolutionEngine');
const { selectNarrative } = require('./narrationPools');

// Timeouts configurables (en ms)
const TIMEOUTS = {
  LOBBY_AUTO_CLEANUP: 60 * 60 * 1000, // 1h
  NIGHT_AFK: 120_000,                  // 120s (augmenté)
  HUNTER_SHOOT: 90_000,                // 90s (augmenté)
  DAY_VOTE: 480_000,                   // 8 min (discussion + vote fusionnés)
  STUCK_GAME_THRESHOLD: Number.isFinite(Number(process.env.GAME_STUCK_THRESHOLD_MS))
    ? Number(process.env.GAME_STUCK_THRESHOLD_MS)
    : 10 * 60 * 1000,
  CAPTAIN_VOTE: 120_000,               // 2 min pour le vote capitaine
  CAPTAIN_TIEBREAK: 60_000,            // 60s pour le départage capitaine
  RECENT_COMMAND_WINDOW: 5_000,        // 5s
  RECENT_COMMAND_CLEANUP: 30_000,      // 30s
  RECENT_COMMAND_INTERVAL: 60_000,     // 60s interval de nettoyage
  MAX_NO_KILL_CYCLES: 3,               // 3 cycles jour/nuit sans mort → draw automatique
  BALANCE_TOGGLE_DEBOUNCE: 500         // 500ms debounce for balance mode toggle
};

class GameManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.games = new Map(); // Cache en mémoire pour performance
    this.db = options.db || new GameDatabase(options.dbPath || null); // Base de données SQLite
    this.lobbyTimeouts = new Map(); // channelId -> timeoutId
    this.saveTimeout = null; // Debounce saveState calls
    this.saveInProgress = false;
    this.creationsInProgress = new Set(); // Track ongoing channel creation to prevent duplicates
    this.recentCommands = new Map(); // Cache pour déduplication: "command:channelId:userId" -> timestamp
    this.dirtyGames = new Set(); // Track which games need DB sync
    this.gameMutex = gameMutex; // Async mutex per game
    this._atomicContexts = new Map(); // channelId -> { active, postCommit: [] }
    this.activeGameTimers = new Map(); // channelId -> { type, epoch }
    this._timerEpochs = new Map(); // channelId -> number
    this.statusPanels = new Map(); // channelId -> { villageMsg, spectatorMsg }
    this.rolePanels = new Map();   // gameChannelId -> { wolves: msg, seer: msg, witch: msg, ... }
    this.villagePanels = new Map();      // gameChannelId -> Discord Message
    this.spectatorPanels = new Map();    // gameChannelId -> Discord Message (auto-posted in spectator channel)
    this._villagePanelTimers = new Map(); // gameChannelId -> intervalId (15s tick)
    this._guiPostingInProgress = new Set(); // gameChannelId — prevents concurrent _post* for the same game
    this._guiRefreshScheduled = new Set(); // gameChannelId — coalesces rapid _refreshAllGui calls
    this._balanceToggleLocks = new Map(); // channelId -> timestamp (debounce rapid toggles)
    this._testMode = options.testMode ?? process.env.NODE_ENV === 'test';
    this._failurePoints = new Map();
    this.stuckGameThresholdMs = TIMEOUTS.STUCK_GAME_THRESHOLD;
    
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

  setFailurePoint(pointName, config = {}) {
    if (!this._testMode) return;
    const normalized = typeof config === 'number' ? { hits: config } : config;
    const hits = Math.max(1, normalized.hits || 1);
    this._failurePoints.set(pointName, {
      hits,
      message: normalized.message || `Simulated crash at ${pointName}`,
      code: normalized.code || 'SIMULATED_CRASH'
    });
  }

  clearFailurePoint(pointName) {
    this._failurePoints.delete(pointName);
  }

  clearFailurePoints() {
    this._failurePoints.clear();
  }

  _maybeFail(pointName, context = {}) {
    if (!this._testMode) return;
    const failure = this._failurePoints.get(pointName);
    if (!failure) return;

    failure.hits -= 1;
    if (failure.hits > 0) {
      this._failurePoints.set(pointName, failure);
      return;
    }
    this._failurePoints.delete(pointName);

    const error = new Error(failure.message);
    error.code = failure.code;
    error.isSimulatedCrash = true;
    error.failurePoint = pointName;
    error.failureContext = context;
    throw error;
  }

  simulateProcessCrashForTests() {
    if (!this._testMode) return;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this._recentCommandsInterval) {
      clearInterval(this._recentCommandsInterval);
      this._recentCommandsInterval = null;
    }
    for (const game of this.games.values()) {
      this._clearAllNonLobbyTimerHandles(game);
    }
    for (const timeoutId of this.lobbyTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.lobbyTimeouts.clear();
    this.activeGameTimers.clear();
    this._timerEpochs.clear();
    if (this.db) {
      this.db.close();
    }
  }

  // Check if command was recently executed (within 5 seconds) to prevent Discord retries
  isRecentDuplicate(commandName, channelId, userId) {
    const key = `${commandName}:${channelId}:${userId}`;
    const lastExecution = this.recentCommands.get(key);
    
    if (lastExecution) {
      const elapsed = Date.now() - lastExecution;
      if (elapsed < TIMEOUTS.RECENT_COMMAND_WINDOW) {
        logger.warn('DUPLICATE_COMMAND_DETECTED', {
          command: commandName,
          channelId,
          userId,
          elapsedMs: elapsed
        });
        return true;
      }
    }

    this.recentCommands.set(key, Date.now());
    return false;
  }

  setLobbyTimeout(channelId) {
    const existing = this.activeGameTimers.get(channelId);
    if (existing && existing.type === 'lobby' && this.lobbyTimeouts.has(channelId)) {
      return;
    }

    const game = this.games.get(channelId);
    if (game) {
      this._clearAllNonLobbyTimerHandles(game);
      game._activeTimerType = null;
    }

    this.clearLobbyTimeout(channelId);
    const epoch = this._activateTimer(channelId, 'lobby');
    const timeoutId = setTimeout(async () => {
      const game = this.games.get(channelId);
      if (!this._isTimerStillActive(channelId, 'lobby', epoch)) return;
      this._deactivateTimer(channelId, 'lobby', epoch);
      if (!game) return;
      try {
        const bot = require.main && require.main.exports && require.main.exports.client ? require.main.exports.client : null;
        const guild = bot ? bot.guilds.cache.get(game.guildId) : null;
        if (guild) {
          // Edit the lobby message to show expired state BEFORE deleting channels
          await this._editLobbyExpired(guild, game);
          this._emitGameEvent(game, 'gameEnded', { victor: null, reason: 'timeout' });
          await this.cleanupChannels(guild, game);
          this.purgeGame(channelId, game);
          logger.info('LOBBY_AUTO_DELETED', { channelId });
        }
      } catch (e) { logger.error('LOBBY_AUTO_CLEANUP_FAILED', e); }
    }, TIMEOUTS.LOBBY_AUTO_CLEANUP);
    this.lobbyTimeouts.set(channelId, timeoutId);
    if (game) {
      game._activeTimerType = 'lobby';
    }
  }

  /**
   * Edit the lobby message to show an "expired / cancelled" state.
   * Removes all buttons and replaces the embed with a greyed-out version.
   * Safely handles missing channel, deleted message, permission errors, etc.
   */
  async _editLobbyExpired(guild, game) {
    if (!game || !game.lobbyMessageId || !game.mainChannelId) return;
    try {
      const { buildLobbyExpiredMessage } = require('../utils/lobbyBuilder');
      const channel = await guild.channels.fetch(game.mainChannelId).catch(() => null);
      if (!channel) return;
      const msg = await channel.messages.fetch(game.lobbyMessageId).catch(() => null);
      if (!msg) return;
      await msg.edit(buildLobbyExpiredMessage(game));
    } catch (err) {
      // Non-critical: if the edit fails (deleted msg, no perms), we still
      // proceed with channel cleanup and game purge.
      logger.warn('LOBBY_EXPIRED_EDIT_FAILED', { channelId: game.mainChannelId, error: err.message });
    }
  }

  clearLobbyTimeout(channelId) {
    const timeoutId = this.lobbyTimeouts.get(channelId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.lobbyTimeouts.delete(channelId);
    }
    const active = this.activeGameTimers.get(channelId);
    if (active && active.type === 'lobby') {
      this._deactivateTimer(channelId, 'lobby', active.epoch);
    }
    const game = this.games.get(channelId);
    if (game && game._activeTimerType === 'lobby') {
      game._activeTimerType = null;
    }
  }

  // Nettoyer tous les timers d'une partie (AFK nuit, chasseur, capitaine)
  clearGameTimers(game) {
    if (!game) return;
    this.clearLobbyTimeout(game.mainChannelId);
    this._clearAllNonLobbyTimerHandles(game);
    this._deactivateTimer(game.mainChannelId);
    game._activeTimerType = null;
  }

  _clearAllNonLobbyTimerHandles(game) {
    if (!game) return;
    if (game._nightAfkTimer) {
      clearTimeout(game._nightAfkTimer);
      game._nightAfkTimer = null;
    }
    if (game._hunterTimer) {
      clearTimeout(game._hunterTimer);
      game._hunterTimer = null;
    }
    if (game._dayTimer) {
      clearTimeout(game._dayTimer);
      game._dayTimer = null;
    }
    if (game._captainVoteTimer) {
      clearTimeout(game._captainVoteTimer);
      game._captainVoteTimer = null;
    }
    game._timerDeadline = null;
    game._timerTotalMs = null;
  }

  _getTimerFieldByType(timerType) {
    if (timerType.startsWith('night')) return '_nightAfkTimer';
    if (timerType.startsWith('hunter')) return '_hunterTimer';
    if (timerType.startsWith('day')) return '_dayTimer';
    if (timerType.startsWith('captain')) return '_captainVoteTimer';
    return null;
  }

  _nextTimerEpoch(channelId) {
    const next = (this._timerEpochs.get(channelId) || 0) + 1;
    this._timerEpochs.set(channelId, next);
    return next;
  }

  _activateTimer(channelId, type) {
    const epoch = this._nextTimerEpoch(channelId);
    this.activeGameTimers.set(channelId, { type, epoch });
    return epoch;
  }

  _deactivateTimer(channelId, expectedType = null, expectedEpoch = null) {
    const active = this.activeGameTimers.get(channelId);
    if (!active) return;
    if (expectedType && active.type !== expectedType) return;
    if (expectedEpoch !== null && active.epoch !== expectedEpoch) return;
    this.activeGameTimers.delete(channelId);
    const game = this.games.get(channelId);
    if (game) {
      game._activeTimerType = null;
      game._timerDeadline = null;
      game._timerTotalMs = null;
    }
  }

  _isTimerStillActive(channelId, type, epoch) {
    const active = this.activeGameTimers.get(channelId);
    return !!active && active.type === type && active.epoch === epoch;
  }

  /**
   * Get timer info for GUI display (read-only, no mutation).
   * @param {string} channelId
   * @returns {{ type: string, remainingMs: number, totalMs: number } | null}
   */
  getTimerInfo(channelId) {
    const game = this.games.get(channelId);
    if (!game || !game._timerDeadline) return null;
    const remainingMs = Math.max(0, game._timerDeadline - Date.now());
    return {
      type: game._activeTimerType,
      remainingMs,
      totalMs: game._timerTotalMs || 0,
    };
  }

  _scheduleGameTimer(game, timerType, delay, callback) {
    const channelId = game.mainChannelId;
    const active = this.activeGameTimers.get(channelId);
    const timerField = this._getTimerFieldByType(timerType);

    if (active && active.type === timerType && timerField && game[timerField]) {
      return false;
    }

    this.clearLobbyTimeout(channelId);
    this._clearAllNonLobbyTimerHandles(game);
    this._maybeFail('before_timer_scheduling', { channelId, timerType, delay });

    const epoch = this._activateTimer(channelId, timerType);
    game._activeTimerType = timerType;
    game._timerDeadline = Date.now() + delay;
    game._timerTotalMs = delay;

    const timeoutId = setTimeout(async () => {
      if (!this._isTimerStillActive(channelId, timerType, epoch)) return;

      if (timerField) {
        game[timerField] = null;
      }
      this._deactivateTimer(channelId, timerType, epoch);
      await callback();
    }, delay);

    if (timerField) {
      game[timerField] = timeoutId;
    }
    return true;
  }

  // --- Captain vote timeout ---
  startCaptainVoteTimeout(guild, game) {
    const ctx = this._atomicContexts.get(game.mainChannelId);
    if (ctx && ctx.active) {
      this._queuePostCommit(game.mainChannelId, () => this.startCaptainVoteTimeout(guild, game));
      return;
    }
    this.clearCaptainVoteTimeout(game);
    this._scheduleGameTimer(game, 'captain-vote', TIMEOUTS.CAPTAIN_VOTE, async () => {
      try {
        if (game.subPhase !== PHASES.VOTE_CAPITAINE) return;
        if (game.captainId) return;

        const mainChannel = game.villageChannelId
          ? await guild.channels.fetch(game.villageChannelId)
          : await guild.channels.fetch(game.mainChannelId);

        const res = await this.resolveCaptainVote(game.mainChannelId);
        if (res.ok) {
          const msgKey = res.wasTie ? 'game.captain_random_elected' : 'game.captain_auto_elected';
          await this.sendLogged(mainChannel, t(msgKey, { name: res.username }), { type: 'captainAutoElected' });
          this.logAction(game, `Capitaine auto-élu (timeout): ${res.username}${res.wasTie ? ' (égalité)' : ''}`);
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
          const randomResult = await this.runAtomic(game.mainChannelId, (state) => {
            const alivePlayers = state.players.filter(p => p.alive);
            if (alivePlayers.length === 0) return null;
            const random = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            state.captainId = random.id;
            state.captainVotes.clear();
            state.captainVoters.clear();
            this.db.clearVotes(game.mainChannelId, 'captain', state.dayCount || 0);
            return { id: random.id, username: random.username };
          });
          if (randomResult) {
            await this.sendLogged(mainChannel, t('game.captain_random_no_votes', { name: randomResult.username }), { type: 'captainRandomNoVotes' });
            this.logAction(game, `Capitaine élu au hasard (aucun vote): ${randomResult.username}`);
          }
        }

        await this.advanceSubPhase(guild, game);
      } catch (e) {
        logger.error('CAPTAIN_VOTE_TIMEOUT_ERROR', { error: e.message });
      }
    });
  }

  clearCaptainVoteTimeout(game) {
    if (game._captainVoteTimer) {
      clearTimeout(game._captainVoteTimer);
      game._captainVoteTimer = null;
    }
    const active = this.activeGameTimers.get(game.mainChannelId);
    if (active && active.type === 'captain-vote') {
      this._deactivateTimer(game.mainChannelId, active.type, active.epoch);
    }
  }

  // --- Captain tiebreak timeout ---
  // Auto-resolves a captain tiebreak if the captain is AFK
  startCaptainTiebreakTimeout(guild, game) {
    const ctx = this._atomicContexts.get(game.mainChannelId);
    if (ctx && ctx.active) {
      this._queuePostCommit(game.mainChannelId, () => this.startCaptainTiebreakTimeout(guild, game));
      return;
    }
    this.clearCaptainTiebreakTimeout(game);
    this._scheduleGameTimer(game, 'captain-tiebreak', TIMEOUTS.CAPTAIN_TIEBREAK, async () => {
      try {
        if (game.phase !== PHASES.DAY) return;

        const mainChannel = game.villageChannelId
          ? await guild.channels.fetch(game.villageChannelId)
          : await guild.channels.fetch(game.mainChannelId);

        // Captain AFK → nobody dies (per spec: no random elimination)
        const voteEngine = require('./villageVoteEngine');
        await this.runAtomic(game.mainChannelId, (state) => {
          if (state.villageVoteState) {
            voteEngine.resolveCaptainTiebreakTimeout(state.villageVoteState);
          }
          state._captainTiebreak = null;
        });

        await this.sendLogged(mainChannel, t('game.captain_tiebreak_afk'), { type: 'captainTiebreakTimeout' });
        this.logAction(game, 'Capitaine AFK au départage — personne ne meurt');

        // Proceed to night
        await this.transitionToNight(guild, game);
      } catch (e) {
        logger.error('CAPTAIN_TIEBREAK_TIMEOUT_ERROR', { error: e.message, stack: e.stack });
      }
    });
  }

  clearCaptainTiebreakTimeout(game) {
    const active = this.activeGameTimers.get(game.mainChannelId);
    if (active && active.type === 'captain-tiebreak') {
      this._deactivateTimer(game.mainChannelId, active.type, active.epoch);
    }
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
    this.statusPanels.clear();
    this.rolePanels.clear();
    this.spectatorPanels.clear();
    this._guiPostingInProgress.clear();
    this._guiRefreshScheduled.clear();
    // Stop all village panel timer ticks
    for (const intervalId of this._villagePanelTimers.values()) {
      clearInterval(intervalId);
    }
    this._villagePanelTimers.clear();
    this.villagePanels.clear();
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
    this._markMutation(channelId);
    this.dirtyGames.add(channelId);
  }

  _markMutation(channelOrGame) {
    const game = typeof channelOrGame === 'string'
      ? this.games.get(channelOrGame)
      : channelOrGame;
    if (!game) return;
    game._lastMutationAt = Date.now();
    game.stuckStatus = 'OK';
  }

  detectStuckGames(thresholdMs = this.stuckGameThresholdMs) {
    const now = Date.now();
    const stuckGames = [];

    for (const game of this.games.values()) {
      if (!game || !game.startedAt || game.phase === PHASES.ENDED) {
        continue;
      }

      const referenceTs = game._lastMutationAt || game.startedAt;
      const inactivityMs = now - referenceTs;
      const isStuck = inactivityMs > thresholdMs;

      if (isStuck) {
        if (game.stuckStatus !== 'STUCK') {
          game.stuckStatus = 'STUCK';
          logger.warn('GAME_STUCK_DETECTED', {
            channelId: game.mainChannelId,
            guildId: game.guildId,
            phase: game.phase,
            subPhase: game.subPhase,
            inactivityMs,
            thresholdMs
          });
        }
        stuckGames.push(game);
      } else if (game.stuckStatus === 'STUCK') {
        game.stuckStatus = 'OK';
      }
    }

    return stuckGames;
  }

  getStuckGamesCount(thresholdMs = this.stuckGameThresholdMs) {
    return this.detectStuckGames(thresholdMs).length;
  }

  /**
   * Set sub-phase with FSM validation + dirty marking.
   * @param {object} game
   * @param {string} newSubPhase
   */
  _setSubPhase(game, newSubPhase, options = {}) {
    const { allowOutsideAtomic = false, skipValidation = false } = options;
    const from = game.subPhase;
    if (!PHASES.isKnownSubPhase(newSubPhase)) {
      throw new Error(`Unknown subPhase rejected: ${newSubPhase}`);
    }
    if (!skipValidation && !PHASES.isValidTransition(from, newSubPhase)) {
      throw new Error(`Illegal subPhase transition: ${from} -> ${newSubPhase}`);
    }
    if (!allowOutsideAtomic) {
      this._assertAtomic(game.mainChannelId);
    }
    this._maybeFail('during_subphase_transition', {
      channelId: game.mainChannelId,
      from,
      to: newSubPhase
    });
    game.subPhase = newSubPhase;
    this.markDirty(game.mainChannelId);
    // Emit subPhaseChanged so all GUI panels refresh automatically
    this._emitGameEvent(game, 'subPhaseChanged', { from, subPhase: newSubPhase });
  }

  _setPhase(game, newPhase, options = {}) {
    const { allowOutsideAtomic = false } = options;
    const from = game.phase;
    if (!PHASES.isKnownMainPhase(newPhase)) {
      throw new Error(`Unknown phase rejected: ${newPhase}`);
    }
    if (!PHASES.isValidMainTransition(from, newPhase)) {
      throw new Error(`Illegal phase transition: ${from} -> ${newPhase}`);
    }
    if (!allowOutsideAtomic) {
      this._assertAtomic(game.mainChannelId);
    }
    game.phase = newPhase;
    game._lastPhaseChangeAt = Date.now();

    // ── Dynamic narration: select ONCE per phase transition ──
    if (newPhase !== PHASES.ENDED) {
      game.currentNarrative = selectNarrative(game, newPhase);
    } else {
      game.currentNarrative = null;
    }

    this.markDirty(game.mainChannelId);
  }

  _assertAtomic(channelId) {
    const ctx = this._atomicContexts.get(channelId);
    if (!ctx || !ctx.active) {
      throw new Error(`State mutation outside runAtomic is forbidden for channel ${channelId}`);
    }
    return ctx;
  }

  _queuePostCommit(channelId, fn) {
    const ctx = this._atomicContexts.get(channelId);
    if (!ctx || !ctx.active) {
      fn();
      return;
    }
    ctx.postCommit.push(fn);
  }

  _createStateSnapshot(game) {
    const clone = (value) => {
      if (value === null || value === undefined) return value;
      if (value instanceof Map) return new Map(Array.from(value.entries(), ([k, v]) => [k, clone(v)]));
      if (value instanceof Set) return new Set(Array.from(value.values(), (v) => clone(v)));
      if (Array.isArray(value)) return value.map(clone);
      if (value instanceof Date) return new Date(value.getTime());
      if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
          if (typeof v === 'function') continue;
          out[k] = clone(v);
        }
        return out;
      }
      return value;
    };

    const snapshot = {};
    const excluded = new Set(['_nightAfkTimer', '_hunterTimer', '_dayTimer', '_captainVoteTimer']);
    for (const [key, value] of Object.entries(game)) {
      if (excluded.has(key)) continue;
      if (typeof value === 'function') continue;
      snapshot[key] = clone(value);
    }
    return snapshot;
  }

  _restoreStateSnapshot(game, snapshot) {
    const excluded = new Set(['_nightAfkTimer', '_hunterTimer', '_dayTimer', '_captainVoteTimer']);
    for (const key of Object.keys(game)) {
      if (excluded.has(key)) continue;
      delete game[key];
    }
    for (const [key, value] of Object.entries(snapshot)) {
      game[key] = value;
    }
  }

  /**
   * Run a state mutation atomically:
   * - acquire per-game mutex
   * - snapshot in-memory state
   * - apply mutation callback
   * - sync to DB (must succeed)
   * - rollback snapshot on any error
   */
  async runAtomic(channelId, mutationFn) {
    const existing = this._atomicContexts.get(channelId);
    if (existing && existing.active) {
      throw new Error(`runAtomic recursion is forbidden for channel ${channelId}`);
    }

    const release = await this.gameMutex.acquire(channelId);
    const game = this.games.get(channelId);
    if (!game) {
      release();
      throw new Error(`runAtomic called for unknown game ${channelId}`);
    }

    const snapshot = this._createStateSnapshot(game);
    const ctx = { active: true, postCommit: [] };
    this._atomicContexts.set(channelId, ctx);

    try {
      const mutationResult = mutationFn(game);
      if (mutationResult && typeof mutationResult.then === 'function') {
        throw new Error('runAtomic mutationFn must be synchronous (async gap forbidden before commit)');
      }

      this._maybeFail('after_memory_mutation', { channelId });
      this._maybeFail('before_db_commit', { channelId });

      this.syncGameToDb(channelId, { throwOnError: true });
      this._markMutation(game);

      this._maybeFail('after_db_commit', { channelId });

      for (const action of ctx.postCommit) {
        action();
      }

      return mutationResult;
    } catch (error) {
      this._restoreStateSnapshot(game, snapshot);
      throw error;
    } finally {
      ctx.active = false;
      this._atomicContexts.delete(channelId);
      release();
    }
  }

  async runAtomicMutation(game, mutator) {
    return this.runAtomic(game.mainChannelId, mutator);
  }

  // Retourne toutes les parties actives sous forme de tableau
  getAllGames() {
    return Array.from(this.games.values());
  }

  // ── Single source of truth: reconcile memory ↔ DB ─────────────

  /**
   * Unified game lookup.  Checks memory first, falls back to DB.
   * If DB contains a row with no matching in-memory game the row is
   * treated as a *zombie* and is deleted.  This guarantees memory and
   * DB never diverge silently.
   *
   * @param {string} channelId  — mainChannel (or any sub-channel) ID
   * @returns {object|null} the in-memory game, or null
   */
  getGameByChannel(channelId) {
    // 1. Fast-path: exact mainChannel match in memory
    if (this.games.has(channelId)) return this.games.get(channelId);

    // 2. Sub-channel scan (village, wolves, seer, etc.)
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

    // 3. NOT in memory — check DB for zombie row
    try {
      const dbRow = this.db.getGame(channelId);
      if (dbRow) {
        logger.warn('ZOMBIE_GAME_DETECTED', {
          channelId,
          phase: dbRow.phase,
          createdAt: dbRow.created_at,
          endedAt: dbRow.ended_at,
        });
        // Purge the orphan DB row so /create can proceed
        this.db.deleteGame(channelId);
        logger.info('ZOMBIE_GAME_PURGED', { channelId });
      }
    } catch (e) {
      logger.warn('DB_RECONCILE_LOOKUP_FAILED', { channelId, error: e.message });
    }

    return null;
  }

  /**
   * Full purge of a game — clears memory, DB, and timers.
   * This is the ONLY function that should be called when a game needs
   * to be completely removed.  Callers should NOT do manual deletions.
   *
   * @param {string} channelId  — mainChannelId of the game
   * @param {object} [game]     — optional in-memory game object (avoids a lookup)
   */
  purgeGame(channelId, game = null) {
    game = game || this.games.get(channelId);

    // 1. Clear all timers (safe even if game is null)
    if (game) {
      this.clearGameTimers(game);
    }
    this.clearLobbyTimeout(channelId);

    // 2. Remove from memory
    this.games.delete(channelId);

    // 3. Remove from DB (CASCADE deletes players, votes, logs, etc.)
    try {
      const deleted = this.db.deleteGame(channelId);
      if (deleted) {
        logger.info('GAME_PURGED_FROM_DB', { channelId });
      }
    } catch (e) {
      logger.warn('DB_PURGE_DELETE_FAILED', { channelId, error: e.message });
    }

    // 4. Mark dirty games cache clean
    this.dirtyGames.delete(channelId);

    logger.info('GAME_FULLY_PURGED', { channelId });
  }

  /**
   * Purge ALL zombie DB rows for a guild that have no in-memory game.
   * Returns the number of zombies cleaned.
   *
   * @param {string} guildId
   * @returns {number}
   */
  purgeGuildZombies(guildId) {
    let purged = 0;
    try {
      const dbGames = this.db.getAllGames();
      for (const dbGame of dbGames) {
        if (dbGame.guild_id !== guildId) continue;
        if (!this.games.has(dbGame.channel_id)) {
          logger.warn('GUILD_ZOMBIE_PURGING', { channelId: dbGame.channel_id, guildId });
          this.db.deleteGame(dbGame.channel_id);
          purged++;
        }
      }
    } catch (e) {
      logger.warn('GUILD_ZOMBIE_PURGE_FAILED', { guildId, error: e.message });
    }
    return purged;
  }

  create(channelId, options = {}) {
    if (this.games.has(channelId)) return false;

    // Reconcile: if DB has a zombie row for this channel, purge it first
    try {
      const dbRow = this.db.getGame(channelId);
      if (dbRow) {
        logger.warn('ZOMBIE_DETECTED_ON_CREATE', { channelId });
        this.db.deleteGame(channelId);
      }
    } catch (e) {
      logger.warn('DB_CHECK_FAILED_ON_CREATE', { channelId, error: e.message });
    }

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
      logger.error('CREATE_GAME_NULL_AFTER_PURGE', { channelId });
      return false;
    }

    // Initialiser les potions de la sorcière dans la DB
    this.db.initWitchPotions(channelId);

    // Créer dans le cache mémoire
    this.games.set(channelId, {
      id: gameId,
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
      wolvesVoteState: require('./wolfVoteEngine').createWolvesVoteState(),
      villageVoteState: require('./villageVoteEngine').createVillageVoteState(),
      listenHintsGiven: [],
      littleGirlExposureLevel: 0,
      littleGirlListenedThisNight: false,
      littleGirlExposed: false,
      rules: { minPlayers, maxPlayers },
      actionLog: [],
      startedAt: null,
      endedAt: null,
      disableVoiceMute: options.disableVoiceMute || false,
      balanceMode: options.balanceMode || BalanceMode.DYNAMIC,
      _activeTimerType: null,
      _lastMutationAt: Date.now(),
      _lastPhaseChangeAt: null,   // timestamp of last Night↔Day transition (drives transition visual)
      _lastNightDeathCount: 0,       // deaths last night (drives narration context)
      currentNarrative: null,        // { phase, text, tone, context } — set once per phase transition
      stuckStatus: 'OK',
      uiMode: 'GUI_MASTER'  // GUI is the sole visual source of truth (no loose text for phase/status)
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
    return this.getGameByChannel(channelId);
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
    // Auto-refresh ALL GUI panels on any visible state change (fire-and-forget, coalesced)
    const GUI_EVENTS = ['phaseChanged', 'subPhaseChanged', 'playerKilled', 'gameEnded', 'gameStarted', 'voteCompleted', 'captainElected'];
    if (GUI_EVENTS.includes(eventName)) {
      const gid = game.mainChannelId;
      // Coalesce: if a refresh is already scheduled for this game, skip
      if (!this._guiRefreshScheduled.has(gid)) {
        this._guiRefreshScheduled.add(gid);
        setImmediate(() => {
          this._guiRefreshScheduled.delete(gid);
          this._refreshAllGui(gid).catch(() => {});
        });
      }
    }
  }

  // ─── Unified GUI Refresh Orchestrator ───────────────────────────

  /**
   * Refresh ALL GUI panels for a game: village master, role channels, spectator, /status panels.
   * Pure read-only — no game state mutation, no DB writes, no business logic.
   * Called automatically on every visible state change via _emitGameEvent.
   * @param {string} gameChannelId  mainChannelId of the game
   */
  async _refreshAllGui(gameChannelId) {
    // Skip refresh while initial posting is in progress (avoid recovery creating duplicates)
    if (this._guiPostingInProgress.has(gameChannelId)) return;
    // Fire all refreshes in parallel (independent, idempotent)
    await Promise.allSettled([
      this._refreshVillageMasterPanel(gameChannelId),
      this._refreshRolePanels(gameChannelId),
      this._refreshStatusPanels(gameChannelId),
      this._refreshSpectatorPanel(gameChannelId),
    ]);
  }



  /**
   * Auto-refresh registered status panel messages (read-only, no game mutation).
   * Panels are Discord messages registered by the /status command.
   */
  async _refreshStatusPanels(gameChannelId) {
    const panelRef = this.statusPanels.get(gameChannelId);
    if (!panelRef) return;

    const game = this.games.get(gameChannelId);
    if (!game) {
      this.statusPanels.delete(gameChannelId);
      return;
    }

    const timerInfo = this.getTimerInfo(gameChannelId);
    const { buildStatusEmbed, buildSpectatorEmbed } = require('./gameStateView');

    // Refresh village panel
    if (panelRef.villageMsg) {
      try {
        const embed = buildStatusEmbed(game, timerInfo, game.guildId);
        await panelRef.villageMsg.edit({ embeds: [embed] });
      } catch (_) {
        panelRef.villageMsg = null;
      }
    }

    // Refresh spectator panel
    if (panelRef.spectatorMsg) {
      try {
        const embed = buildSpectatorEmbed(game, timerInfo, game.guildId);
        await panelRef.spectatorMsg.edit({ embeds: [embed] });
      } catch (_) {
        panelRef.spectatorMsg = null;
      }
    }

    // Cleanup if no panels left
    if (!panelRef.villageMsg && !panelRef.spectatorMsg) {
      this.statusPanels.delete(gameChannelId);
    }
  }

  /**
   * Post persistent role channel panels (one per role channel).
   * Called once when the game starts. Panels are then edited, never reposted.
   * @param {Guild} guild
   * @param {object} game
   */
  async _postRolePanels(guild, game) {
    // Guard: never post if panels already exist for this game
    if (this.rolePanels.has(game.mainChannelId)) {
      const existing = this.rolePanels.get(game.mainChannelId);
      if (existing && Object.values(existing).some(m => m)) {
        logger.debug('ROLE_PANELS_ALREADY_EXIST', { channelId: game.mainChannelId });
        return;
      }
    }
    const { getRoleChannels, buildRolePanel, getRoleKeyImage, buildRolePanelComponents } = require('./roleChannelView');
    const { AttachmentBuilder } = require('discord.js');
    const { mapConcurrent } = require('../utils/concurrency');
    const roleChannels = getRoleChannels(game);
    const timerInfo = this.getTimerInfo(game.mainChannelId);
    const panelRef = {};

    logger.info('ROLE_PANELS_POSTING', {
      channelId: game.mainChannelId,
      roleChannelCount: Object.keys(roleChannels).length,
      roleKeys: Object.keys(roleChannels),
    });

    let posted = 0;
    let failed = 0;
    const entries = Object.entries(roleChannels);

    // Post panels concurrently (concurrency = 3) — each: fetch + send + pin = 3 API calls
    await mapConcurrent(entries, async ([roleKey, channelId]) => {
      try {
        const channel = await guild.channels.fetch(channelId);
        if (!channel) {
          logger.warn('ROLE_PANEL_CHANNEL_NOT_FOUND', { roleKey, channelId });
          failed++;
          return;
        }
        const embed = buildRolePanel(roleKey, game, timerInfo, game.guildId);
        if (!embed) {
          logger.warn('ROLE_PANEL_BUILD_NULL', { roleKey });
          failed++;
          return;
        }
        const sendPayload = { embeds: [embed] };
        const imageFile = getRoleKeyImage(roleKey);
        if (imageFile) {
          const imagePath = path.join(__dirname, '..', 'img', imageFile);
          sendPayload.files = [new AttachmentBuilder(imagePath, { name: imageFile })];
        }
        const components = buildRolePanelComponents(roleKey, game, game.guildId);
        if (components.length > 0) sendPayload.components = components;
        const msg = await channel.send(sendPayload);
        panelRef[roleKey] = msg;
        posted++;
        // Auto-pin the role panel
        try { await msg.pin(); } catch (_) { /* ignore pin failures */ }
      } catch (e) {
        logger.warn('ROLE_PANEL_POST_FAILED', { roleKey, channelId, error: e.message });
        failed++;
      }
    }, 3, { swallowErrors: true });

    logger.info('ROLE_PANELS_POST_COMPLETE', {
      channelId: game.mainChannelId,
      posted,
      failed,
      total: Object.keys(roleChannels).length,
    });

    // Only register panels if at least one was posted — allows recovery on next refresh
    if (posted > 0) {
      this.rolePanels.set(game.mainChannelId, panelRef);
    } else if (Object.keys(roleChannels).length > 0) {
      logger.warn('ROLE_PANELS_ALL_FAILED', {
        channelId: game.mainChannelId,
      });
      // Do NOT set rolePanels — _refreshRolePanels will detect the gap and re-post
    }
  }

  /**
   * Auto-refresh all registered role channel panels (read-only, no game mutation).
   * If panels are missing (e.g. after bot restart), re-posts them.
   * @param {string} gameChannelId  The mainChannelId of the game
   */
  async _refreshRolePanels(gameChannelId) {
    const game = this.games.get(gameChannelId);
    if (!game || game.phase === PHASES.ENDED) return;

    // If no panels registered (e.g. after reboot or failed initial posting), re-create them
    // Guard: skip recovery if a post is already in progress
    if (!this.rolePanels.has(gameChannelId)) {
      if (this._guiPostingInProgress.has(gameChannelId)) return;
      logger.info('ROLE_PANELS_RECOVERY_ATTEMPT', { gameChannelId });
      try {
        const client = require.main?.exports?.client || this.client;
        if (client && game.guildId) {
          const guild = await client.guilds.fetch(game.guildId);
          if (guild) {
            await this._postRolePanels(guild, game);
          }
        }
      } catch (e) {
        logger.warn('ROLE_PANELS_REBOOT_REPOST_FAILED', { gameChannelId, error: e.message });
      }
      return;
    }

    const panelRef = this.rolePanels.get(gameChannelId);
    const { buildRolePanel, getRoleKeyImage, buildRolePanelComponents } = require('./roleChannelView');
    const { AttachmentBuilder } = require('discord.js');
    const timerInfo = this.getTimerInfo(gameChannelId);
    let anyAlive = false;

    for (const [roleKey, msg] of Object.entries(panelRef)) {
      if (!msg) continue;
      try {
        const embed = buildRolePanel(roleKey, game, timerInfo, game.guildId);
        if (!embed) continue;
        const editPayload = { embeds: [embed] };
        const imageFile = getRoleKeyImage(roleKey);
        if (imageFile) {
          const imagePath = path.join(__dirname, '..', 'img', imageFile);
          editPayload.files = [new AttachmentBuilder(imagePath, { name: imageFile })];
        } else {
          editPayload.files = [];
        }
        // Add or remove button components based on current state
        editPayload.components = buildRolePanelComponents(roleKey, game, game.guildId);
        await msg.edit(editPayload);
        anyAlive = true;
      } catch (_) {
        panelRef[roleKey] = null;
      }
    }

    if (!anyAlive) {
      this.rolePanels.delete(gameChannelId);
    }
  }

  // ─── Village Master Panel ─────────────────────────────────────────

  /**
   * Build interactive button components for the village master panel.
   * Currently: Little Girl listen button during LOUPS subPhase.
   * @param {object} game
   * @returns {ActionRowBuilder[]}
   */
  _buildVillagePanelComponents(game) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
    const ROLES_REQ = require('./roles');
    const rows = [];

    // Little Girl listen button during LOUPS subPhase
    if (game.phase === PHASES.NIGHT && game.subPhase === PHASES.LOUPS) {
      const petiteFille = game.players.find(
        p => p.alive && p.role === ROLES_REQ.PETITE_FILLE && !game.villageRolesPowerless
      );
      if (petiteFille && !game.littleGirlExposed) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('lgirl_listen')
            .setLabel(t('role_panel.lgirl_listen_btn', {}, game.guildId))
            .setStyle(ButtonStyle.Secondary)
        );
        rows.push(row);
      }
    }

    // Captain election select menu during VOTE_CAPITAINE subPhase
    if (game.phase === PHASES.DAY && game.subPhase === PHASES.VOTE_CAPITAINE && !game.captainId) {
      const alivePlayers = (game.players || []).filter(p => p.alive);
      if (alivePlayers.length > 0 && alivePlayers.length <= 25) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('captain_elect')
          .setPlaceholder(t('village_panel.captain_elect_ph', {}, game.guildId))
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            alivePlayers.map(p => ({
              label: p.username,
              value: p.id,
            }))
          );
        rows.push(new ActionRowBuilder().addComponents(selectMenu));
      }
    }

    // Village vote select menu during VOTE subPhase
    if (game.phase === PHASES.DAY && game.subPhase === PHASES.VOTE) {
      const voteState = game.villageVoteState;
      if (voteState && !voteState.resolved) {
        const targets = (game.players || []).filter(p => p.alive);
        if (targets.length > 0 && targets.length <= 25) {
          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('village_vote')
            .setPlaceholder(t('village_panel.vote_select_ph', {}, game.guildId))
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              targets.map(p => ({
                label: p.username,
                value: p.id,
                description: p.id === game.captainId
                  ? t('village_panel.vote_option_captain', {}, game.guildId)
                  : undefined,
              }))
            );
          rows.push(new ActionRowBuilder().addComponents(selectMenu));
        }
      }
    }

    // Captain tiebreak select menu
    if (game.phase === PHASES.DAY && game.villageVoteState
        && game.villageVoteState.tiedCandidates.length >= 2
        && !game.villageVoteState.resolved && game.captainId) {
      const candidates = game.villageVoteState.tiedCandidates;
      const options = candidates.map(id => {
        const p = (game.players || []).find(pl => pl.id === id);
        return { label: p ? p.username : id, value: id };
      });
      if (options.length > 0 && options.length <= 25) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('captain_tiebreak')
          .setPlaceholder(t('village_panel.tiebreak_select_ph', {}, game.guildId))
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(options);
        rows.push(new ActionRowBuilder().addComponents(selectMenu));
      }
    }

    return rows;
  }

  /**
   * Post the persistent village master GUI panel in #village.
   * Called once at game start — the message is then edited, never reposted.
   * Auto-pinned so it stays visible above narrative messages.
   * @param {Guild} guild
   * @param {object} game
   */
  async _postVillageMasterPanel(guild, game) {
    // Guard: never post if a panel already exists for this game
    if (this.villagePanels.has(game.mainChannelId) && this.villagePanels.get(game.mainChannelId)) return;
    const { buildVillageMasterEmbed, getPhaseImage } = require('./villageStatusPanel');
    const { AttachmentBuilder } = require('discord.js');
    const channelId = game.villageChannelId || game.mainChannelId;
    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel) return;
      const timerInfo = this.getTimerInfo(game.mainChannelId);
      const embed = buildVillageMasterEmbed(game, timerInfo, game.guildId);
      const sendPayload = { embeds: [embed] };
      const components = this._buildVillagePanelComponents(game);
      if (components.length > 0) sendPayload.components = components;
      const imageFile = getPhaseImage(game.phase);
      if (imageFile) {
        const imagePath = path.join(__dirname, '..', 'img', imageFile);
        sendPayload.files = [new AttachmentBuilder(imagePath, { name: imageFile })];
      }
      const msg = await channel.send(sendPayload);
      this.villagePanels.set(game.mainChannelId, msg);
      // Auto-pin so the panel stays at the top
      try { await msg.pin(); } catch (_) { /* ignore pin failures */ }
      // Start timer tick for live timer display (every 15s)
      this._startVillagePanelTick(game.mainChannelId);
    } catch (e) {
      logger.warn('VILLAGE_PANEL_POST_FAILED', { channelId, error: e.message });
    }
  }

  /**
   * Refresh the village master panel (edit in place).
   * If the panel is missing (e.g. after bot restart), re-posts it.
   * @param {string} gameChannelId  mainChannelId of the game
   */
  async _refreshVillageMasterPanel(gameChannelId) {
    const game = this.games.get(gameChannelId);
    if (!game) return;

    // On game end, do one final refresh then stop the tick
    if (game.phase === PHASES.ENDED) {
      this._stopVillagePanelTick(gameChannelId);
    }

    // If no panel (reboot recovery), try to recreate
    // Guard: skip recovery if a post is already in progress
    if (!this.villagePanels.has(gameChannelId)) {
      if (game.phase === PHASES.ENDED) return; // Don't recreate for ended games
      if (this._guiPostingInProgress.has(gameChannelId)) return;
      try {
        const client = require.main?.exports?.client || this.client;
        if (client && game.guildId) {
          const guild = await client.guilds.fetch(game.guildId);
          if (guild) await this._postVillageMasterPanel(guild, game);
        }
      } catch (e) {
        logger.warn('VILLAGE_PANEL_REBOOT_REPOST_FAILED', { gameChannelId, error: e.message });
      }
      return;
    }

    const msg = this.villagePanels.get(gameChannelId);
    if (!msg) {
      this.villagePanels.delete(gameChannelId);
      return;
    }

    try {
      const { buildVillageMasterEmbed, getPhaseImage } = require('./villageStatusPanel');
      const { AttachmentBuilder } = require('discord.js');
      const timerInfo = this.getTimerInfo(gameChannelId);
      const embed = buildVillageMasterEmbed(game, timerInfo, game.guildId);
      const editPayload = { embeds: [embed] };
      // Village panel components (Little Girl listen button during LOUPS)
      editPayload.components = this._buildVillagePanelComponents(game);
      const imageFile = getPhaseImage(game.phase);
      if (imageFile) {
        const imagePath = path.join(__dirname, '..', 'img', imageFile);
        editPayload.files = [new AttachmentBuilder(imagePath, { name: imageFile })];
      } else {
        editPayload.files = [];
      }
      await msg.edit(editPayload);
    } catch (_) {
      // Message deleted or inaccessible — remove reference
      this.villagePanels.delete(gameChannelId);
      this._stopVillagePanelTick(gameChannelId);
    }
  }

  /**
   * Post the persistent spectator GUI panel in the spectator channel.
   * Called once at game start. The panel is then auto-refreshed on state changes.
   * @param {Guild} guild
   * @param {object} game
   */
  async _postSpectatorPanel(guild, game) {
    if (!game.spectatorChannelId) return;
    // Guard: never post if a panel already exists for this game
    if (this.spectatorPanels.has(game.mainChannelId) && this.spectatorPanels.get(game.mainChannelId)) return;
    try {
      const channel = await guild.channels.fetch(game.spectatorChannelId);
      if (!channel) return;
      const { buildSpectatorEmbed } = require('./gameStateView');
      const timerInfo = this.getTimerInfo(game.mainChannelId);
      const embed = buildSpectatorEmbed(game, timerInfo, game.guildId);
      const msg = await channel.send({ embeds: [embed] });
      this.spectatorPanels.set(game.mainChannelId, msg);
      // Auto-pin so the panel stays visible
      try { await msg.pin(); } catch (_) { /* ignore pin failures */ }
    } catch (e) {
      logger.warn('SPECTATOR_PANEL_POST_FAILED', { channelId: game.spectatorChannelId, error: e.message });
    }
  }

  /**
   * Refresh the persistent spectator panel (edit in place).
   * If the panel is missing (e.g. after bot restart), re-posts it.
   * @param {string} gameChannelId  mainChannelId of the game
   */
  async _refreshSpectatorPanel(gameChannelId) {
    const game = this.games.get(gameChannelId);
    if (!game) return;
    if (!game.spectatorChannelId) return;

    // If no panel registered (reboot recovery), try to recreate
    // Guard: skip recovery if a post is already in progress
    if (!this.spectatorPanels.has(gameChannelId)) {
      if (game.phase === PHASES.ENDED) return; // Don't recreate for ended games
      if (this._guiPostingInProgress.has(gameChannelId)) return;
      try {
        const client = require.main?.exports?.client || this.client;
        if (client && game.guildId) {
          const guild = await client.guilds.fetch(game.guildId);
          if (guild) await this._postSpectatorPanel(guild, game);
        }
      } catch (e) {
        logger.warn('SPECTATOR_PANEL_REBOOT_REPOST_FAILED', { gameChannelId, error: e.message });
      }
      return;
    }

    const msg = this.spectatorPanels.get(gameChannelId);
    if (!msg) {
      this.spectatorPanels.delete(gameChannelId);
      return;
    }

    try {
      const { buildSpectatorEmbed } = require('./gameStateView');
      const timerInfo = this.getTimerInfo(gameChannelId);
      const embed = buildSpectatorEmbed(game, timerInfo, game.guildId);
      await msg.edit({ embeds: [embed] });
    } catch (_) {
      // Message deleted or inaccessible — remove reference
      this.spectatorPanels.delete(gameChannelId);
    }
  }

  /**
   * Start a periodic refresh (every 15s) so the timer display stays live.
   * The tick only triggers an edit if a timer is active, to avoid spam.
   * @param {string} gameChannelId
   */
  _startVillagePanelTick(gameChannelId) {
    // Don't start twice
    if (this._villagePanelTimers.has(gameChannelId)) return;
    const intervalId = setInterval(() => {
      // Only refresh if there's an active timer to update
      const timerInfo = this.getTimerInfo(gameChannelId);
      if (timerInfo && timerInfo.remainingMs > 0) {
        this._refreshVillageMasterPanel(gameChannelId).catch(() => {});
      }
    }, 5_000); // 5 s tick for smooth animated timer bar
    this._villagePanelTimers.set(gameChannelId, intervalId);
  }

  /**
   * Stop the periodic timer tick for a game.
   * @param {string} gameChannelId
   */
  _stopVillagePanelTick(gameChannelId) {
    const intervalId = this._villagePanelTimers.get(gameChannelId);
    if (intervalId) {
      clearInterval(intervalId);
      this._villagePanelTimers.delete(gameChannelId);
    }
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
      wolfWinCondition: (() => { try { const c = require('../utils/config').getInstance(); return c.getWolfWinCondition(game.guildId || null); } catch { return 'majority'; } })(),
      // Additional state fields
      wolvesVoteState: game.wolvesVoteState
        ? { round: game.wolvesVoteState.round, votes: game.wolvesVoteState.votes ? Object.fromEntries(game.wolvesVoteState.votes) : {}, resolved: game.wolvesVoteState.resolved }
        : { round: 1, votes: {}, resolved: false },
      villageVoteState: game.villageVoteState
        ? { votes: game.villageVoteState.votes ? Object.fromEntries(game.villageVoteState.votes) : {}, resolved: game.villageVoteState.resolved, tiedCandidates: game.villageVoteState.tiedCandidates || [] }
        : { votes: {}, resolved: false, tiedCandidates: [] },
      protectedPlayerId: game.protectedPlayerId || null,
      witchKillTarget: game.witchKillTarget || null,
      witchSave: game.witchSave || false,
      whiteWolfKillTarget: game.whiteWolfKillTarget || null,
      thiefExtraRoles: game.thiefExtraRoles || [],
      littleGirlExposureLevel: game.littleGirlExposureLevel || 0,
      littleGirlListenedThisNight: game.littleGirlListenedThisNight || false,
      littleGirlExposed: game.littleGirlExposed || false,
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

  /**
   * Send a message to a channel, with logging.
   *
   * GUI_MASTER architecture: only game-event messages are allowed in public
   * channels. Phase, subPhase, timer, and player-status information MUST be
   * displayed exclusively through the persistent GUI panels (village master,
   * role channels, spectator). Any send whose context.type is not in the
   * ALLOWED_SEND_TYPES set is blocked and logged as a warning.
   */
  static ALLOWED_SEND_TYPES = new Set([
    // One-time game event announces (deaths, reveals, votes, end)
    'nightVictim', 'witchKill', 'whiteWolfKill', 'loverDeath', 'hunterDeath',
    'witchSave', 'salvateurSave', 'ancienSurvives', 'ancienFinalDeath', 'ancienPowerDrain',
    'dayVoteResult', 'voteTie', 'idiotRevealed',
    'captainAutoElected', 'captainRandomNoVotes', 'captainTiebreakTimeout',
    'hunterTimeout', 'victory', 'drawByInactivity', 'summary',
  ]);

  async sendLogged(channel, payload, context = {}) {
    // GUI_MASTER guard: block/warn sends that carry phase/status information
    if (context.type && !GameManager.ALLOWED_SEND_TYPES.has(context.type)) {
      logger.warn('GUI_MASTER_SEND_BLOCKED', {
        channelId: channel?.id,
        type: context.type,
        content: this.formatPayloadSummary(payload)
      });
      return null;
    }
    try {
      logger.info('CHANNEL_SEND', {
        channelId: channel?.id,
        channelName: channel?.name,
        context,
        content: this.formatPayloadSummary(payload)
      });
      return await channel.send(payload);
    } catch (err) {
      logger.error('CHANNEL_SEND_FAILED', {
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

  hasAliveAnyRole(game, role) {
    return game.players.some(p => p.alive && p.role === role);
  }

  // Map night subphase → role responsible for acting
  _subPhaseToRole(subPhase) {
    switch (subPhase) {
      case PHASES.VOLEUR: return ROLES.THIEF;
      case PHASES.CUPIDON: return ROLES.CUPID;
      case PHASES.SALVATEUR: return ROLES.SALVATEUR;
      case PHASES.LOUPS: return ROLES.WEREWOLF;
      case PHASES.LOUP_BLANC: return ROLES.WHITE_WOLF;
      case PHASES.SORCIERE: return ROLES.WITCH;
      case PHASES.VOYANTE: return ROLES.SEER;
      default: return null;
    }
  }

  // Returns true if the current subphase should be auto-skipped
  // because the role holder is a fake player and skipFakePhases is on
  _shouldAutoSkipSubPhase(game) {
    if (!game.skipFakePhases) return false;
    const role = this._subPhaseToRole(game.subPhase);
    if (!role) return false;
    // Skip if the role exists but ONLY on fake players (no real player has it)
    return this.hasAliveAnyRole(game, role) && !this.hasAliveRealRole(game, role);
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
      logger.warn('DEATH_REVEAL_SEND_FAILED', { error: err.message });
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
      logger.warn('TURN_NOTIFICATIONS_SEND_FAILED', { error: err.message });
    }
  }

  /**
   * Initialize the AchievementEngine (called once on bot startup)
   */
  initAchievements() {
    try {
      this.achievements = new AchievementEngine(this.db.db);
      logger.info('ACHIEVEMENT_ENGINE_INITIALIZED');
    } catch (err) {
      logger.error('ACHIEVEMENT_ENGINE_INIT_FAILED', { error: err.message });
    }
  }

  async transitionToDay(guild, game) {
    if (game.phase !== PHASES.NIGHT) return;
    const release = await this.gameMutex.acquire(game.mainChannelId);
    const snapshot = this._createStateSnapshot(game);

    try {
      // Re-check after acquiring lock
      if (game.phase !== PHASES.NIGHT) return;
      const newPhase = await this.nextPhase(guild, game, { skipAtomic: true });
      if (newPhase !== PHASES.DAY) return;

      if (game.voiceChannelId) {
        this.playAmbience(game.voiceChannelId, 'day_ambience.mp3');
      }

      const mainChannel = game.villageChannelId
        ? await guild.channels.fetch(game.villageChannelId)
        : await guild.channels.fetch(game.mainChannelId);

      // ── Night Resolution Engine ─────────────────────────────────
      // 1. Resolve all night events into a context (NO messages sent)
      const ctx = nightEngine.createNightResolutionContext();
      nightEngine.resolveNightVictim(game, ctx, this);
      nightEngine.resolveWitchKill(game, ctx, this);
      nightEngine.resolveWhiteWolfKill(game, ctx, this);
      nightEngine.clearNightState(game);
      nightEngine.resolveHunterDeath(game, ctx);

      // ── Track night death count & refresh narration with accurate context ──
      game._lastNightDeathCount = ctx.deaths ? ctx.deaths.length : 0;
      game.currentNarrative = selectNarrative(game, game.phase);

      this.scheduleSave();

      // 2. Apply dead-player lockouts BEFORE announce (channel perms)
      await this.applyDeadPlayerLockouts(guild);

      // 3. Announce ALL night results in a single narrative block
      await nightEngine.announceNightResults(mainChannel, ctx, game, this, guild);

      // ── Post-announce: victory check & day sub-phase ────────────
      const victoryResult = this.checkWinner(game);
      if (victoryResult) {
        await this.announceVictoryIfAny(guild, game);
      } else {
        // Inline REVEIL→day subphase (cannot call advanceSubPhase here: it uses
        // runAtomic which would deadlock on the mutex we already hold)
        const isFirstDay = (game.dayCount || 0) === 1;
        const captain = game.captainId ? game.players.find(p => p.id === game.captainId) : null;
        const captainDead = !captain || !captain.alive;
        if ((isFirstDay && !game.captainId) || captainDead) {
          game.captainId = null;
          this._setSubPhase(game, PHASES.VOTE_CAPITAINE, { allowOutsideAtomic: true });
          await this.announcePhase(guild, game, t('phase.captain_vote_announce'));
          this.startCaptainVoteTimeout(guild, game);
        } else {
          game.villageVoteState = require('./villageVoteEngine').createVillageVoteState();
          game.dayVoteStartedAt = Date.now();
          this._setSubPhase(game, PHASES.VOTE, { allowOutsideAtomic: true });
          await this.announcePhase(guild, game, t('phase.vote_announce'));
          this.startDayTimeout(guild, game);
        }
      }

      this.syncGameToDb(game.mainChannelId, { throwOnError: true });
    } catch (error) {
      this._restoreStateSnapshot(game, snapshot);
      throw error;
    } finally {
      release();
    }
  }

  async transitionToNight(guild, game) {
    if (game.phase !== PHASES.DAY) return;
    const release = await this.gameMutex.acquire(game.mainChannelId);
    const snapshot = this._createStateSnapshot(game);
    this.clearDayTimeout(game);
    let shouldAutoSkip = false;

    try {
      // Re-check after acquiring lock
      if (game.phase !== PHASES.DAY) return;

      const mainChannel = game.villageChannelId
        ? await guild.channels.fetch(game.villageChannelId)
        : await guild.channels.fetch(game.mainChannelId);

      // --- Resolve village vote using villageVoteEngine ---
      const voteEngine = require('./villageVoteEngine');
      const voteState = game.villageVoteState;
      const resolution = voteEngine.resolveVillageVote(voteState);

      if (resolution.action === 'tie') {
        // Tie detected — enter captain tiebreak or resolve without kill
        const tiedNames = resolution.tiedCandidates.map(id => {
          const p = game.players.find(pl => pl.id === id);
          return p ? `**${p.username}**` : id;
        }).join(', ');

        if (game.captainId) {
          // Captain tiebreak: store tied candidates in villageVoteState, start timer
          // Note: resolveVillageVote already set voteState.tiedCandidates and reset resolved=false
          await this.sendLogged(mainChannel, t('game.vote_tie_captain', {
            names: tiedNames,
            count: resolution.topCount,
            captainId: game.captainId
          }), { type: 'voteTie' });
          this.logAction(game, `Égalité au vote — capitaine doit départager: ${tiedNames}`);
          await this._refreshAllGui(game.mainChannelId);
          this.startCaptainTiebreakTimeout(guild, game);
          this.syncGameToDb(game.mainChannelId, { throwOnError: true });
          return; // Stay in DAY, wait for captain tiebreak
        } else {
          await this.sendLogged(mainChannel, t('game.vote_tie_no_captain', {
            names: tiedNames,
            count: resolution.topCount
          }), { type: 'voteTie' });
          this.logAction(game, `Égalité au vote, pas d'élimination`);
        }
      } else if (resolution.action === 'eliminate') {
        const votedPlayer = game.players.find(p => p.id === resolution.targetId);
        if (votedPlayer && votedPlayer.alive) {
          // Check Idiot du Village
          const idiotEffect = voteEngine.resolveIdiotEffect(votedPlayer);
          if (idiotEffect) {
            votedPlayer.idiotRevealed = true;
            await this.sendLogged(mainChannel, t('game.idiot_revealed', { name: votedPlayer.username }), { type: 'idiotRevealed' });
            this.logAction(game, `Idiot du Village ${votedPlayer.username} révélé mais survit`);
          } else {
            // Check Ancien killed by village
            if (votedPlayer.role === ROLES.ANCIEN) {
              game.villageRolesPowerless = true;
              await this.sendLogged(mainChannel, t('game.ancien_power_drain', { name: votedPlayer.username }), { type: 'ancienPowerDrain' });
              this.logAction(game, `Ancien ${votedPlayer.username} tué par le village — pouvoirs perdus`);
            }

            if (game.voiceChannelId) {
              this.playAmbience(game.voiceChannelId, 'death.mp3');
            }
            await this.sendLogged(mainChannel, t('game.vote_result', { name: votedPlayer.username, count: resolution.topCount }), { type: 'dayVoteResult' });
            const collateral = this.kill(game.mainChannelId, resolution.targetId, { throwOnDbFailure: true });
            this.logAction(game, `Vote du village: ${votedPlayer.username} elimine`);
            await this.announceDeathReveal(mainChannel, votedPlayer, 'village');

            for (const dead of collateral) {
              await this.sendLogged(mainChannel, t('game.lover_death', { name: dead.username }), { type: 'loverDeath' });
              this.logAction(game, `Mort d'amour: ${dead.username}`);
              await this.announceDeathReveal(mainChannel, dead, 'love');
            }

            // Check Hunter
            if (votedPlayer.role === ROLES.HUNTER && !game.villageRolesPowerless) {
              game._hunterMustShoot = votedPlayer.id;
              await this.sendLogged(mainChannel, t('game.hunter_death', { name: votedPlayer.username }), { type: 'hunterDeath' });
              this.startHunterTimeout(guild, game, votedPlayer.id);
            }
          }
        }
      }
      // action === 'no_vote' or 'already_resolved' → no elimination

      // Emit voteCompleted so GUI panels refresh after village vote resolution
      this._emitGameEvent(game, 'voteCompleted', { resolution });

      // Apply dead player lockouts
      await this.applyDeadPlayerLockouts(guild);

      // Check victory after day eliminations
      const victoryCheck = this.checkWinner(game);
      if (victoryCheck) {
        await this.announceVictoryIfAny(guild, game);
        return;
      }

      // --- No-kill cycle detection (anti-AFK convergence) ---
      const aliveNow = game.players.filter(p => p.alive).length;
      if (game._aliveAtNightStart !== undefined && aliveNow === game._aliveAtNightStart) {
        game._noKillCycles = (game._noKillCycles || 0) + 1;
        this.logAction(game, `Cycle sans élimination (${game._noKillCycles}/${TIMEOUTS.MAX_NO_KILL_CYCLES})`);
      } else {
        game._noKillCycles = 0;
      }
      game._aliveAtNightStart = aliveNow;

      if (game._noKillCycles >= TIMEOUTS.MAX_NO_KILL_CYCLES) {
        await this.endGameByInactivity(guild, game, mainChannel);
        return;
      }

      // Transition to night
      game._captainTiebreak = null;
      game.littleGirlListenedThisNight = false;
      const newPhase = await this.nextPhase(guild, game, { skipAtomic: true });
      if (newPhase !== PHASES.NIGHT) return;

      if (game.voiceChannelId) {
        this.playAmbience(game.voiceChannelId, 'night_ambience.mp3');
      }

      shouldAutoSkip = this._shouldAutoSkipSubPhase(game);
      if (!shouldAutoSkip) {
        this.startNightAfkTimeout(guild, game);
      }

      this.syncGameToDb(game.mainChannelId, { throwOnError: true });

    } catch (error) {
      this._restoreStateSnapshot(game, snapshot);
      throw error;
    } finally {
      release();
    }

    // Auto-skip after mutex is released (avoids deadlock with advanceSubPhase→runAtomic)
    if (shouldAutoSkip) {
      logger.info('NIGHT_SUBPHASE_AUTO_SKIP', { subPhase: game.subPhase, channelId: game.mainChannelId });
      await this.advanceSubPhase(guild, game);
    }
  }

  /**
   * Force-end a game as a draw due to consecutive no-kill cycles (100% AFK convergence).
   * Called while holding the gameMutex from transitionToNight (phase is still DAY).
   */
  async endGameByInactivity(guild, game, mainChannel) {
    if (game.phase === PHASES.ENDED) return;
    const snapshot = this._createStateSnapshot(game);
    const victorDisplay = t('game.victory_draw_display') || 'draw';

    this._setPhase(game, PHASES.ENDED, { allowOutsideAtomic: true });
    game.endedAt = Date.now();
    this.clearGameTimers(game);
    this.logAction(game, `Partie terminée: match nul par inactivité (${game._noKillCycles} cycles sans élimination)`);

    try { this.db.saveGameHistory(game, 'draw'); } catch (e) { /* ignore */ }

    await this.updateVoicePerms(guild, game);

    if (game.voiceChannelId) {
      this.playAmbience(game.voiceChannelId, 'victory_villagers.mp3');
    }

    await this.sendLogged(mainChannel, t('game.draw_by_inactivity'), { type: 'drawByInactivity' });

    try {
      const MetricsCollector = require('../monitoring/metrics');
      const metrics = MetricsCollector.getInstance();
      metrics.recordGameCompleted();
    } catch {}

    // Stats: nobody wins in inactivity draw
    try {
      for (const p of game.players) {
        this.db.updatePlayerStats(p.id, p.username, {
          games_played: 1,
          games_won: 0,
          times_killed: p.alive ? 0 : 1,
          times_survived: p.alive ? 1 : 0,
          favorite_role: p.role || null
        }, game.guildId);
      }
    } catch (e) {
      this.logAction(game, `Erreur stats joueurs: ${e.message}`);
    }

    await this.sendGameSummary(guild, game, victorDisplay, mainChannel);

    this._emitGameEvent(game, 'gameEnded', {
      victor: 'draw',
      victorDisplay,
      players: game.players.map(p => ({ id: p.id, username: p.username, role: p.role, alive: p.alive })),
      dayCount: game.dayCount,
      duration: game.endedAt - game.startedAt
    });

    try {
      this.syncGameToDb(game.mainChannelId, { throwOnError: true });
    } catch (error) {
      this._restoreStateSnapshot(game, snapshot);
      throw error;
    }
  }

  async announceVictoryIfAny(guild, game) {
    if (game.phase === PHASES.ENDED) return;
    const victor = this.checkWinner(game);
    if (victor === null) return;
    const snapshot = this._createStateSnapshot(game);

    // Traduire le résultat pour l'affichage
    const victorDisplay = t(`game.victory_${victor}_display`) || victor;

    this._setPhase(game, PHASES.ENDED, { allowOutsideAtomic: true });
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
        logger.error('ACHIEVEMENT_ELO_PROCESSING_ERROR', { error: e.message });
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

    try {
      this.syncGameToDb(game.mainChannelId, { throwOnError: true });
    } catch (error) {
      this._restoreStateSnapshot(game, snapshot);
      throw error;
    }
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
      logger.error('GAME_SUMMARY_SEND_FAILED', err);
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
    const victory = this.checkWinner(game);
    if (victory) {
      await this.announceVictoryIfAny(guild, game);
      return;
    }

    const useReal = game.skipFakePhases !== false; // default true: skip fake player phases
    const hasRole = (g, r) => useReal ? this.hasAliveRealRole(g, r) : this.hasAliveAnyRole(g, r);

    const outcome = await this.runAtomic(game.mainChannelId, (state) => {
      const result = { announce: null, notifyRole: null, timer: null, notifyWitchVictim: false };
      switch (state.subPhase) {
        case PHASES.VOLEUR:
          if (hasRole(state, ROLES.CUPID) && (!state.lovers || state.lovers.length === 0)) {
            this._setSubPhase(state, PHASES.CUPIDON);
            result.announce = t('phase.cupid_wakes');
            result.notifyRole = ROLES.CUPID;
          } else if (hasRole(state, ROLES.SALVATEUR) && !state.villageRolesPowerless) {
            this._setSubPhase(state, PHASES.SALVATEUR);
            result.announce = t('phase.salvateur_wakes');
            result.notifyRole = ROLES.SALVATEUR;
          } else {
            this._setSubPhase(state, PHASES.LOUPS);
            result.announce = t('phase.wolves_wake');
            result.notifyRole = ROLES.WEREWOLF;
          }
          break;
        case PHASES.CUPIDON:
          if (hasRole(state, ROLES.SALVATEUR) && !state.villageRolesPowerless) {
            this._setSubPhase(state, PHASES.SALVATEUR);
            result.announce = t('phase.salvateur_wakes');
            result.notifyRole = ROLES.SALVATEUR;
          } else {
            this._setSubPhase(state, PHASES.LOUPS);
            result.announce = t('phase.wolves_wake');
            result.notifyRole = ROLES.WEREWOLF;
          }
          break;
        case PHASES.SALVATEUR:
          this._setSubPhase(state, PHASES.LOUPS);
          result.announce = t('phase.wolves_wake');
          result.notifyRole = ROLES.WEREWOLF;
          break;
        case PHASES.LOUPS: {
          const isOddNight = (state.dayCount || 0) % 2 === 1;
          if (isOddNight && hasRole(state, ROLES.WHITE_WOLF)) {
            this._setSubPhase(state, PHASES.LOUP_BLANC);
            result.announce = t('phase.white_wolf_wakes');
            result.notifyRole = ROLES.WHITE_WOLF;
          } else if (hasRole(state, ROLES.WITCH) && !state.villageRolesPowerless) {
            this._setSubPhase(state, PHASES.SORCIERE);
            result.announce = t('phase.witch_wakes');
            result.notifyRole = ROLES.WITCH;
            result.notifyWitchVictim = true;
          } else if (hasRole(state, ROLES.SEER) && !state.villageRolesPowerless) {
            this._setSubPhase(state, PHASES.VOYANTE);
            result.announce = t('phase.seer_wakes');
            result.notifyRole = ROLES.SEER;
          } else {
            this._setSubPhase(state, PHASES.REVEIL);
            result.announce = t('phase.village_wakes');
          }
          break;
        }
        case PHASES.LOUP_BLANC:
          if (hasRole(state, ROLES.WITCH) && !state.villageRolesPowerless) {
            this._setSubPhase(state, PHASES.SORCIERE);
            result.announce = t('phase.witch_wakes');
            result.notifyRole = ROLES.WITCH;
            result.notifyWitchVictim = true;
          } else if (hasRole(state, ROLES.SEER) && !state.villageRolesPowerless) {
            this._setSubPhase(state, PHASES.VOYANTE);
            result.announce = t('phase.seer_wakes');
            result.notifyRole = ROLES.SEER;
          } else {
            this._setSubPhase(state, PHASES.REVEIL);
            result.announce = t('phase.village_wakes');
          }
          break;
        case PHASES.SORCIERE:
          if (hasRole(state, ROLES.SEER) && !state.villageRolesPowerless) {
            this._setSubPhase(state, PHASES.VOYANTE);
            result.announce = t('phase.seer_wakes');
            result.notifyRole = ROLES.SEER;
          } else {
            this._setSubPhase(state, PHASES.REVEIL);
            result.announce = t('phase.village_wakes');
          }
          break;
        case PHASES.VOYANTE:
          this._setSubPhase(state, PHASES.REVEIL);
          result.announce = t('phase.village_wakes');
          break;
        case PHASES.REVEIL: {
          const isFirstDay = (state.dayCount || 0) === 1;
          const captain = state.captainId ? state.players.find(p => p.id === state.captainId) : null;
          const captainDead = !captain || !captain.alive;
          if ((isFirstDay && !state.captainId) || captainDead) {
            state.captainId = null;
            this._setSubPhase(state, PHASES.VOTE_CAPITAINE, { allowOutsideAtomic: true });
            result.announce = t('phase.captain_vote_announce');
            result.timer = 'captain';
          } else {
            state.villageVoteState = require('./villageVoteEngine').createVillageVoteState();
            state.dayVoteStartedAt = Date.now();
            this._setSubPhase(state, PHASES.VOTE, { allowOutsideAtomic: true });
            result.announce = t('phase.vote_announce');
            result.timer = 'day_vote';
          }
          break;
        }
        case PHASES.VOTE_CAPITAINE:
          state.villageVoteState = require('./villageVoteEngine').createVillageVoteState();
          state.dayVoteStartedAt = Date.now();
          this._setSubPhase(state, PHASES.VOTE);
          result.announce = t('phase.vote_announce');
          result.timer = 'day_vote';
          break;
        case PHASES.VOTE:
        default:
          // Dead branch safety: advanceSubPhase is never called from VOTE;
          // transitionToNight handles DAY→NIGHT via its own path.
          // Guard: log and no-op to prevent an incoherent state (phase=DAY, subPhase=LOUPS).
          logger.warn('ADVANCE_SUBPHASE_UNEXPECTED_NOOP', {
            phase: state.phase, subPhase: state.subPhase, channelId: state.mainChannelId
          });
          break;
      }
      return result;
    });

    // Witch victim notification is now displayed in the witch role panel (auto-refreshed)
    if (outcome.announce) await this.announcePhase(guild, game, outcome.announce);
    if (outcome.notifyRole) this.notifyTurn(guild, game, outcome.notifyRole);
    if (outcome.timer === 'captain') {
      this.startCaptainVoteTimeout(guild, game);
    } else if (outcome.timer === 'day_vote') {
      this.startDayTimeout(guild, game);
    }

    // Centralized night phase chaining:
    // If we reached REVEIL during night → transition to day
    // If we landed on a night action subphase → auto-skip if fake, or start AFK timeout
    if (game.phase === PHASES.NIGHT && game.subPhase === PHASES.REVEIL) {
      await this.transitionToDay(guild, game);
    } else if (game.phase === PHASES.NIGHT && [PHASES.VOLEUR, PHASES.CUPIDON, PHASES.LOUPS, PHASES.LOUP_BLANC, PHASES.SORCIERE, PHASES.VOYANTE, PHASES.SALVATEUR].includes(game.subPhase)) {
      if (this._shouldAutoSkipSubPhase(game)) {
        // Role only held by fake players → auto-advance
        logger.info('SUBPHASE_AUTO_SKIP', { subPhase: game.subPhase, channelId: game.mainChannelId });
        await this.advanceSubPhase(guild, game);
      } else {
        this.startNightAfkTimeout(guild, game);
      }
    }

    this.scheduleSave();
  }

  // Annonce la sous-phase dans le channel village
  // ALL sub-phase micro-states are now suppressed:
  // the village master panel displays the current phase/sub-phase in real-time
  // with a dynamic focus section ("📣 En cours").
  async announcePhase(guild, game, message) {
    // Suppress all sub-phase announcements — replaced by village master GUI panel
    return;
  }

  // --- Night AFK timeout ---
  // Auto-avance la sous-phase si le rôle ne joue pas dans le délai imparti (90s)
  startNightAfkTimeout(guild, game) {
    const ctx = this._atomicContexts.get(game.mainChannelId);
    if (ctx && ctx.active) {
      this._queuePostCommit(game.mainChannelId, () => this.startNightAfkTimeout(guild, game));
      return;
    }
    this.clearNightAfkTimeout(game);
    const NIGHT_AFK_DELAY = TIMEOUTS.NIGHT_AFK;
    this._scheduleGameTimer(game, `night-afk:${game.subPhase}`, NIGHT_AFK_DELAY, async () => {
      try {
        if (game.phase !== PHASES.NIGHT) return;
        const mainChannel = game.villageChannelId
          ? await guild.channels.fetch(game.villageChannelId)
          : await guild.channels.fetch(game.mainChannelId);

        const currentSub = game.subPhase;
        if (currentSub === PHASES.LOUPS) {
          await this.runAtomic(game.mainChannelId, (state) => {
            if (state.phase !== PHASES.NIGHT || state.subPhase !== PHASES.LOUPS) return;
            const { resolveOnTimeout, getAliveWolves } = require('./wolfVoteEngine');
            const outcome = resolveOnTimeout(state.wolvesVoteState);
            if (outcome.action === 'already_resolved') return;
            if (outcome.action === 'kill') {
              state.nightVictim = outcome.targetId;
              const victim = state.players.find(p => p.id === outcome.targetId);
              this.logAction(state, `AFK timeout loups: pluralité → ${victim ? victim.username : outcome.targetId}`);
              this.db.addNightAction(state.mainChannelId, state.dayCount || 0, 'kill', 'wolves-timeout', outcome.targetId);
            } else {
              this.logAction(state, 'AFK timeout loups: aucun consensus → personne ne meurt');
            }
            this.db.clearVotes(game.mainChannelId, 'wolves', state.dayCount || 0);
          });
          this.logAction(game, 'AFK timeout: loups');
        } else if (currentSub === PHASES.SORCIERE) {
          // Suppressed: visible via /status panel
          this.logAction(game, 'AFK timeout: sorcière');
        } else if (currentSub === PHASES.VOYANTE) {
          this.logAction(game, 'AFK timeout: voyante');
        } else if (currentSub === PHASES.SALVATEUR) {
          this.logAction(game, 'AFK timeout: salvateur');
        } else if (currentSub === PHASES.LOUP_BLANC) {
          this.logAction(game, 'AFK timeout: loup blanc');
        } else if (currentSub === PHASES.CUPIDON) {
          this.logAction(game, 'AFK timeout: cupidon');
        } else if (currentSub === PHASES.VOLEUR) {
          this.logAction(game, 'AFK timeout: voleur');
        } else {
          return; // Pas de timeout pour les autres sous-phases
        }

        await this.advanceSubPhase(guild, game);
        // REVEIL→Day chain + AFK restart are now handled inside advanceSubPhase
      } catch (e) {
        logger.error('NIGHT_AFK_TIMEOUT_ERROR', { error: e.message, stack: e.stack });
      }
    });
  }

  clearNightAfkTimeout(game) {
    if (game._nightAfkTimer) {
      clearTimeout(game._nightAfkTimer);
      game._nightAfkTimer = null;
    }
    const active = this.activeGameTimers.get(game.mainChannelId);
    if (active && active.type.startsWith('night-afk:')) {
      this._deactivateTimer(game.mainChannelId, active.type, active.epoch);
    }
  }

  // --- Hunter timeout ---
  // Le chasseur a 60s pour tirer sinon il perd son tir
  startHunterTimeout(guild, game, hunterId) {
    const ctx = this._atomicContexts.get(game.mainChannelId);
    if (ctx && ctx.active) {
      this._queuePostCommit(game.mainChannelId, () => this.startHunterTimeout(guild, game, hunterId));
      return;
    }
    if (game._hunterTimer) clearTimeout(game._hunterTimer);
    const HUNTER_DELAY = TIMEOUTS.HUNTER_SHOOT;
    this._scheduleGameTimer(game, `hunter-shoot:${hunterId}`, HUNTER_DELAY, async () => {
      try {
        if (game._hunterMustShoot !== hunterId) return;
        await this.runAtomic(game.mainChannelId, (state) => {
          if (state._hunterMustShoot !== hunterId) return;
          state._hunterMustShoot = null;
        });
        const mainChannel = game.villageChannelId
          ? await guild.channels.fetch(game.villageChannelId)
          : await guild.channels.fetch(game.mainChannelId);
        await this.sendLogged(mainChannel, t('game.hunter_timeout'), { type: 'hunterTimeout' });
        this.logAction(game, 'AFK timeout: chasseur');
        await this.announceVictoryIfAny(guild, game);
        // If still in DAY after hunter AFK (e.g. hunter killed during vote/tiebreak),
        // chain to night to prevent deadlock
        if (game.phase === PHASES.DAY && !this.checkWinner(game)) {
          await this.transitionToNight(guild, game);
        }
      } catch (e) {
        logger.error('HUNTER_TIMEOUT_ERROR', { error: e.message });
      }
    });
  }

  // --- Day timeout ---
  // Auto-ends vote if players are AFK during the day
  startDayTimeout(guild, game) {
    const ctx = this._atomicContexts.get(game.mainChannelId);
    if (ctx && ctx.active) {
      this._queuePostCommit(game.mainChannelId, () => this.startDayTimeout(guild, game));
      return;
    }
    this.clearDayTimeout(game);
    const delay = TIMEOUTS.DAY_VOTE;

    this._scheduleGameTimer(game, 'day-vote', delay, async () => {
      try {
        if (game.phase !== PHASES.DAY) return;
        // End of vote → transition to night (even with 0 votes)
        this.logAction(game, 'Timeout: fin du vote');
        logger.info('DAY_VOTE_RESOLVED', { channelId: game.mainChannelId, reason: 'timeout', durationMs: Date.now() - (game.dayVoteStartedAt || 0) });
        await this.transitionToNight(guild, game);
      } catch (e) {
        logger.error('DAY_TIMEOUT_ERROR', { error: e.message });
      }
    });
  }

  clearDayTimeout(game) {
    if (game._dayTimer) {
      clearTimeout(game._dayTimer);
      game._dayTimer = null;
    }
    const active = this.activeGameTimers.get(game.mainChannelId);
    if (active && active.type.startsWith('day-')) {
      this._deactivateTimer(game.mainChannelId, active.type, active.epoch);
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

  /**
   * Toggle the balance mode between DYNAMIC and CLASSIC.
   * Hardened: 500ms debounce, atomic with rollback, structured logging.
   *
   * @param {string} channelId - Game channel ID
   * @param {string} userId    - ID of the user attempting the toggle
   * @returns {{ success: boolean, newMode?: string, previousMode?: string, error?: string }}
   */
  toggleBalanceMode(channelId, userId) {
    const game = this.games.get(channelId);
    if (!game) return { success: false, error: 'NO_GAME' };

    // Only host can toggle
    if (game.lobbyHostId !== userId) return { success: false, error: 'NOT_HOST' };

    // Cannot change once started
    if (game.startedAt) return { success: false, error: 'ALREADY_STARTED' };

    // Debounce: reject if toggled within BALANCE_TOGGLE_DEBOUNCE ms
    const now = Date.now();
    const lastToggle = this._balanceToggleLocks.get(channelId);
    if (lastToggle && (now - lastToggle) < TIMEOUTS.BALANCE_TOGGLE_DEBOUNCE) {
      logger.warn('BALANCE_TOGGLE_DEBOUNCED', {
        channelId,
        userId,
        elapsedMs: now - lastToggle
      });
      return { success: false, error: 'RATE_LIMITED' };
    }
    this._balanceToggleLocks.set(channelId, now);

    const previousMode = game.balanceMode || BalanceMode.DYNAMIC;
    const newMode = previousMode === BalanceMode.DYNAMIC
      ? BalanceMode.CLASSIC
      : BalanceMode.DYNAMIC;

    // Atomic update with rollback on DB failure
    game.balanceMode = newMode;
    try {
      this.db.updateGame(channelId, { balanceMode: newMode });
    } catch (err) {
      // Rollback in-memory state
      game.balanceMode = previousMode;
      this._balanceToggleLocks.delete(channelId);
      logger.error('BALANCE_MODE_DB_FAILED', {
        channelId,
        userId,
        previousMode,
        newMode,
        error: err.message
      });
      return { success: false, error: 'DB_ERROR' };
    }

    this.markDirty(channelId);

    logger.info('BALANCE_MODE_CHANGED', {
      channelId,
      previousMode,
      newMode,
      hostId: userId
    });

    this._emitGameEvent(game, 'balanceModeChanged', { balanceMode: newMode, previousMode, changedBy: userId });

    return { success: true, newMode, previousMode };
  }

  start(channelId, rolesOverride = null) {
    const game = this.games.get(channelId);
    const minRequired = (game && game.rules && game.rules.minPlayers) || 5;
    if (!game || game.players.length < minRequired) return null;

    // Empêcher le double-start
    if (game.startedAt) {
      logger.warn('GAME_DUPLICATE_START_IGNORED', { channelId });
      return null;
    }

    // If rolesOverride provided, use it; otherwise generate via balance mode
    let rolesPool = [];
    if (Array.isArray(rolesOverride) && rolesOverride.length > 0) {
      rolesPool = [...rolesOverride];
    } else {
      rolesPool = generateRoles(game.players.length, game.balanceMode, { rotationSeed: game.id || 0 });
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
    game._aliveAtNightStart = game.players.filter(p => p.alive).length;
    game._noKillCycles = 0;

    // Clear lobby timeout — game is now active
    this.clearLobbyTimeout(channelId);
    
    // Déterminer la première sous-phase nocturne
    // Ordre: VOLEUR → CUPIDON → SALVATEUR → LOUPS
    const hasThief = game.players.some(p => p.role === ROLES.THIEF && p.alive);
    let initialSubPhase = PHASES.LOUPS;
    if (hasThief && game.thiefExtraRoles.length === 2) {
      initialSubPhase = PHASES.VOLEUR;
    } else {
      const hasCupid = game.players.some(p => p.role === ROLES.CUPID && p.alive);
      if (hasCupid) {
        initialSubPhase = PHASES.CUPIDON;
      } else {
        const hasSalvateur = game.players.some(p => p.role === ROLES.SALVATEUR && p.alive);
        if (hasSalvateur) {
          initialSubPhase = PHASES.SALVATEUR;
        }
      }
    }
    this._setSubPhase(game, initialSubPhase, { allowOutsideAtomic: true, skipValidation: true });
    this.db.updateGame(channelId, { subPhase: initialSubPhase });
    this.markDirty(channelId);

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
    // CRITICAL: Set the posting guard IMMEDIATELY (before any await) to prevent
    // the gameStarted event's setImmediate(_refreshAllGui) from re-posting panels
    // while we're still setting up. The gameStarted event was emitted synchronously
    // in start(), and its setImmediate fires as soon as we yield with our first await.
    this._guiPostingInProgress.add(game.mainChannelId);

    const flowTimer = logger.startTimer('postStartGame');
    logger.info('POST_START_GAME_BEGIN', {
      channelId: game.mainChannelId,
      guildId: game.guildId,
      playerCount: game.players.length,
      subPhase: game.subPhase,
      roleChannels: {
        village: !!game.villageChannelId,
        wolves: !!game.wolvesChannelId,
        seer: !!game.seerChannelId,
        witch: !!game.witchChannelId,
        cupid: !!game.cupidChannelId,
        salvateur: !!game.salvateurChannelId,
        whiteWolf: !!game.whiteWolfChannelId,
        thief: !!game.thiefChannelId,
      },
    });

    const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
    const pathMod = require('path');
    const { getRoleDescription, getRoleImageName } = require('../utils/roleHelpers');
    const { mapConcurrent } = require('../utils/concurrency');

    const updateProgress = async (msg) => {
      if (!interaction) return;
      try { await interaction.editReply({ content: msg }); } catch {}
    };

    // ─── Step 0: Prune unused role channels (must complete before permissions) ──
    try {
      await updateProgress(t('progress.pruning_channels', {}, game.guildId));
      const pruneResult = await this.pruneUnusedRoleChannels(guild, game);
      logger.info('POST_START_PRUNE_DONE', {
        channelId: game.mainChannelId,
        pruned: pruneResult.pruned.length,
        kept: pruneResult.kept.length,
        failed: pruneResult.failed.length,
      });
    } catch (err) {
      // Non-fatal: if pruning fails, the game still works (extra channels remain)
      logger.error('POST_START_PRUNE_FAILED', { channelId: game.mainChannelId, error: err.message });
    }

    // ─── Step 1+2: Permissions + Voice in parallel ──────────────────
    // These are independent: channel permissions and voice muting hit different endpoints.
    await updateProgress(t('progress.permissions'));
    const [setupSuccess] = await Promise.all([
      this.updateChannelPermissions(guild, game),
      (async () => {
        await updateProgress(t('progress.voice'));
        await this.updateVoicePerms(guild, game);
      })(),
    ]);
    if (!setupSuccess) {
      this._guiPostingInProgress.delete(game.mainChannelId);
      flowTimer.end('POST_START_GAME_ABORT', { reason: 'permissions_failed' });
      return false;
    }

    // ─── Step 3: Post ALL GUI panels in parallel (role + village + spectator) ─
    // GUIs are the user-visible deliverable — sent IMMEDIATELY after permissions
    // settle, BEFORE the slow DM fan-out. This eliminates the perceived delay.
    await updateProgress(t('progress.channels'));
    const guiTimer = logger.startTimer('postGuiPanels');
    await Promise.all([
      (async () => {
        try {
          await this._postRolePanels(guild, game);
        } catch (e) { logger.warn('ROLE_PANELS_POST_FAILED_INIT', { error: e.message }); }
      })(),
      this._postVillageMasterPanel(guild, game),
      this._postSpectatorPanel(guild, game),
    ]);
    guiTimer.end('GUI_PANELS_ALL_POSTED');

    // 3b. Scheduled recovery: if role panels failed, retry once after a short delay
    if (!this.rolePanels.has(game.mainChannelId)) {
      logger.warn('ROLE_PANELS_DEFERRED_RETRY_SCHEDULED', {
        channelId: game.mainChannelId,
      });
      setTimeout(async () => {
        try {
          if (!this.rolePanels.has(game.mainChannelId) && this.games.has(game.mainChannelId)) {
            logger.info('ROLE_PANELS_DEFERRED_RECOVERY', { channelId: game.mainChannelId });
            await this._postRolePanels(guild, game);
          }
        } catch (e) {
          logger.warn('ROLE_PANELS_DEFERRED_RECOVERY_FAILED', { error: e.message });
        }
      }, 3000);
    }

    // Release the posting guard — panels exist, refreshes can now proceed
    this._guiPostingInProgress.delete(game.mainChannelId);

    // ─── Step 4: Send role DMs concurrently (concurrency = 3) ──────
    // DMs go to a different rate-limit bucket (user DMs) so we can safely
    // overlap with the just-posted GUI panels settling.
    await updateProgress(t('progress.dm'));
    const dmTimer = logger.startTimer('sendRoleDMs');
    const dmPlayers = game.players.filter(p => typeof p.id === 'string' && /^\d+$/.test(p.id));
    await mapConcurrent(dmPlayers, async (player) => {
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
          embed.setThumbnail(`attachment://${imageName}`);
        }

        logger.info('ROLE_DM_SENT', { userId: user.id, username: user.username, content: '[role embed]' });
        await user.send({ embeds: [embed], files });
      } catch (err) {
        logger.warn('ROLE_DM_SEND_FAILED', { error: err.message });
      }
    }, 3);
    dmTimer.end('ROLE_DMS_DONE', { count: dmPlayers.length });

    // ─── Step 5: Done — start AFK timeout ───────────────────────────
    await updateProgress(t('progress.done'));

    // 6. Lancer le timeout AFK si on est en sous-phase qui attend une action
    if ([PHASES.VOLEUR, PHASES.CUPIDON, PHASES.LOUPS, PHASES.SALVATEUR].includes(game.subPhase)) {
      if (this._shouldAutoSkipSubPhase(game)) {
        logger.info('INITIAL_SUBPHASE_AUTO_SKIP', { subPhase: game.subPhase, channelId: game.mainChannelId });
        await this.advanceSubPhase(guild, game);
      } else {
        this.startNightAfkTimeout(guild, game);
      }
    }

    flowTimer.end('POST_START_GAME_DONE', { playerCount: game.players.length });
    return true;
  }

  async createInitialChannels(guild, mainChannelId, game, categoryId = null) {
    const timer = logger.startTimer('createInitialChannels');
    try {
      // DEFENSIVE: categoryId is required — refuse to create channels without it
      if (!categoryId) {
        logger.error('CHANNELS_NO_CATEGORY_ID', { mainChannelId });
        throw new Error('Guild not configured: missing category_id');
      }

      // Validate category exists before using it
      try {
        const cat = await guild.channels.fetch(categoryId);
        if (!cat || cat.type !== 4) {
          logger.error('CATEGORY_INVALID', { categoryId });
          throw new Error('Guild not configured: category_id is invalid');
        }
      } catch (err) {
        if (err.message.startsWith('Guild not configured')) throw err;
        logger.error('CATEGORY_NOT_FOUND', { categoryId });
        throw new Error('Guild not configured: category not found');
      }

      logger.info('CHANNELS_CREATING', { mainChannelId, categoryId });

      // Bot permission overwrite — ensures the bot retains ViewChannel + ManageChannels
      // on hidden channels so that cleanup/deletion always works.
      const botId = guild.members.me?.id || guild.client.user.id;
      const hiddenPerms = [
        { id: guild.id, deny: ["ViewChannel"] },
        { id: botId, allow: ["ViewChannel", "ManageChannels", "SendMessages"] }
      ];
      
      // Créer le channel village (visible de tous) pour les messages système
      logger.debug('CHANNEL_CREATING_VILLAGE');
      const villageChannel = await guild.channels.create({
        name: t('channel.village'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined
      });
      game.villageChannelId = villageChannel.id;
      logger.info('CHANNEL_CREATED_VILLAGE', { id: villageChannel.id });

      // Créer le channel des loups (accessible à tous pour l'instant)
      logger.debug('CHANNEL_CREATING_WOLVES');
      const wolvesChannel = await guild.channels.create({
        name: t('channel.wolves'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: hiddenPerms
      });
      game.wolvesChannelId = wolvesChannel.id;
      logger.info('CHANNEL_CREATED_WOLVES', { id: wolvesChannel.id });

      // Créer le channel de la voyante
      logger.debug('CHANNEL_CREATING_SEER');
      const seerChannel = await guild.channels.create({
        name: t('channel.seer'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: hiddenPerms
      });
      game.seerChannelId = seerChannel.id;
      logger.info('CHANNEL_CREATED_SEER', { id: seerChannel.id });

      // Créer le channel de la sorcière
      logger.debug('CHANNEL_CREATING_WITCH');
      const witchChannel = await guild.channels.create({
        name: t('channel.witch'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: hiddenPerms
      });
      game.witchChannelId = witchChannel.id;
      logger.info('CHANNEL_CREATED_WITCH', { id: witchChannel.id });

      // Créer le channel de Cupidon
      logger.debug('CHANNEL_CREATING_CUPID');
      const cupidChannel = await guild.channels.create({
        name: t('channel.cupid'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: hiddenPerms
      });
      game.cupidChannelId = cupidChannel.id;
      logger.info('CHANNEL_CREATED_CUPID', { id: cupidChannel.id });

      // Créer le channel du Salvateur
      logger.debug('CHANNEL_CREATING_SALVATEUR');
      const salvateurChannel = await guild.channels.create({
        name: t('channel.salvateur'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: hiddenPerms
      });
      game.salvateurChannelId = salvateurChannel.id;
      logger.info('CHANNEL_CREATED_SALVATEUR', { id: salvateurChannel.id });

      // Créer le channel du Loup Blanc
      logger.debug('CHANNEL_CREATING_WHITE_WOLF');
      const whiteWolfChannel = await guild.channels.create({
        name: t('channel.white_wolf'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: hiddenPerms
      });
      game.whiteWolfChannelId = whiteWolfChannel.id;
      logger.info('CHANNEL_CREATED_WHITE_WOLF', { id: whiteWolfChannel.id });

      // Créer le channel du Voleur
      logger.debug('CHANNEL_CREATING_THIEF');
      const thiefChannel = await guild.channels.create({
        name: t('channel.thief'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: hiddenPerms
      });
      game.thiefChannelId = thiefChannel.id;
      logger.info('CHANNEL_CREATED_THIEF', { id: thiefChannel.id });

      // Créer le channel spectateurs (pour les morts)
      logger.debug('CHANNEL_CREATING_SPECTATOR');
      const spectatorChannel = await guild.channels.create({
        name: t('channel.spectator'),
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        permissionOverwrites: hiddenPerms
      });
      game.spectatorChannelId = spectatorChannel.id;
      logger.info('CHANNEL_CREATED_SPECTATOR', { id: spectatorChannel.id });

      // Créer le channel vocal
      logger.debug('CHANNEL_CREATING_VOICE');
      const voiceChannel = await guild.channels.create({
        name: t('channel.voice'),
        type: 2, // GUILD_VOICE
        parent: categoryId || undefined
      });
      game.voiceChannelId = voiceChannel.id;
      logger.info('CHANNEL_CREATED_VOICE', { id: voiceChannel.id });

      // Synchroniser les IDs de channels avec la DB
      this.db.updateGame(mainChannelId, {
        villageChannelId: game.villageChannelId,
        wolvesChannelId: game.wolvesChannelId,
        seerChannelId: game.seerChannelId,
        witchChannelId: game.witchChannelId,
        cupidChannelId: game.cupidChannelId,
        salvateurChannelId: game.salvateurChannelId,
        whiteWolfChannelId: game.whiteWolfChannelId,
        thiefChannelId: game.thiefChannelId,
        spectatorChannelId: game.spectatorChannelId,
        voiceChannelId: game.voiceChannelId
      });

      // Register all channels in game_channels table for safe DB-based deletion
      const channelRegistrations = [
        { chType: 'village', id: villageChannel.id },
        { chType: 'wolves', id: wolvesChannel.id },
        { chType: 'seer', id: seerChannel.id },
        { chType: 'witch', id: witchChannel.id },
        { chType: 'cupid', id: cupidChannel.id },
        { chType: 'salvateur', id: salvateurChannel.id },
        { chType: 'whiteWolf', id: whiteWolfChannel.id },
        { chType: 'thief', id: thiefChannel.id },
        { chType: 'spectator', id: spectatorChannel.id },
        { chType: 'voice', id: voiceChannel.id }
      ];
      for (const ch of channelRegistrations) {
        this.db.registerGameChannel(mainChannelId, game.guildId, ch.chType, ch.id);
      }
      logger.info('CHANNELS_REGISTERED_IN_DB', { count: channelRegistrations.length, mainChannelId });

      timer.end();
      logger.info('CHANNELS_ALL_CREATED', { 
        channelCount: 10,
        mainChannelId 
      });
      return true;
    } catch (error) {
      logger.error('CHANNELS_CREATION_FAILED', error);
      return false;
    }
  }

  async updateChannelPermissions(guild, game) {
    const timer = logger.startTimer('updateChannelPermissions');
    const { mapConcurrent } = require('../utils/concurrency');
    try {
      logger.info('PERMISSIONS_UPDATING');
      const { PermissionsBitField } = require('discord.js');

      // Bot overwrite — always included so the bot retains access to hidden channels
      const botId = guild.members.me?.id || guild.client.user.id;
      const botOverwrite = {
        id: botId,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.SendMessages]
      };
      const denyAll = { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] };
      const viewSend = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages];

      // ── Phase 1: Batch-fetch all unique player members in ONE pass ──
      // Avoids N×M individual guild.members.fetch() calls (was per-player per-channel).
      const uniquePlayerIds = [...new Set(game.players.filter(p => p.alive && /^\d+$/.test(p.id)).map(p => p.id))];
      const validMembers = new Set();
      const memberTimer = logger.startTimer('batchMemberFetch');

      await mapConcurrent(uniquePlayerIds, async (playerId) => {
        try {
          await guild.members.fetch(playerId);
          validMembers.add(playerId);
        } catch (_) {
          logger.warn('PERMISSIONS_NON_MEMBER', { playerId });
        }
      }, 5);
      memberTimer.end('BATCH_MEMBER_FETCH_DONE', { total: uniquePlayerIds.length, valid: validMembers.size });

      // ── Phase 2: Build all permission configs synchronously (zero API calls) ──
      const channelConfigs = [];

      // Helper: add a player overwrite if they were validated in Phase 1
      const playerOverwrite = (playerId) =>
        validMembers.has(playerId) ? { id: playerId, allow: viewSend } : null;

      // Wolves channel (werewolves + white wolf)
      if (game.wolvesChannelId) {
        const overwrites = [denyAll, botOverwrite];
        for (const p of game.players.filter(p => (p.role === ROLES.WEREWOLF || p.role === ROLES.WHITE_WOLF) && p.alive)) {
          const ow = playerOverwrite(p.id);
          if (ow) overwrites.push(ow);
        }
        channelConfigs.push({ channelId: game.wolvesChannelId, overwrites, label: 'WOLVES' });
      }

      // White Wolf solo channel
      if (game.whiteWolfChannelId) {
        const overwrites = [denyAll, botOverwrite];
        const ww = game.players.find(p => p.role === ROLES.WHITE_WOLF && p.alive);
        if (ww) { const ow = playerOverwrite(ww.id); if (ow) overwrites.push(ow); }
        channelConfigs.push({ channelId: game.whiteWolfChannelId, overwrites, label: 'WHITE_WOLF' });
      }

      // Thief channel
      if (game.thiefChannelId) {
        const overwrites = [denyAll, botOverwrite];
        const thief = game.players.find(p => p.role === ROLES.THIEF && p.alive);
        if (thief) { const ow = playerOverwrite(thief.id); if (ow) overwrites.push(ow); }
        channelConfigs.push({ channelId: game.thiefChannelId, overwrites, label: 'THIEF' });
      }

      // Seer channel
      if (game.seerChannelId) {
        const overwrites = [denyAll, botOverwrite];
        const seer = game.players.find(p => p.role === ROLES.SEER && p.alive);
        if (seer) { const ow = playerOverwrite(seer.id); if (ow) overwrites.push(ow); }
        channelConfigs.push({ channelId: game.seerChannelId, overwrites, label: 'SEER' });
      }

      // Witch channel
      if (game.witchChannelId) {
        const overwrites = [denyAll, botOverwrite];
        const witch = game.players.find(p => p.role === ROLES.WITCH && p.alive);
        if (witch) { const ow = playerOverwrite(witch.id); if (ow) overwrites.push(ow); }
        channelConfigs.push({ channelId: game.witchChannelId, overwrites, label: 'WITCH' });
      }

      // Cupid channel
      if (game.cupidChannelId) {
        const overwrites = [denyAll, botOverwrite];
        const cupid = game.players.find(p => p.role === ROLES.CUPID && p.alive);
        if (cupid) { const ow = playerOverwrite(cupid.id); if (ow) overwrites.push(ow); }
        channelConfigs.push({ channelId: game.cupidChannelId, overwrites, label: 'CUPID' });
      }

      // Salvateur channel
      if (game.salvateurChannelId) {
        const overwrites = [denyAll, botOverwrite];
        const salv = game.players.find(p => p.role === ROLES.SALVATEUR && p.alive);
        if (salv) { const ow = playerOverwrite(salv.id); if (ow) overwrites.push(ow); }
        channelConfigs.push({ channelId: game.salvateurChannelId, overwrites, label: 'SALVATEUR' });
      }

      // ── Phase 3: Apply all permission sets in parallel (concurrency = 3) ──
      // Each item: fetch channel + set permissions = 2 API calls.
      // With concurrency 3, up to 3 channels updated simultaneously.
      const permTimer = logger.startTimer('applyPermissions');
      await mapConcurrent(channelConfigs, async ({ channelId, overwrites, label }) => {
        try {
          const channel = await guild.channels.fetch(channelId);
          await channel.permissionOverwrites.set(overwrites);
          logger.info(`PERMISSIONS_UPDATED_${label}`);
        } catch (e) {
          logger.warn(`PERMISSIONS_UPDATE_FAILED_${label}`, { error: e.message });
        }
      }, 3);
      permTimer.end('PERMISSIONS_APPLY_DONE', { channels: channelConfigs.length });

      timer.end();
      return true;
    } catch (error) {
      logger.error('PERMISSIONS_UPDATE_FAILED', error);
      return false;
    }
  }

  // ─── Role-to-channel mapping for pruning ──────────────────────────
  // Maps each ROLE constant to the game object field(s) for its dedicated channel.
  // Wolves channel is shared by WEREWOLF + WHITE_WOLF; WHITE_WOLF also has a solo channel.
  // Protected channels (village, spectator, voice) are NEVER in this map.
  static get ROLE_TO_CHANNEL_FIELDS() {
    return {
      [ROLES.WEREWOLF]:   ['wolvesChannelId'],
      [ROLES.WHITE_WOLF]: ['wolvesChannelId', 'whiteWolfChannelId'],
      [ROLES.SEER]:       ['seerChannelId'],
      [ROLES.WITCH]:      ['witchChannelId'],
      [ROLES.CUPID]:      ['cupidChannelId'],
      [ROLES.SALVATEUR]:  ['salvateurChannelId'],
      [ROLES.THIEF]:      ['thiefChannelId'],
    };
  }

  /**
   * Safely delete a single Discord channel with full error handling.
   * Handles: already deleted, missing permissions, wrong guild, voice unmuting.
   *
   * @param {Guild}  guild     - Discord guild
   * @param {string} channelId - Channel snowflake
   * @param {string} reason    - Audit log reason
   * @returns {boolean} true if deleted (or already gone), false on hard failure
   */
  async _safeDeleteChannel(guild, channelId, reason = 'Werewolf: unused role channel pruned') {
    try {
      const ch = await guild.channels.fetch(channelId, { force: true }).catch(() => null);
      if (!ch) {
        // Already deleted or not found — that's fine
        logger.debug('PRUNE_CHANNEL_ALREADY_GONE', { channelId });
        return true;
      }

      // Safety: wrong guild guard
      if (ch.guildId !== guild.id) {
        logger.warn('PRUNE_CHANNEL_WRONG_GUILD', { channelId, expected: guild.id, actual: ch.guildId });
        return false;
      }

      // Voice channel: unmute members before deleting
      if (ch.type === 2) {
        for (const member of ch.members.values()) {
          try { await member.voice.setMute(false); } catch (_) { /* ignore */ }
        }
      }

      // Ensure bot has perms to delete (best-effort re-grant)
      try {
        const botId = guild.members.me?.id || guild.client.user.id;
        await ch.permissionOverwrites.edit(botId, { ViewChannel: true, ManageChannels: true }).catch(() => {});
      } catch (_) { /* best-effort */ }

      await ch.delete({ reason });
      return true;
    } catch (err) {
      // 10003 = Unknown Channel (already deleted), 10008 = Unknown Message
      if (err.code === 10003 || err.code === 10008) return true;
      logger.error('PRUNE_CHANNEL_DELETE_FAILED', { channelId, error: err.message, code: err.code });
      return false;
    }
  }

  /**
   * Prune role channels that are not needed for the current game.
   *
   * Called ONCE at game start (inside postStartGame), after roles are distributed.
   * Compares the set of roles actually in play (players + thiefExtraRoles) against
   * all role channels created at /create, and safely deletes unused ones.
   *
   * PROTECTED (never pruned): village, spectator, voice, mainChannel.
   *
   * For each pruned channel:
   *   1. Discord channel deleted via _safeDeleteChannel
   *   2. game object field nulled
   *   3. game_channels DB row removed
   *   4. rolePanels entry cleaned (prevents stale message edits)
   *   5. DB game row updated (channel IDs synced)
   *
   * @param {Guild}  guild - Discord guild
   * @param {object} game  - In-memory game object (mutated in place)
   * @returns {{ pruned: string[], kept: string[], failed: string[] }}
   */
  async pruneUnusedRoleChannels(guild, game) {
    const timer = logger.startTimer('pruneUnusedRoleChannels');
    const result = { pruned: [], kept: [], failed: [] };

    // 1. Build the set of roles actually in play
    //    Includes: all player roles + thief extra cards (those roles MIGHT enter play)
    const activeRoles = new Set();
    for (const player of (game.players || [])) {
      if (player.role) activeRoles.add(player.role);
    }
    // Thief extra roles can be swapped in — their channels must stay
    for (const extraRole of (game.thiefExtraRoles || [])) {
      if (extraRole) activeRoles.add(extraRole);
    }

    // 2. Derive which channel fields are needed
    const neededFields = new Set();
    const roleToFields = GameManager.ROLE_TO_CHANNEL_FIELDS;
    for (const role of activeRoles) {
      const fields = roleToFields[role];
      if (fields) {
        for (const f of fields) neededFields.add(f);
      }
    }

    // 3. All prunable role channel fields (excludes protected: village, spectator, voice)
    const ALL_ROLE_CHANNEL_FIELDS = [
      'wolvesChannelId',
      'seerChannelId',
      'witchChannelId',
      'cupidChannelId',
      'salvateurChannelId',
      'whiteWolfChannelId',
      'thiefChannelId',
    ];

    // Field → channel_type key used in game_channels DB table
    const FIELD_TO_DB_TYPE = {
      wolvesChannelId:    'wolves',
      seerChannelId:      'seer',
      witchChannelId:     'witch',
      cupidChannelId:     'cupid',
      salvateurChannelId: 'salvateur',
      whiteWolfChannelId: 'whiteWolf',
      thiefChannelId:     'thief',
    };

    // Field → role panel key (used in this.rolePanels)
    const FIELD_TO_PANEL_KEY = {
      wolvesChannelId:    'wolves',
      seerChannelId:      'seer',
      witchChannelId:     'witch',
      cupidChannelId:     'cupid',
      salvateurChannelId: 'salvateur',
      whiteWolfChannelId: 'white_wolf',
      thiefChannelId:     'thief',
    };

    logger.info('PRUNE_ANALYSIS', {
      channelId: game.mainChannelId,
      activeRoles: [...activeRoles],
      neededFields: [...neededFields],
      totalRoleChannels: ALL_ROLE_CHANNEL_FIELDS.length,
    });

    // 4. Separate fields into kept vs to-prune (synchronous — zero API calls)
    const toPrune = [];
    for (const field of ALL_ROLE_CHANNEL_FIELDS) {
      const channelId = game[field];
      if (!channelId) continue;
      if (neededFields.has(field)) {
        result.kept.push(field);
      } else {
        toPrune.push({ field, channelId });
      }
    }

    // 5. Delete unused channels in parallel (concurrency = 3)
    const { mapConcurrent } = require('../utils/concurrency');
    const dbUpdates = {};
    await mapConcurrent(toPrune, async ({ field, channelId }) => {
      logger.info('PRUNE_CHANNEL_START', { field, channelId, channelType: FIELD_TO_DB_TYPE[field] });
      const deleted = await this._safeDeleteChannel(guild, channelId);
      if (deleted) {
        game[field] = null;
        dbUpdates[field] = null;
        try {
          this.db.deleteGameChannel(channelId);
        } catch (err) {
          logger.warn('PRUNE_DB_DELETE_FAILED', { channelId, error: err.message });
        }
        const panelKey = FIELD_TO_PANEL_KEY[field];
        if (panelKey && this.rolePanels.has(game.mainChannelId)) {
          const panels = this.rolePanels.get(game.mainChannelId);
          if (panels && panels[panelKey]) {
            delete panels[panelKey];
          }
        }
        result.pruned.push(field);
        logger.info('PRUNE_CHANNEL_SUCCESS', { field, channelId });
      } else {
        result.failed.push(field);
        logger.warn('PRUNE_CHANNEL_FAILED', { field, channelId });
      }
    }, 3, { swallowErrors: true });

    // 5. Persist all nulled channel IDs to DB in one update
    if (Object.keys(dbUpdates).length > 0) {
      try {
        this.db.updateGame(game.mainChannelId, dbUpdates);
      } catch (err) {
        logger.error('PRUNE_DB_UPDATE_FAILED', { channelId: game.mainChannelId, error: err.message });
      }
      this.markDirty(game.mainChannelId);
    }

    timer.end();
    logger.info('PRUNE_COMPLETE', {
      channelId: game.mainChannelId,
      pruned: result.pruned.length,
      kept: result.kept.length,
      failed: result.failed.length,
      details: result,
    });

    return result;
  }

  async cleanupChannels(guild, game) {
    const timer = logger.startTimer('cleanupChannels');
    // Annuler le timeout si cleanup manuel
    if (game && game.mainChannelId) {
      this.clearLobbyTimeout(game.mainChannelId);
    }

    // Source of truth: game_channels DB table
    const registeredChannels = this.db.getGameChannels(game.mainChannelId);

    // Also collect IDs from game object as migration safety (channels created before game_channels table existed)
    const gameObjectIds = [
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
    ].filter(e => e.id);

    // Merge: DB channels + game object IDs (deduplicated by channel ID)
    const allIds = new Map();
    for (const rc of registeredChannels) {
      allIds.set(rc.channel_id, rc.channel_type);
    }
    for (const entry of gameObjectIds) {
      if (!allIds.has(entry.id)) {
        allIds.set(entry.id, entry.name);
      }
    }

    logger.info('CHANNELS_CLEANUP_START', { channelCount: allIds.size, fromDb: registeredChannels.length, fromGameObj: gameObjectIds.length });
    let deleted = 0;

    for (const [channelId, channelType] of allIds) {
      try {
        // Force-fetch from API to avoid stale cache
        const ch = await guild.channels.fetch(channelId, { force: true }).catch(() => null);
        if (!ch) {
          logger.warn('CHANNEL_CLEANUP_NOT_FOUND', { name: channelType, id: channelId });
          this.db.deleteGameChannel(channelId);
          continue;
        }

        // Safety: verify this channel belongs to this guild
        if (ch.guildId !== guild.id) {
          logger.warn('CHANNEL_CLEANUP_WRONG_GUILD', { channelId, expectedGuild: guild.id, actualGuild: ch.guildId });
          continue;
        }

        // Try to unban/mute safety: if voice, attempt to unmute members before deletion
        try {
          if (ch.type === 2) {
            logger.debug('VOICE_UNMUTING_BEFORE_DELETE', { channelId: ch.id });
            for (const member of ch.members.values()) {
              try { await member.voice.setMute(false); } catch (e) { /* ignore individual failures */ }
            }
          }
        } catch (e) {
          // ignore
        }

        // Ensure bot has permission to delete (re-grant ViewChannel if needed)
        try {
          const botId = guild.members.me?.id || guild.client.user.id;
          await ch.permissionOverwrites.edit(botId, { ViewChannel: true, ManageChannels: true }).catch(() => {});
        } catch (e) { /* best-effort */ }

        await ch.delete({ reason: 'Cleanup partie Loup-Garou' });
        deleted++;
        logger.info('CHANNEL_DELETED', { name: channelType, id: channelId });
      } catch (err) {
        logger.error('CHANNEL_DELETE_FAILED', { name: channelType, id: channelId, error: err.message });
      }
    }

    // Clean up all DB records for this game
    this.db.deleteGameChannelsByGame(game.mainChannelId);

    this.saveState();
    timer.end();
    logger.info('CHANNELS_CLEANUP_COMPLETE', { deleted });

    return deleted;
  }

  /**
   * Clean up orphan game channels — 100% DB-based.
   * Queries game_channels table, finds entries whose game is no longer active,
   * deletes them from Discord by ID only (never by name/pattern).
   * @param {Guild} guild - The Discord guild
   * @returns {number} Number of orphan channels deleted
   */
  async cleanupOrphanChannels(guild) {
    const timer = logger.startTimer('cleanupOrphanChannels');
    logger.info('ORPHAN_CLEANUP_START', { guildId: guild.id });
    let deleted = 0;

    try {
      // Source of truth: game_channels DB table
      const registeredChannels = this.db.getGameChannelsByGuild(guild.id);

      // Get active game mainChannelIds from memory
      const activeGameIds = new Set();
      for (const game of this.games.values()) {
        if (game.guildId === guild.id) {
          activeGameIds.add(game.mainChannelId);
        }
      }

      // Find orphans: registered channels whose game is no longer active
      const orphans = registeredChannels.filter(rc => !activeGameIds.has(rc.game_channel_id));

      logger.info('ORPHAN_CHANNELS_FOUND', { total: registeredChannels.length, active: activeGameIds.size, orphans: orphans.length });

      for (const orphan of orphans) {
        try {
          const ch = await guild.channels.fetch(orphan.channel_id, { force: true }).catch(() => null);
          if (!ch) {
            // Channel already deleted on Discord side, clean DB record
            this.db.deleteGameChannel(orphan.channel_id);
            continue;
          }

          // Safety: verify this channel belongs to this guild
          if (ch.guildId !== guild.id) {
            logger.warn('ORPHAN_WRONG_GUILD', { channelId: orphan.channel_id, expectedGuild: guild.id, actualGuild: ch.guildId });
            this.db.deleteGameChannel(orphan.channel_id);
            continue;
          }

          // Unmute voice members before deletion
          try {
            if (ch.type === 2) {
              for (const member of ch.members.values()) {
                try { await member.voice.setMute(false); } catch (e) { /* ignore */ }
              }
            }
          } catch (e) { /* ignore */ }

          // Ensure bot has permission to delete
          try {
            const botId = guild.members.me?.id || guild.client.user.id;
            await ch.permissionOverwrites.edit(botId, { ViewChannel: true, ManageChannels: true }).catch(() => {});
          } catch (e) { /* best-effort */ }

          await ch.delete({ reason: 'Cleanup orphan Loup-Garou channel' });
          deleted++;
          logger.info('ORPHAN_CHANNEL_DELETED', { type: orphan.channel_type, id: orphan.channel_id });
        } catch (err) {
          logger.error('ORPHAN_CHANNEL_DELETE_FAILED', { id: orphan.channel_id, error: err.message });
        }

        // Clean DB record regardless of deletion success
        this.db.deleteGameChannel(orphan.channel_id);
      }
    } catch (err) {
      logger.error('ORPHAN_CLEANUP_ERROR', err);
    }

    timer.end();
    logger.info('ORPHAN_CLEANUP_COMPLETE', { deleted });
    return deleted;
  }

  /**
   * Clean up all registered game channels for a guild — 100% DB-based.
   * Used by /clear command. Deletes only channels tracked in game_channels table.
   * @param {Guild} guild - The Discord guild
   * @returns {number} Number of channels deleted
   */
  async cleanupAllGameChannels(guild) {
    const timer = logger.startTimer('cleanupAllGameChannels');
    logger.info('GUILD_CHANNEL_CLEANUP_START', { guildId: guild.id });
    let deleted = 0;

    try {
      const registeredChannels = this.db.getGameChannelsByGuild(guild.id);

      for (const entry of registeredChannels) {
        try {
          const ch = await guild.channels.fetch(entry.channel_id, { force: true }).catch(() => null);
          if (!ch) {
            this.db.deleteGameChannel(entry.channel_id);
            continue;
          }

          // Safety: verify guild
          if (ch.guildId !== guild.id) {
            logger.warn('CLEANUP_WRONG_GUILD', { channelId: entry.channel_id, expectedGuild: guild.id });
            this.db.deleteGameChannel(entry.channel_id);
            continue;
          }

          // Unmute voice members before deletion
          try {
            if (ch.type === 2) {
              for (const member of ch.members.values()) {
                try { await member.voice.setMute(false); } catch (e) { /* ignore */ }
              }
            }
          } catch (e) { /* ignore */ }

          // Ensure bot has permission
          try {
            const botId = guild.members.me?.id || guild.client.user.id;
            await ch.permissionOverwrites.edit(botId, { ViewChannel: true, ManageChannels: true }).catch(() => {});
          } catch (e) { /* best-effort */ }

          await ch.delete({ reason: 'Cleanup Loup-Garou channel (/clear)' });
          deleted++;
          logger.info('CHANNEL_DELETED', { type: entry.channel_type, id: entry.channel_id });
        } catch (err) {
          logger.error('CHANNEL_DELETE_FAILED', { id: entry.channel_id, error: err.message });
        }

        this.db.deleteGameChannel(entry.channel_id);
      }
    } catch (err) {
      logger.error('GUILD_CHANNEL_CLEANUP_ERROR', err);
    }

    timer.end();
    logger.info('GUILD_CHANNEL_CLEANUP_COMPLETE', { deleted });
    return deleted;
  }

  async updateVoicePerms(guild, game) {
    try {
      if (!game.voiceChannelId) return;

      const voiceChannel = await guild.channels.fetch(game.voiceChannelId);
      if (!voiceChannel) return;

      const botId = guild.members.me ? guild.members.me.id : null;
      const { mapConcurrent } = require('../utils/concurrency');
      const members = [...voiceChannel.members.values()].filter(m => !botId || m.id !== botId);

      // Night: mute registered alive players; Day/Ended: unmute all registered players
      if (game.phase === PHASES.NIGHT) {
        const toMute = members.filter(m => {
          const player = game.players.find(p => p.id === m.id);
          return player && player.alive;
        });
        await mapConcurrent(toMute, async (member) => {
          try { await member.voice.setMute(true); } catch (_) { /* ignore */ }
        }, 5);
      } else if (game.phase === PHASES.DAY || game.phase === PHASES.ENDED) {
        const toUnmute = members.filter(m => game.players.some(p => p.id === m.id));
        await mapConcurrent(toUnmute, async (member) => {
          try { await member.voice.setMute(false); } catch (_) { /* ignore */ }
        }, 5);
      }
    } catch (error) {
      logger.error('VOICE_PERMISSIONS_UPDATE_FAILED', error);
    }
  }

  async nextPhase(guild, game, options = {}) {
    const { skipAtomic = false } = options;
    // Guard: never toggle an ENDED game back
    if (game.phase === PHASES.ENDED) {
      logger.warn('NEXT_PHASE_ON_ENDED_GAME', { channelId: game.mainChannelId });
      return game.phase;
    }

    const applyNextPhaseMutation = (state) => {
      const computedPhase = state.phase === PHASES.NIGHT ? PHASES.DAY : PHASES.NIGHT;
      const computedDayCount = computedPhase === PHASES.DAY ? (state.dayCount || 0) + 1 : (state.dayCount || 0);
      let computedSubPhase = state.subPhase;

      if (computedPhase === PHASES.NIGHT) {
        const useReal = state.skipFakePhases !== false;
        const checkRole = (g, r) => useReal ? this.hasAliveRealRole(g, r) : this.hasAliveAnyRole(g, r);
        const isFirstNight = computedDayCount === 0;
        const cupidAlive = checkRole(state, ROLES.CUPID);
        const cupidNotUsed = !state.lovers || state.lovers.length === 0;
        if (isFirstNight && cupidAlive && cupidNotUsed) {
          computedSubPhase = PHASES.CUPIDON;
        } else {
          const salvateurAlive = checkRole(state, ROLES.SALVATEUR);
          computedSubPhase = (salvateurAlive && !state.villageRolesPowerless) ? PHASES.SALVATEUR : PHASES.LOUPS;
        }
      } else {
        computedSubPhase = PHASES.REVEIL;
      }

      this._setPhase(state, computedPhase, { allowOutsideAtomic: skipAtomic });
      state.dayCount = computedDayCount;
      this._setSubPhase(state, computedSubPhase, { skipValidation: true, allowOutsideAtomic: skipAtomic });

      state.votes.clear();
      if (state.voteVoters) state.voteVoters.clear();
      if (state._voteIncrements) state._voteIncrements.clear();
      this.db.clearVotes(state.mainChannelId, 'village', state.dayCount);

      if (state.phase === PHASES.NIGHT) {
        state.nightVictim = null;
        state.wolvesVoteState = require('./wolfVoteEngine').createWolvesVoteState();
        this.db.clearVotes(state.mainChannelId, 'wolves', state.dayCount || 0);
      }
      // Reset village vote state on any phase change
      state.villageVoteState = require('./villageVoteEngine').createVillageVoteState();

      return state.phase;
    };

    const newPhase = skipAtomic
      ? applyNextPhaseMutation(game)
      : await this.runAtomic(game.mainChannelId, applyNextPhaseMutation);

    await this.updateVoicePerms(guild, game);
    this._emitGameEvent(game, 'phaseChanged', {
      phase: game.phase,
      subPhase: game.subPhase,
      dayCount: game.dayCount
    });

    return newPhase;
  }

  async voteCaptain(channelId, voterId, targetId) {
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

    const result = await this.runAtomic(channelId, (state) => {
      const prev = state.captainVoters.get(voterId);
      if (prev) {
        state.captainVotes.set(prev, (state.captainVotes.get(prev) || 1) - 1);
        if (state.captainVotes.get(prev) <= 0) state.captainVotes.delete(prev);
      }

      state.captainVoters.set(voterId, targetId);
      state.captainVotes.set(targetId, (state.captainVotes.get(targetId) || 0) + 1);
      this.db.addVoteIfChanged(channelId, voterId, targetId, 'captain', state.dayCount || 0);

      const alivePlayers = state.players.filter(p => p.alive);
      const allVoted = alivePlayers.length > 0 && alivePlayers.every(p => state.captainVoters.has(p.id));
      if (!allVoted) {
        return { ok: true, allVoted: false, voted: state.captainVoters.size, total: alivePlayers.length };
      }

      const entries = Array.from(state.captainVotes.entries());
      if (entries.length === 0) return { ok: false, reason: 'no_votes' };
      entries.sort((a, b) => b[1] - a[1]);
      const top = entries[0][1];
      const tied = entries.filter(e => e[1] === top).map(e => e[0]);

      let winnerId = entries[0][0];
      let wasTie = false;
      if (tied.length > 1) {
        winnerId = tied[Math.floor(Math.random() * tied.length)];
        wasTie = true;
      }

      const winner = state.players.find(p => p.id === winnerId);
      if (!winner) return { ok: false, reason: 'winner_not_found' };

      state.captainId = winnerId;
      state.captainVotes.clear();
      state.captainVoters.clear();
      this.db.clearVotes(channelId, 'captain', state.dayCount || 0);
      this.clearCaptainVoteTimeout(state);

      return { ok: true, allVoted: true, resolution: { ok: true, winnerId, username: winner.username, wasTie, tied: wasTie ? tied : undefined } };
    });
    // Emit captainElected so GUI panels refresh
    if (result && result.allVoted && result.resolution?.ok) {
      this._emitGameEvent(game, 'captainElected', { captainId: result.resolution.winnerId });
    }
    return result;
  }

  /**
   * Résout le vote du capitaine (utilisé par auto-resolve et timeout)
   */
  async resolveCaptainVote(channelId) {
    const game = this.games.get(channelId);
    if (!game) return { ok: false, reason: "no_game" };
    if (game.captainId) return { ok: false, reason: "already_set" };
    if (game.subPhase !== PHASES.VOTE_CAPITAINE) return { ok: false, reason: "wrong_phase" };

    const result = await this.runAtomic(channelId, (state) => {
      const entries = Array.from(state.captainVotes.entries());
      if (entries.length === 0) return { ok: false, reason: "no_votes" };

      entries.sort((a, b) => b[1] - a[1]);
      const top = entries[0][1];
      const tied = entries.filter(e => e[1] === top).map(e => e[0]);

      let winnerId = entries[0][0];
      let wasTie = false;
      if (tied.length > 1) {
        winnerId = tied[Math.floor(Math.random() * tied.length)];
        wasTie = true;
      }

      const winner = state.players.find(p => p.id === winnerId);
      if (!winner) return { ok: false, reason: "winner_not_found" };

      state.captainId = winnerId;
      state.captainVotes.clear();
      state.captainVoters.clear();
      this.db.clearVotes(channelId, 'captain', state.dayCount || 0);
      this.clearCaptainVoteTimeout(state);
      return { ok: true, winnerId, username: winner.username, wasTie, tied: wasTie ? tied : undefined };
    });
    // Emit captainElected so GUI panels refresh
    if (result && result.ok) {
      this._emitGameEvent(game, 'captainElected', { captainId: result.winnerId });
    }
    return result;
  }

  // Alias pour compatibilité des tests et du timeout
  async declareCaptain(channelId) {
    return this.resolveCaptainVote(channelId);
  }

  getAlive(channelId) {
    const game = this.games.get(channelId);
    if (!game) return [];
    return game.players.filter(p => p.alive);
  }

  kill(channelId, playerId, options = {}) {
    const { throwOnDbFailure = false } = options;
    const game = this.games.get(channelId);
    if (!game) return [];
    const player = game.players.find(p => p.id === playerId);
    if (!player || !player.alive) return [];
    player.alive = false;
    game.dead.push(player);
    
    // Synchroniser avec la DB
    const primaryUpdated = this.db.updatePlayer(channelId, playerId, { alive: false });
    if (!primaryUpdated) {
      if (throwOnDbFailure) {
        throw new Error(`Failed to persist kill for player ${playerId}`);
      }
      logger.warn('KILL_DB_UPDATE_FAILED', { channelId, playerId });
    }
    
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
            const collateralUpdated = this.db.updatePlayer(channelId, otherId, { alive: false });
            if (!collateralUpdated) {
              if (throwOnDbFailure) {
                throw new Error(`Failed to persist collateral kill for player ${otherId}`);
              }
              logger.warn('COLLATERAL_KILL_DB_UPDATE_FAILED', { channelId, playerId: otherId });
            }
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
          logger.warn('DEAD_PLAYER_READONLY_FAILED', { playerId, roleChannelId, error: e.message });
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
          logger.warn('DEAD_PLAYER_SPECTATOR_FAILED', { playerId, error: e.message });
        }
      }

      logger.debug('DEAD_PLAYER_PERMISSIONS_SET', { playerId });
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
      logger.debug('VOICE_JOINING', { voiceChannelId });
      const voiceChannel = await guild.channels.fetch(voiceChannelId);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) {
        logger.error('VOICE_CHANNEL_INVALID', { voiceChannelId });
        return false;
      }
      await voiceManager.joinChannel(voiceChannel);
      logger.info('VOICE_JOINED', { voiceChannelId });
      return true;
    } catch (error) {
      logger.error('VOICE_CONNECTION_FAILED', error);
      return false;
    }
  }

  async playAmbience(voiceChannelId, soundFile) {
    const voiceManager = require('./voiceManager');
    try {
      logger.debug('AMBIENCE_PLAYING', { voiceChannelId, soundFile });
      // For day/night ambience we want looping until a phase change
      if (soundFile === 'day_ambience.mp3' || soundFile === 'night_ambience.mp3') {
        await voiceManager.startLoop(voiceChannelId, soundFile);
      } else {
        // stop any running ambience loop before playing one-shot sounds
        try { voiceManager.stopLoop(voiceChannelId); } catch (e) { /* ignore */ }
        await voiceManager.playSound(voiceChannelId, soundFile);
      }
      logger.info('AMBIENCE_STARTED', { soundFile });
    } catch (error) {
      logger.error('AMBIENCE_PLAY_FAILED', { soundFile, error: error.message });
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
  syncGameToDb(channelId, options = {}) {
    const { throwOnError = false } = options;
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
        hunterMustShootId: game._hunterMustShoot || null,
        captainTiebreakIds: game._captainTiebreak ? JSON.stringify(game._captainTiebreak) : null,
        noKillCycles: game._noKillCycles || 0,
        listenHintsGiven: JSON.stringify(game.listenHintsGiven || []),
        littleGirlExposureLevel: game.littleGirlExposureLevel || 0,
        littleGirlExposed: game.littleGirlExposed ? 1 : 0,
        thiefExtraRoles: JSON.stringify(game.thiefExtraRoles || []),
        // v3.5 — ability engine runtime state
        abilityStateJson: game._abilityState
          ? require('./abilities').serializeAbilityState(game)
          : '{}'
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
          inLove: player.inLove || false,
          idiotRevealed: player.idiotRevealed || false
        });
      }
    });

    try {
      syncFn();
      logger.debug('GAME_SYNCED_TO_DB', { channelId });
    } catch (error) {
      logger.error('GAME_SYNC_TO_DB_FAILED', error);
      if (throwOnError) throw error;
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
        logger.debug('GAMES_SYNCED_TO_DB', { count: toSync.length });
      }
    } catch (error) {
      logger.error('GAMES_SYNC_TO_DB_FAILED', error);
    } finally {
      this.saveInProgress = false;
    }
  }

  loadState() {
    try {
      logger.info('GAME_STATE_LOADING');
      
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
          id: dbGame.id || null,
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
          _hunterMustShoot: dbGame.hunter_must_shoot_id || null,
          _captainTiebreak: dbGame.captain_tiebreak_ids ? JSON.parse(dbGame.captain_tiebreak_ids) : null,
          listenHintsGiven: JSON.parse(dbGame.listen_hints_given || '[]'),
          wolvesVoteState: require('./wolfVoteEngine').createWolvesVoteState(),
          villageVoteState: require('./villageVoteEngine').createVillageVoteState(),
          littleGirlExposureLevel: dbGame.little_girl_exposure || 0,
          littleGirlListenedThisNight: false, // Runtime-only (reset on restart)
          littleGirlExposed: dbGame.little_girl_exposed === 1,
          thiefExtraRoles: JSON.parse(dbGame.thief_extra_roles || '[]'),
          rules: { 
            minPlayers: dbGame.min_players, 
            maxPlayers: dbGame.max_players 
          },
          actionLog: actionLog,
          startedAt: dbGame.started_at,
          endedAt: dbGame.ended_at,
          disableVoiceMute: dbGame.disable_voice_mute === 1,
          balanceMode: dbGame.balance_mode || BalanceMode.DYNAMIC,
          _activeTimerType: null,
          _lastMutationAt: Date.now(),
          stuckStatus: 'OK',
          _aliveAtNightStart: players.filter(p => p.alive).length,
          _noKillCycles: dbGame.no_kill_cycles || 0
        };

        // v3.5 — Restore ability engine runtime state
        if (dbGame.ability_state_json) {
          try {
            const { restoreAbilityState } = require('./abilities');
            restoreAbilityState(game, dbGame.ability_state_json);
          } catch (e) {
            logger.warn('ABILITY_STATE_RESTORE_FAILED', { channelId, error: e.message });
          }
        }

        // v3.5 — Rehydrate custom role definitions onto players
        try {
          this._rehydrateCustomRoles(game);
        } catch (e) {
          logger.warn('CUSTOM_ROLES_REHYDRATE_FAILED', { channelId, error: e.message });
        }

        // Fallback: restore villageRolesPowerless from logs if column was 0 but logs say otherwise
        if (!game.villageRolesPowerless && actionLog.some(a => a.text && a.text.includes('pouvoirs perdus'))) {
          game.villageRolesPowerless = true;
        }

        // Restaurer ancienExtraLife : si l'Ancien est vivant et pas de log de survie, il a encore sa vie
        const ancienPlayer = players.find(p => p.role === ROLES.ANCIEN);
        if (ancienPlayer && ancienPlayer.alive) {
          const ancienUsedLife = actionLog.some(a => a.text && a.text.includes('vie supplémentaire'));
          ancienPlayer.ancienExtraLife = !ancienUsedLife;
        }

        // v3.5.1 — Restore in-progress votes from DB based on current phase/subPhase
        try {
          const round = game.dayCount || 0;
          if (game.phase === PHASES.DAY && game.subPhase === PHASES.VOTE) {
            const dbVoterMap = this.db.getVotes(channelId, 'village', round);
            if (dbVoterMap.size > 0) {
              game.voteVoters = dbVoterMap;
              game.votes = new Map();
              game._voteIncrements = new Map();
              for (const [voterId, targetId] of dbVoterMap) {
                const isCaptain = game.captainId && game.captainId === voterId;
                const increment = isCaptain ? 2 : 1;
                game._voteIncrements.set(voterId, increment);
                game.votes.set(targetId, (game.votes.get(targetId) || 0) + increment);
              }
              logger.debug('VOTES_RESTORED_VILLAGE', { channelId, count: dbVoterMap.size });
            }
          } else if (game.phase === PHASES.DAY && game.subPhase === PHASES.VOTE_CAPITAINE && !game.captainId) {
            const dbVoterMap = this.db.getVotes(channelId, 'captain', round);
            if (dbVoterMap.size > 0) {
              game.captainVoters = dbVoterMap;
              game.captainVotes = new Map();
              for (const [, targetId] of dbVoterMap) {
                game.captainVotes.set(targetId, (game.captainVotes.get(targetId) || 0) + 1);
              }
              logger.debug('VOTES_RESTORED_CAPTAIN', { channelId, count: dbVoterMap.size });
            }
          } else if (game.phase === PHASES.NIGHT && game.subPhase === PHASES.LOUPS) {
            const dbVoterMap = this.db.getVotes(channelId, 'wolves', round);
            if (dbVoterMap.size > 0) {
              for (const [wolfId, targetId] of dbVoterMap) {
                game.wolvesVoteState.votes.set(wolfId, targetId);
              }
              logger.debug('VOTES_RESTORED_WOLF', { channelId, count: dbVoterMap.size });
            }
          }
        } catch (e) {
          logger.warn('VOTES_RESTORE_FAILED', { channelId, error: e.message });
        }
        
        this.games.set(channelId, game);
      }
      
      logger.info('GAME_STATE_LOADED', { gameCount: this.games.size });
    } catch (err) {
      logger.error('GAME_STATE_LOAD_FAILED', err);
    }
  }

  /**
   * Rehydrate custom role definitions onto players after loadState.
   * Reads from custom_roles table via guild_id, validates abilities,
   * and attaches _customRole to matching players.
   * 
   * @param {Object} game - In-memory game object
   */
  _rehydrateCustomRoles(game) {
    if (!game.guildId) return;

    // Check if custom_roles table exists
    const tableExists = this.db.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='custom_roles'"
    ).get();
    if (!tableExists) return;

    const customRoles = this.db.db.prepare(
      'SELECT * FROM custom_roles WHERE guild_id = ?'
    ).all(game.guildId);

    if (!customRoles || customRoles.length === 0) return;

    const { validateRoleDefinition, normalizeRoleDefinition } = require('./abilities');

    // Build a map of custom role name -> definition
    const roleMap = new Map();
    for (const cr of customRoles) {
      let abilities = [];
      try {
        abilities = JSON.parse(cr.abilities_json || '[]');
      } catch {
        logger.warn('CUSTOM_ROLE_INVALID_ABILITIES', { roleId: cr.id, name: cr.name });
        continue;
      }

      const roleDef = {
        name: cr.name,
        camp: cr.camp || 'village',
        winCondition: cr.win_condition || 'village_wins',
        abilities,
      };

      const validation = validateRoleDefinition(roleDef);
      if (!validation.valid) {
        logger.warn('CUSTOM_ROLE_VALIDATION_FAILED', {
          roleId: cr.id,
          name: cr.name,
          errors: validation.errors,
        });
        continue;
      }

      roleMap.set(cr.name, normalizeRoleDefinition(roleDef));
    }

    // Attach _customRole to players whose role matches a custom role name
    for (const player of game.players) {
      if (player.role && roleMap.has(player.role)) {
        player._customRole = roleMap.get(player.role);
      }
    }
  }
}

const instance = new GameManager();
module.exports = instance;
module.exports.GameManager = GameManager;
