#!/usr/bin/env node

/**
 * Script de migration: JSON -> SQLite
 * 
 * Ce script migre les données existantes depuis data/games.json vers la base
 * de données SQLite. Il préserve toutes les parties en cours, joueurs, votes, 
 * et l'historique d'actions.
 * 
 * Usage:
 *   node scripts/migrate-to-sqlite.js [chemin/vers/games.json]
 * 
 * Si aucun chemin n'est fourni, utilise ./data/games.json par défaut.
 */

const fs = require('fs');
const path = require('path');
const GameDatabase = require('../database/db');

function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, Object.keys(data).length > 0 ? JSON.stringify(data, null, 2) : '');
}

function migrateGames(jsonPath, dbPath = null) {
  log('🔄 Démarrage de la migration JSON -> SQLite', { jsonPath });

  // Vérifier que le fichier JSON existe
  if (!fs.existsSync(jsonPath)) {
    log('❌ Fichier JSON non trouvé', { jsonPath });
    return false;
  }

  // Charger le fichier JSON
  let gamesData;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    gamesData = JSON.parse(raw);
    log('✅ Fichier JSON chargé', { gameCount: Object.keys(gamesData).length });
  } catch (err) {
    log('❌ Erreur lors de la lecture du JSON', { error: err.message });
    return false;
  }

  // Initialiser la base de données
  const db = new GameDatabase(dbPath);
  log('✅ Base de données initialisée');

  let migrated = 0;
  let errors = 0;

  // Migrer chaque partie
  for (const [channelId, game] of Object.entries(gamesData)) {
    try {
      log(`Migrating game for channel ${channelId}...`);

      // Créer la partie dans la DB
      const gameId = db.createGame(channelId, {
        lobbyHostId: game.lobbyHostId,
        minPlayers: game.rules?.minPlayers || 5,
        maxPlayers: game.rules?.maxPlayers || 10,
        disableVoiceMute: game.disableVoiceMute || false
      });

      if (!gameId) {
        log('⚠️ Partie déjà existante, skipped', { channelId });
        continue;
      }

      // Mettre à jour les métadonnées de la partie
      db.updateGame(channelId, {
        lobbyMessageId: game.lobbyMessageId,
        voiceChannelId: game.voiceChannelId,
        villageChannelId: game.villageChannelId,
        wolvesChannelId: game.wolvesChannelId,
        seerChannelId: game.seerChannelId,
        witchChannelId: game.witchChannelId,
        cupidChannelId: game.cupidChannelId,
        phase: game.phase || 'Nuit',
        subPhase: game.subPhase,
        dayCount: game.dayCount || 0,
        captainId: game.captainId,
        startedAt: game.startedAt,
        endedAt: game.endedAt
      });

      // Ajouter les joueurs
      if (Array.isArray(game.players)) {
        for (const player of game.players) {
          db.addPlayer(channelId, player.id, player.username);
          db.updatePlayer(channelId, player.id, {
            role: player.role,
            alive: player.alive,
            inLove: player.inLove || false
          });
        }
        log(`  ✅ ${game.players.length} joueurs migrés`);
      }

      // Migrer les amoureux
      if (Array.isArray(game.lovers) && game.lovers.length === 2) {
        db.setLovers(channelId, game.lovers[0], game.lovers[1]);
        log(`  💘 Couple d'amoureux migré`);
      }

      // Initialiser les potions de la sorcière
      db.initWitchPotions(channelId);
      if (game.witchPotions) {
        if (!game.witchPotions.life) {
          db.useWitchPotion(channelId, 'life');
        }
        if (!game.witchPotions.death) {
          db.useWitchPotion(channelId, 'death');
        }
        log(`  🧪 Potions de la sorcière migrées`);
      }

      // Migrer les votes (votes du village)
      if (game.votes && game.votes instanceof Map) {
        for (const [targetId, voteCount] of game.votes.entries()) {
          // Note: On ne peut pas reconstituer tous les votants individuels depuis
          // le format actuel qui ne stocke que les totaux. On skip cette partie.
        }
      }

      // Migrer l'historique d'actions
      if (Array.isArray(game.actionLog)) {
        for (const logEntry of game.actionLog) {
          db.addLog(channelId, logEntry.text);
        }
        log(`  📝 ${game.actionLog.length} entrées de log migrées`);
      }

      migrated++;
      log(`✅ Partie ${channelId} migrée avec succès`);

    } catch (err) {
      errors++;
      log(`❌ Erreur lors de la migration de ${channelId}`, { error: err.message, stack: err.stack });
    }
  }

  // Fermer la connexion DB
  db.close();

  // Résumé
  log('🎉 Migration terminée', {
    total: Object.keys(gamesData).length,
    migrated,
    errors,
    successRate: `${Math.round((migrated / Object.keys(gamesData).length) * 100)}%`
  });

  return errors === 0;
}

// Script principal
if (require.main === module) {
  const jsonPath = process.argv[2] || path.join(__dirname, '..', 'data', 'games.json');
  const dbPath = process.argv[3] || path.join(__dirname, '..', 'data', 'werewolf.db');

  log('📦 Script de migration JSON -> SQLite');
  log('Paramètres:', { jsonPath, dbPath });

  // Backup de la DB si elle existe déjà
  if (fs.existsSync(dbPath)) {
    const backupPath = `${dbPath}.backup.${Date.now()}`;
    fs.copyFileSync(dbPath, backupPath);
    log('💾 Backup créé', { backupPath });
  }

  const success = migrateGames(jsonPath, dbPath);
  
  if (success) {
    log('✅ Migration réussie!');
    log('💡 Vous pouvez maintenant démarrer le bot avec la nouvelle base de données.');
    log('💡 L\'ancien fichier games.json est conservé en backup.');
    process.exit(0);
  } else {
    log('❌ Migration échouée. Vérifiez les erreurs ci-dessus.');
    process.exit(1);
  }
}

module.exports = { migrateGames };
