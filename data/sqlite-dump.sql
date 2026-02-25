PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT, created_at INTEGER DEFAULT (strftime('%s','now')));
INSERT OR IGNORE INTO games (id, channel_id) VALUES (1,'ch1');
COMMIT;
