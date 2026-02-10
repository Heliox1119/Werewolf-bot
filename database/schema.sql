-- Schema pour Werewolf Bot Database
-- SQLite 3

-- Table des parties (games)
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT UNIQUE NOT NULL,
  lobby_host_id TEXT,
  lobby_message_id TEXT,
  
  -- Channels Discord
  voice_channel_id TEXT,
  village_channel_id TEXT,
  wolves_channel_id TEXT,
  seer_channel_id TEXT,
  witch_channel_id TEXT,
  cupid_channel_id TEXT,
  
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
