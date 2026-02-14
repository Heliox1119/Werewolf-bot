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
      disable_voice_mute: options.disableVoiceMute || 0
    });
    
    this.players.set(channelId, []);
    this.votes.set(channelId, []);
    this.logs.set(channelId, []);
    
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
    
    return true;
  }

  // ===== VOTES =====

  addVote(channelId, voterId, targetId, voteType = 'village', round = 0) {
    if (!this.votes.has(channelId)) {
      this.votes.set(channelId, []);
    }
    
    const votes = this.votes.get(channelId);
    const existing = votes.findIndex(v => 
      v.voter_id === voterId && v.vote_type === voteType && v.round === round
    );
    
    if (existing !== -1) {
      votes[existing].target_id = targetId;
    } else {
      votes.push({ voter_id: voterId, target_id: targetId, vote_type: voteType, round });
    }
    
    return true;
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
    return true; // Pas implémenté dans mock
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

  useWitchPotion(channelId, potionType) {
    return true;
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

  updatePlayerStats(playerId, username, updates) {
    return true;
  }

  getPlayerStats(playerId) {
    return null;
  }

  // ===== GAME HISTORY =====

  saveGameHistory(game, winner) {
    return true;
  }

  getGuildHistory(guildId, limit = 10) {
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
