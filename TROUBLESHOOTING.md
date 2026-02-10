# 🔧 Guide de Dépannage - Werewolf Bot

## Erreurs Discord API

### InteractionNotReplied (10062)
**Cause** : `editReply()` appelé sans `deferReply()` préalable

**Solution** : Utilisez toujours `checkCategoryAndDefer()` au début
```javascript
if (!await checkCategoryAndDefer(interaction)) return;
```

### InteractionAlreadyReplied (40060)
**Cause** : `reply()` appelé après `deferReply()` ou un autre `reply()`

**Solution** : Utilisez `editReply()` après defer
```javascript
await checkCategoryAndDefer(interaction); // defer
await interaction.editReply("Message"); // OK
```

### Unknown Interaction (10062) - Interaction Expired
**Cause** : Interaction non defer/reply dans les 3 secondes

**Symptômes** :
```
[ERROR] [INTERACTION] Interaction expired (10062)
{
  "commandName": "create",
  "age": 3150
}
```

**Solutions** :

1. **Utiliser `/force-end` (v2.0.2+)**
   ```
   /force-end
   /force-end channel-id:123456789
   ```
   Commande admin qui fonctionne **toujours** (bypass interaction).

2. **Réessayer la commande**
   ```
   /end
   ```
   Depuis v2.0.2, `/end` continue même si expiré (channels supprimés quand même).

3. **Utiliser `/debug-games` pour localiser**
   ```
   /debug-games          # Voir toutes les parties
   /force-end channel-id:123456789
   ```

**Note** : v2.0.2+ résout le problème en continuant l'action même si l'interaction expire.

**Documentation complète** : Voir [ERROR_10062.md](ERROR_10062.md)

---

## Problèmes de Gameplay

### Joueurs restent mute après /end
**Cause** : La partie n'est pas marquée comme terminée

**Solution** : Le bot unmute automatiquement maintenant
- Phase "Terminé" détectée automatiquement
- Tous les joueurs sont unmutes dans voiceStateUpdate

### Channels en double
**Cause** : Ancien jeu non nettoyé avant création

**Solution** : Utilisez `/clear` ou le cleanup automatique fonctionne maintenant

### Lobby timeout inactif
**Cause** : Partie créée mais jamais démarrée

**Solution** : Auto-cleanup après 1h d'inactivité (automatique)

---

## Problèmes Audio

### Bot ne joue pas de son
**Vérifications** :
1. Bot est dans le channel vocal
2. Fichiers audio dans `/audio/`
3. Permissions "Speak" du bot
4. ffmpeg-static installé : `npm install ffmpeg-static`

### Son continue après /end
**Solution** : La boucle s'arrête automatiquement au cleanup

---

## Problèmes de Performance

### Lag dans le channel vocal
**Cause** : Trop d'events voiceStateUpdate

**Solution** : Optimisations implémentées
- Cache Discord utilisé
- Check de l'état actuel avant mute/unmute
- Debouncing automatique

### Sauvegardes lentes
**Cause** : Trop de saveState() synchrones

**Solution** : Utilisez `scheduleSave()`
```javascript
// ❌ Avant
try { gameManager.saveState(); } catch (e) {}

// ✅ Maintenant
gameManager.scheduleSave();
```

---

## Erreurs de Développement

### Cannot find module 'utils/...'
**Solution** : Vérifiez les chemins relatifs
```javascript
const { checkCategoryAndDefer } = require("../utils/commands");
```

### Game undefined
**Cause** : Game pas créé ou supprimé

**Solution** : Vérifiez toujours
```javascript
const game = gameManager.games.get(channelId);
if (!game) {
  await interaction.editReply("❌ Aucune partie ici");
  return;
}
```

### Player not in game
**Solution** : Utilisez le validator
```javascript
const { isPlayerInGame } = require("../utils/validators");
const { inGame, alive, player } = isPlayerInGame(game, userId);
```

---

## Logs & Debugging

### Activer les logs détaillés
Modifiez `index.js` :
```javascript
function log(level, ...args) {
  const ts = new Date().toISOString();
  const emoji = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
  console.log(`[${ts}] ${emoji} [${level.toUpperCase()}]`, ...args);
}
```

### Vérifier l'état du jeu
Utilisez `/debug-info` (admin)

### Forcer le nettoyage
Utilisez `/clear` (admin)

---

## Checklist de Déploiement

- [ ] `.env` configuré avec TOKEN, CLIENT_ID, GUILD_ID
- [ ] Node.js ≥ 16.9.0
- [ ] Dependencies installées : `npm install`
- [ ] Dossier `/audio/` avec les fichiers son
- [ ] Permissions bot Discord :
  - Manage Channels
  - Manage Roles
  - Connect/Speak (vocal)
  - Send Messages
  - Mute Members
- [ ] Catégorie Discord créée (ID dans CATEGORY_ID)

---

## Commandes Utiles

### Redémarrage propre
```bash
# Tuer les processus node existants
taskkill /f /im node.exe

# Redémarrer
node index.js
```

### Reset complet
1. `/clear` - Nettoie les channels
2. Supprimer `data/games.json`
3. Redémarrer le bot

### Backup manuel
```bash
# Copier l'état actuel
copy data\games.json data\games.backup.json
```

---

## Support & Contact

Pour les bugs persistants :
1. Vérifiez les logs console
2. Consultez `OPTIMIZATIONS.md`
3. Vérifiez les permissions Discord
4. Testez avec `/debug-info`

---

*Dernière mise à jour : Optimisations consolidation 2026*
