// Mock pour GameDatabase - utilisé dans les tests
class MockGameDatabase {
  constructor(dbPath = null) {
    this.dbPath = dbPath;
    this.games = new Map();
    this.players = new Map();
    this.votes = new Map();
    this.logs = new Map();
    this.config = new Map([['schema_version', '1']]);
  }

  // ===== CONFIG =====
  
  getConfig(key) {
    return this.config.get(key);
  }

  setConfig(key, value) {
    this.config.set(key, value);
  }

  // ===== GAMES =====

  createGame(channelId, options = {}) {
    if (this.games.has(channelId)) return null;
    
    const gameId = Date.now();
    this.games.set(channelId, {
      id: gameId,
      channel_id: channelId,
      guild_id: options.guildId || null,
      lobby_host_id: options.lobbyHostId,
      min_players: options.minPlayers || 5,
      max_players: options.maxPlayers || 10,
      phase: 'Nuit',
      sub_phase: null,
      day_count: 0,
      captain_id: null,
      disable_voice_mute: options.disableVoiceMute || 0,
      white_wolf_channel_id: null,
      thief_channel_id: null,
      white_wolf_kill_target_id: null,
      protected_player_id: null,
      last_protected_player_id: null,
      village_roles_powerless: 0,
      listen_hints_given: '[]',
      little_girl_exposure: 0,
      little_girl_exposed: 0,
      thief_extra_roles: '[]'
    });
    
    this.players.set(channelId, []);
    this.votes.set(channelId, []);
    this.logs.set(channelId, []);
    if (!this.nightActions) this.nightActions = new Map();
    this.nightActions.set(channelId, []);
    if (!this.witchPotions) this.witchPotions = new Map();
    this.witchPotions.set(channelId, { life: false, death: false });
    
    return gameId;
  }

  getGame(channelId) {
    return this.games.get(channelId);
  }

  getGameById(gameId) {
    for (const game of this.games.values()) {
      if (game.id === gameId) return game;
    }
    return null;
  }

  updateGame(channelId, updates) {
    const game = this.games.get(channelId);
    if (!game) return;
    
    const mapping = {
      lobbyMessageId: 'lobby_message_id',
      lobbyHostId: 'lobby_host_id',
      voiceChannelId: 'voice_channel_id',
      villageChannelId: 'village_channel_id',
      wolvesChannelId: 'wolves_channel_id',
      seerChannelId: 'seer_channel_id',
      witchChannelId: 'witch_channel_id',
      cupidChannelId: 'cupid_channel_id',
      salvateurChannelId: 'salvateur_channel_id',
      spectatorChannelId: 'spectator_channel_id',
      whiteWolfChannelId: 'white_wolf_channel_id',
      thiefChannelId: 'thief_channel_id',
      whiteWolfKillTarget: 'white_wolf_kill_target_id',
      protectedPlayerId: 'protected_player_id',
      lastProtectedPlayerId: 'last_protected_player_id',
      villageRolesPowerless: 'village_roles_powerless',
      hunterMustShootId: 'hunter_must_shoot_id',
      captainTiebreakIds: 'captain_tiebreak_ids',
      noKillCycles: 'no_kill_cycles',
      listenHintsGiven: 'listen_hints_given',
      littleGirlExposureLevel: 'little_girl_exposure',
      littleGirlExposed: 'little_girl_exposed',
      thiefExtraRoles: 'thief_extra_roles',
      phase: 'phase',
      subPhase: 'sub_phase',
      dayCount: 'day_count',
      captainId: 'captain_id',
      startedAt: 'started_at',
      endedAt: 'ended_at'
    };

    for (const [jsKey, dbKey] of Object.entries(mapping)) {
      if (updates[jsKey] !== undefined) {
        game[dbKey] = updates[jsKey];
      }
    }
  }

  deleteGame(channelId) {
    this.games.delete(channelId);
    this.players.delete(channelId);
    this.votes.delete(channelId);
    this.logs.delete(channelId);
    if (this.nightActions) this.nightActions.delete(channelId);
    if (this.witchPotions) this.witchPotions.delete(channelId);
    return true;
  }

  getAllGames() {
    return Array.from(this.games.values());
  }

  // ===== PLAYERS =====

  addPlayer(channelId, userId, username) {
    if (!this.players.has(channelId)) {
      this.players.set(channelId, []);
    }
    
    const players = this.players.get(channelId);
    if (players.some(p => p.id === userId)) return false;
    
    players.push({
      id: userId,
      username,
      role: null,
      alive: true,
      inLove: false
    });
    return true;
  }

  removePlayer(channelId, userId) {
    const players = this.players.get(channelId);
    if (!players) return false;
    
    const index = players.findIndex(p => p.id === userId);
    if (index === -1) return false;
    
    players.splice(index, 1);
    return true;
  }

  getPlayers(channelId) {
    return this.players.get(channelId) || [];
  }

  updatePlayer(channelId, userId, updates) {
    const players = this.players.get(channelId);
    if (!players) return false;
    
    const player = players.find(p => p.id === userId);
    if (!player) return false;
    
    if (updates.role !== undefined) player.role = updates.role;
    if (updates.alive !== undefined) player.alive = updates.alive;
    if (updates.inLove !== undefined) player.inLove = updates.inLove;
    if (updates.idiotRevealed !== undefined) player.idiotRevealed = updates.idiotRevealed;
    
    return true;
  }

  // ===== VOTES =====

  addVote(channelId, voterId, targetId, voteType = 'village', round = 0) {
    const result = this.addVoteIfChanged(channelId, voterId, targetId, voteType, round);
    return result.ok;
  }

  addVoteIfChanged(channelId, voterId, targetId, voteType = 'village', round = 0) {
    if (!this.votes.has(channelId)) {
      this.votes.set(channelId, []);
    }
    
    const votes = this.votes.get(channelId);
    const existing = votes.findIndex(v => 
      v.voter_id === voterId && v.vote_type === voteType && v.round === round
    );
    
    if (existing !== -1) {
      if (votes[existing].target_id === targetId) {
        return { ok: true, affectedRows: 0, alreadyExecuted: true };
      }
      votes[existing].target_id = targetId;
    } else {
      votes.push({ voter_id: voterId, target_id: targetId, vote_type: voteType, round });
    }
    
    return { ok: true, affectedRows: 1, alreadyExecuted: false };
  }

  getVotes(channelId, voteType = 'village', round = 0) {
    const votes = this.votes.get(channelId) || [];
    const filtered = votes.filter(v => v.vote_type === voteType && v.round === round);
    
    const voteMap = new Map();
    filtered.forEach(v => {
      voteMap.set(v.voter_id, v.target_id);
    });
    return voteMap;
  }

  clearVotes(channelId, voteType = 'village', round = 0) {
    const votes = this.votes.get(channelId);
    if (!votes) return;
    
    const filtered = votes.filter(v => 
      !(v.vote_type === voteType && v.round === round)
    );
    this.votes.set(channelId, filtered);
  }

  // ===== NIGHT ACTIONS =====

  addNightAction(channelId, nightNumber, actionType, actorId, targetId = null) {
    const result = this.addNightActionOnce(channelId, nightNumber, actionType, actorId, targetId);
    return result.ok;
  }

  addNightActionOnce(channelId, nightNumber, actionType, actorId, targetId = null) {
    if (!this.nightActions) this.nightActions = new Map();
    if (!this.nightActions.has(channelId)) this.nightActions.set(channelId, []);
    const actions = this.nightActions.get(channelId);
    const duplicate = actions.find(a =>
      a.nightNumber === nightNumber &&
      a.actionType === actionType &&
      a.actorId === actorId
    );
    if (duplicate) {
      return { ok: true, affectedRows: 0, alreadyExecuted: true };
    }
    actions.push({ nightNumber, actionType, actorId, targetId });
    return { ok: true, affectedRows: 1, alreadyExecuted: false };
  }

  getNightActions(channelId, nightNumber) {
    return [];
  }

  // ===== WITCH POTIONS =====

  initWitchPotions(channelId) {
    // Mock: pas besoin de faire quoi que ce soit
  }

  getWitchPotions(channelId) {
    return { life: true, death: true };
  }

  useWitchPotionIfAvailable(channelId, potionType) {
    if (!this.witchPotions) this.witchPotions = new Map();
    if (!this.witchPotions.has(channelId)) {
      this.witchPotions.set(channelId, { life: false, death: false });
    }
    const potions = this.witchPotions.get(channelId);
    if (potions[potionType]) {
      return { ok: true, affectedRows: 0, alreadyExecuted: true };
    }
    potions[potionType] = true;
    return { ok: true, affectedRows: 1, alreadyExecuted: false };
  }

  useWitchPotion(channelId, potionType) {
    const result = this.useWitchPotionIfAvailable(channelId, potionType);
    return result.ok && result.affectedRows > 0;
  }

  markHunterShotIfFirst(channelId, hunterId) {
    if (!this.hunterShots) this.hunterShots = new Map();
    const key = `${channelId}:${hunterId}`;
    if (this.hunterShots.get(key)) {
      return { ok: true, affectedRows: 0, alreadyExecuted: true };
    }
    this.hunterShots.set(key, true);
    return { ok: true, affectedRows: 1, alreadyExecuted: false };
  }

  // ===== ACTION LOG =====

  addLog(channelId, text) {
    if (!this.logs.has(channelId)) {
      this.logs.set(channelId, []);
    }
    this.logs.get(channelId).push({ text, ts: Date.now() });
  }

  getLogs(channelId, limit = 100) {
    const logs = this.logs.get(channelId) || [];
    return logs.slice(-limit);
  }

  // ===== MODERATION AUDIT LOG =====

  addModAuditLog(guildId, moderatorId, moderatorName, action, details = null) {
    return true;
  }

  getModAuditLog(guildId, limit = 30) {
    return [];
  }

  // ===== LOVERS =====

  setLovers(channelId, lover1Id, lover2Id) {
    const game = this.games.get(channelId);
    if (game) {
      game.lover1_id = lover1Id;
      game.lover2_id = lover2Id;
    }
    
    this.updatePlayer(channelId, lover1Id, { inLove: true });
    this.updatePlayer(channelId, lover2Id, { inLove: true });
  }

  getLovers(channelId) {
    const game = this.games.get(channelId);
    if (!game || !game.lover1_id) return [];
    return [game.lover1_id, game.lover2_id];
  }

  // ===== UTILITY =====

  // ===== PLAYER STATS =====

  updatePlayerStats(playerId, username, updates, guildId = null) {
    return true;
  }

  getPlayerStats(playerId) {
    return null;
  }

  // ===== GAME HISTORY =====

  saveGameHistory(game, winner) {
    return true;
  }

  getGuildHistory(guildId, limit = 10, offset = 0) {
    return [];
  }

  getGlobalStats() {
    return { total_games: 0, village_wins: 0, wolves_wins: 0, lovers_wins: 0, avg_duration: 0, avg_players: 0 };
  }

  close() {
    // Mock: rien à fermer
  }

  backup(backupPath) {
    return Promise.resolve();
  }

  transaction(fn) {
    return fn;
  }
}

module.exports = MockGameDatabase;
