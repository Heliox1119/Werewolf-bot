-- Schema pour Werewolf Bot Database
-- SQLite 3

-- Table des parties (games)
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT UNIQUE NOT NULL,
  guild_id TEXT,
  lobby_host_id TEXT,
  lobby_message_id TEXT,
  
  -- Channels Discord
  voice_channel_id TEXT,
  village_channel_id TEXT,
  wolves_channel_id TEXT,
  seer_channel_id TEXT,
  witch_channel_id TEXT,
  cupid_channel_id TEXT,
  salvateur_channel_id TEXT,
  white_wolf_channel_id TEXT,
  thief_channel_id TEXT,
  spectator_channel_id TEXT,
  
  -- État de la partie
  phase TEXT NOT NULL DEFAULT 'Nuit',
  sub_phase TEXT,
  day_count INTEGER DEFAULT 0,
  
  -- Règles
  min_players INTEGER DEFAULT 5,
  max_players INTEGER DEFAULT 10,
  disable_voice_mute BOOLEAN DEFAULT 0,
  
  -- Capitaine
  captain_id TEXT,
  
  -- Amoureux
  lover1_id TEXT,
  lover2_id TEXT,
  
  -- État nocturne (persisté pour survie au restart)
  night_victim_id TEXT,
  witch_kill_target_id TEXT,
  witch_save BOOLEAN DEFAULT 0,
  white_wolf_kill_target_id TEXT,
  protected_player_id TEXT,
  last_protected_player_id TEXT,
  village_roles_powerless BOOLEAN DEFAULT 0,
  listen_hints_given TEXT DEFAULT '[]',
  thief_extra_roles TEXT DEFAULT '[]',
  
  -- Métadonnées
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  
  -- Index pour recherches rapides
  CHECK (phase IN ('Nuit', 'Jour', 'Terminé'))
);

CREATE INDEX IF NOT EXISTS idx_games_channel ON games(channel_id);
CREATE INDEX IF NOT EXISTS idx_games_phase ON games(phase);
CREATE INDEX IF NOT EXISTS idx_games_started ON games(started_at);
CREATE INDEX IF NOT EXISTS idx_games_guild ON games(guild_id);
CREATE INDEX IF NOT EXISTS idx_games_guild_ended ON games(guild_id, ended_at);

-- Table des joueurs
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  
  -- Statut
  role TEXT,
  alive BOOLEAN DEFAULT 1,
  in_love BOOLEAN DEFAULT 0,
  has_shot BOOLEAN DEFAULT 0,
  
  -- Métadonnées
  joined_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  UNIQUE(game_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_players_game ON players(game_id);
CREATE INDEX IF NOT EXISTS idx_players_user ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_players_alive ON players(game_id, alive);

-- Table des votes
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  voter_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  vote_type TEXT NOT NULL, -- 'village', 'captain'
  round INTEGER DEFAULT 0, -- Pour distinguer plusieurs tours de vote
  
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  UNIQUE(game_id, voter_id, vote_type, round)
);

CREATE INDEX IF NOT EXISTS idx_votes_game ON votes(game_id);
CREATE INDEX IF NOT EXISTS idx_votes_type ON votes(game_id, vote_type, round);

-- Table des actions nocturnes
CREATE TABLE IF NOT EXISTS night_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  night_number INTEGER NOT NULL,
  action_type TEXT NOT NULL, -- 'kill', 'see', 'save', 'poison', 'love', 'shoot'
  actor_id TEXT NOT NULL,
  target_id TEXT,
  
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_actions_game ON night_actions(game_id, night_number);
CREATE INDEX IF NOT EXISTS idx_actions_type ON night_actions(action_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_idempotent_actor
ON night_actions(game_id, night_number, action_type, actor_id);

-- Table des potions de la sorcière (track usage)
CREATE TABLE IF NOT EXISTS witch_potions (
  game_id INTEGER PRIMARY KEY,
  life_potion_used BOOLEAN DEFAULT 0,
  death_potion_used BOOLEAN DEFAULT 0,
  
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Table du journal d'actions (audit log)
CREATE TABLE IF NOT EXISTS action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  action_text TEXT NOT NULL,
  timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_log_game ON action_log(game_id, timestamp);

-- Table de l'historique des parties terminées
CREATE TABLE IF NOT EXISTS game_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  channel_id TEXT NOT NULL,
  winner TEXT, -- 'wolves', 'village', 'lovers', 'draw'
  player_count INTEGER DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  day_count INTEGER DEFAULT 0,
  players_json TEXT, -- JSON array [{id, username, role, alive}]
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_history_guild ON game_history(guild_id);
CREATE INDEX IF NOT EXISTS idx_history_ended ON game_history(ended_at);

-- Table des statistiques joueur
CREATE TABLE IF NOT EXISTS player_stats (
  player_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  games_played INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0,
  times_killed INTEGER DEFAULT 0,
  times_survived INTEGER DEFAULT 0,
  favorite_role TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_player_stats_games ON player_stats(games_played);

-- Table des métriques de monitoring
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Métriques système
  memory_used INTEGER NOT NULL,
  memory_total INTEGER NOT NULL,
  memory_percentage REAL NOT NULL,
  cpu_usage REAL NOT NULL,
  uptime INTEGER NOT NULL,
  
  -- Métriques Discord
  guilds INTEGER NOT NULL,
  users INTEGER NOT NULL,
  channels INTEGER NOT NULL,
  latency INTEGER NOT NULL,
  ws_status TEXT NOT NULL,
  
  -- Métriques jeux
  active_games INTEGER DEFAULT 0,
  total_players INTEGER DEFAULT 0,
  games_created_24h INTEGER DEFAULT 0,
  games_completed_24h INTEGER DEFAULT 0,
  
  -- Métriques commandes
  commands_total INTEGER DEFAULT 0,
  commands_errors INTEGER DEFAULT 0,
  commands_rate_limited INTEGER DEFAULT 0,
  commands_avg_response_time INTEGER DEFAULT 0,
  
  -- Métriques erreurs
  errors_total INTEGER DEFAULT 0,
  errors_critical INTEGER DEFAULT 0,
  errors_warnings INTEGER DEFAULT 0,
  errors_last_24h INTEGER DEFAULT 0,
  
  -- Statut de santé
  health_status TEXT NOT NULL,
  health_issues TEXT,
  
  -- Métadonnées
  collected_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_metrics_collected ON metrics(collected_at);
CREATE INDEX IF NOT EXISTS idx_metrics_health ON metrics(health_status);

-- Vue pour les statistiques des dernières 24h
CREATE VIEW IF NOT EXISTS metrics_24h AS
SELECT * FROM metrics
WHERE collected_at >= strftime('%s', 'now', '-1 day')
ORDER BY collected_at DESC;

-- Table de configuration (key-value store)
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Version du schéma
INSERT OR IGNORE INTO config (key, value) VALUES ('schema_version', '1');

-- Triggers pour updated_at
CREATE TRIGGER IF NOT EXISTS update_games_timestamp 
AFTER UPDATE ON games
BEGIN
  UPDATE games SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
END;
