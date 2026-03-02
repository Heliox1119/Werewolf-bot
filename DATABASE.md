# 🗄️ Base de Données - Documentation

## Vue d'ensemble

Le bot Loup-Garou utilise **SQLite** avec la bibliothèque `better-sqlite3` pour persister l'état des parties.

### Pourquoi SQLite?

- ✅ **ACID**: Transactions atomiques, cohérence garantie
- ✅ **Performance**: Bien plus rapide que JSON pour les lectures/écritures
- ✅ **Intégrité**: Contraintes de clés étrangères, types de données validés
- ✅ **Scalabilité**: Peut gérer des milliers de parties simultanées
- ✅ **Backup facile**: Un seul fichier `.db` à sauvegarder
- ✅ **Pas de serveur**: Pas besoin de MySQL/PostgreSQL pour un bot Discord

## Architecture

```
database/
├── db.js           # Classe GameDatabase (wrapper SQLite)
└── schema.sql      # Schéma de base de données
```

## Schéma

### Table `games`

Stocke les métadonnées de chaque partie en cours.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INTEGER PRIMARY KEY | ID auto-incrémenté |
| `channel_id` | TEXT UNIQUE | ID du channel Discord principal |
| `lobby_message_id` | TEXT | ID du message de lobby |
| `lobby_host_id` | TEXT | ID de l'hôte du lobby |
| `voice_channel_id` | TEXT | ID du channel vocal |
| `village_channel_id` | TEXT | ID du channel village |
| `wolves_channel_id` | TEXT | ID du channel loups |
| `seer_channel_id` | TEXT | ID du channel voyante |
| `witch_channel_id` | TEXT | ID du channel sorcière |
| `cupid_channel_id` | TEXT | ID du channel Cupidon |
| `phase` | TEXT | Phase actuelle: "Nuit" ou "Jour" |
| `sub_phase` | TEXT | Sous-phase: "loups", "voyante", "sorciere", etc. |
| `day_count` | INTEGER | Numéro du jour actuel |
| `captain_id` | TEXT | ID du capitaine |
| `lover1_id` | TEXT | ID du premier amoureux |
| `lover2_id` | TEXT | ID du second amoureux |
| `min_players` | INTEGER | Nombre minimum de joueurs |
| `max_players` | INTEGER | Nombre maximum de joueurs |
| `disable_voice_mute` | INTEGER | 1 si voice mute désactivé |
| `started_at` | INTEGER | Timestamp Unix de démarrage |
| `ended_at` | INTEGER | Timestamp Unix de fin |
| `created_at` | INTEGER | Timestamp Unix de création |
| `updated_at` | INTEGER | Timestamp Unix de dernière MAJ |

**Indexes:** `idx_games_channel`, `idx_games_status`

### Table `players`

Stocke les joueurs de chaque partie.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INTEGER PRIMARY KEY | ID auto-incrémenté |
| `game_id` | INTEGER | Clé étrangère vers `games` |
| `user_id` | TEXT | ID Discord du joueur |
| `username` | TEXT | Nom d'utilisateur |
| `role` | TEXT | Rôle: "loup-garou", "villageois", etc. |
| `alive` | INTEGER | 1 si vivant, 0 si mort |
| `in_love` | INTEGER | 1 si amoureux |
| `joined_at` | INTEGER | Timestamp Unix d'arrivée |

**Index:** `idx_players_game`, `idx_players_user`

**Contraintes:** UNIQUE(game_id, user_id)

### Table `votes`

Stocke les votes du village et du capitaine.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INTEGER PRIMARY KEY | ID auto-incrémenté |
| `game_id` | INTEGER | Clé étrangère vers `games` |
| `voter_id` | TEXT | ID du votant |
| `target_id` | TEXT | ID de la cible |
| `vote_type` | TEXT | "village" ou "captain" |
| `round` | INTEGER | Numéro du tour de vote |
| `created_at` | INTEGER | Timestamp Unix du vote |

**Index:** `idx_votes_game`

**Contraintes:** UNIQUE(game_id, voter_id, vote_type, round)

### Table `night_actions`

Stocke les actions nocturnes (kills, visions, etc.).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INTEGER PRIMARY KEY | ID auto-incrémenté |
| `game_id` | INTEGER | Clé étrangère vers `games` |
| `night_number` | INTEGER | Numéro de la nuit |
| `action_type` | TEXT | "kill", "see", "save", "poison", "love", "shoot" |
| `actor_id` | TEXT | ID du rôle acteur |
| `target_id` | TEXT | ID de la cible (NULL si aucune) |
| `created_at` | INTEGER | Timestamp Unix de l'action |

**Index:** `idx_night_actions_game`

### Table `witch_potions`

Stocke l'état des potions de la sorcière.

| Colonne | Type | Description |
|---------|------|-------------|
| `game_id` | INTEGER PRIMARY KEY | Clé étrangère vers `games` |
| `life_potion_used` | INTEGER | 1 si potion de vie utilisée |
| `death_potion_used` | INTEGER | 1 si potion de mort utilisée |

### Table `action_log`

Journal d'événements pour historique et debug.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INTEGER PRIMARY KEY | ID auto-incrémenté |
| `game_id` | INTEGER | Clé étrangère vers `games` |
| `action_text` | TEXT | Description de l'action |
| `timestamp` | INTEGER | Timestamp Unix de l'événement |

**Index:** `idx_action_log_game`

### Table `config`

Configuration et versioning du schéma.

| Colonne | Type | Description |
|---------|------|-------------|
| `key` | TEXT PRIMARY KEY | Clé de configuration |
| `value` | TEXT | Valeur |
| `updated_at` | INTEGER | Timestamp Unix de MAJ |

## API GameDatabase

### Configuration

```javascript
const GameDatabase = require('./database/db');

// Utiliser le chemin par défaut (./data/werewolf.db)
const db = new GameDatabase();

// Ou spécifier un chemin personnalisé
const db = new GameDatabase('/path/to/custom.db');
```

### Méthodes principales

#### Parties

```javascript
// Créer une partie
const gameId = db.createGame(channelId, {
  lobbyHostId: 'user_id',
  minPlayers: 5,
  maxPlayers: 10,
  disableVoiceMute: false
});

// Récupérer une partie
const game = db.getGame(channelId);

// Mettre à jour une partie
db.updateGame(channelId, {
  phase: 'Jour',
  dayCount: 2,
  captainId: 'user_id'
});

// Supprimer une partie
db.deleteGame(channelId);

// Lister toutes les parties actives
const games = db.getAllGames();
```

#### Joueurs

```javascript
// Ajouter un joueur
db.addPlayer(channelId, userId, username);

// Récupérer les joueurs
const players = db.getPlayers(channelId);

// Mettre à jour un joueur
db.updatePlayer(channelId, userId, {
  role: 'loup-garou',
  alive: false
});

// Supprimer un joueur
db.removePlayer(channelId, userId);
```

#### Votes

```javascript
// Enregistrer un vote
db.addVote(channelId, voterId, targetId, 'village', roundNumber);

// Récupérer les votes (retourne une Map)
const votes = db.getVotes(channelId, 'village', roundNumber);

// Effacer les votes
db.clearVotes(channelId, 'village', roundNumber);
```

#### Actions nocturnes

```javascript
// Enregistrer une action
db.addNightAction(channelId, nightNumber, 'kill', actorId, targetId);

// Récupérer les actions d'une nuit
const actions = db.getNightActions(channelId, nightNumber);
```

#### Potions de la sorcière

```javascript
// Initialiser les potions
db.initWitchPotions(channelId);

// Vérifier les potions disponibles
const potions = db.getWitchPotions(channelId);
// { life: true, death: false }

// Utiliser une potion
db.useWitchPotion(channelId, 'life');
```

#### Logs

```javascript
// Ajouter un log
db.addLog(channelId, 'Joueur X éliminé');

// Récupérer les logs
const logs = db.getLogs(channelId, 100); // 100 dernières entrées
```

#### Amoureux

```javascript
// Définir un couple
db.setLovers(channelId, lover1Id, lover2Id);

// Récupérer le couple
const lovers = db.getLovers(channelId);
// ['user_id_1', 'user_id_2']
```

#### Utilitaires

```javascript
// Transactions ACID
db.transaction(() => {
  db.addPlayer(channelId, userId, username);
  db.updateGame(channelId, { dayCount: 1 });
})();

// Backup
db.backup('./backup/werewolf-backup.db');

// Fermer la connexion
db.close();
```

## Performances

### Optimisations activées

- **WAL Mode**: Write-Ahead Logging pour meilleures performances
- **Foreign Keys**: Contraintes d'intégrité activées
- **Indexes**: 8 index sur colonnes critiques
- **Prepared Statements**: Toutes les requêtes utilisent des statements préparés

### Benchmarks (estimés)

| Opération | Temps moyen | Notes |
|-----------|-------------|-------|
| Create game | < 1ms | Insertion simple avec transaction |
| Add player | < 1ms | Insertion avec contrainte UNIQUE |
| Update game | < 1ms | UPDATE avec index sur channel_id |
| Get players | < 2ms | SELECT avec JOIN si nécessaire |
| Add vote | < 1ms | INSERT avec UPSERT |
| Get all games | < 5ms | Scan complet de la table games |

## Backup et Restauration

### Backup automatique

Le bot effectue des backups automatiques via `BackupManager` (`database/backup.js`) :
- **Horaire** : backup toutes les heures avec rotation (24 derniers conservés)
- **Au shutdown** : backup lors du graceful shutdown (SIGTERM/SIGINT)
- **Premier backup** : 5 minutes après le démarrage
- Utilise l'API native `better-sqlite3` `.backup()` pour des copies atomiques

```bash
# Backup manuel
npm run backup
```

### Restauration

```bash
# Arrêter le bot
pm2 stop werewolf-bot

# Restaurer le backup
cp data/backups/werewolf-backup.db data/werewolf.db

# Redémarrer le bot
pm2 start werewolf-bot
```

## Dépannage

### Base corrompue

Si la base de données est corrompue:

```bash
# Vérifier l'intégrité
sqlite3 data/werewolf.db "PRAGMA integrity_check;"

# Si corrompu, essayer de récupérer
sqlite3 data/werewolf.db ".dump" | sqlite3 data/werewolf-recovered.db
```

### Permissions

Assurez-vous que le bot a les permissions d'écriture:

```bash
chmod 644 data/werewolf.db
chown bot-user:bot-group data/werewolf.db
```

### Lock database

Si "database is locked":

1. Vérifier qu'une seule instance du bot tourne
2. Augmenter le timeout: `db.pragma('busy_timeout = 5000');`
3. Vérifier qu'aucun processus SQLite externe n'est ouvert

## Tests

Les tests utilisent un mock de GameDatabase pour éviter les dépendances:

```javascript
// tests/__mocks__/database/db.js
jest.mock('../database/db');

// Les tests s'exécutent avec la version mockée
```

## Évolutions futures

- [ ] Compression avec VACUUM automatique
- [ ] Encryption at rest (SQLCipher)
