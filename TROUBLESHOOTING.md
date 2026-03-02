# 🔧 Troubleshooting Guide

## Discord API Errors

### Error 10062 — Unknown Interaction (Expired)

**Cause:** Interaction not deferred/replied within 3 seconds.

**The 3-second rule:** Discord invalidates any interaction not acknowledged within 3s. Always defer first.

```javascript
// ✅ Correct — defer immediately
if (!await checkCategoryAndDefer(interaction)) return;
// ... slow logic ...
await interaction.editReply('Done');

// ❌ Wrong — slow logic before reply
const data = await fetchSomething(); // may take > 3s
await interaction.reply('Done'); // 10062 if expired
```

**If a game is stuck after an expired interaction:**
```
/force-end                         # Force-end from any channel
/force-end channel-id:123456789    # Target specific game
/debug-games                       # List all active games
```

### Error 40060 — Interaction Already Replied

**Cause:** `reply()` called after `deferReply()` or another `reply()`.

**Solution:** After `deferReply()`, always use `editReply()`.

### Error 10008 — Unknown Message

**Cause:** Trying to edit/delete a message that was already deleted.

**Solution:** The bot wraps all message operations in try/catch. If you see this in logs, it's handled gracefully.

---

## Gameplay Issues

### Players stuck on mute after `/end`
The bot automatically unmutes all players when a game ends. If mute persists:
1. Check the bot has `Mute Members` permission
2. Use `/debug-voicemute` to toggle voice muting off

### Duplicate channels
Use `/clear` to clean up orphaned game channels. Auto-cleanup runs on inactive lobbies after 1h.

### Lobby not starting
- Verify minimum player count is met (check with `/setrules`)
- Ensure the bot has `Manage Channels` + `Manage Roles` permissions
- The category must be configured: run `/setup wizard`

### Game stuck / not advancing
- Use `/nextphase` to force advance
- Use `/debug-info` to inspect current state
- If truly stuck, use `/force-end` and start a new game

---

## Audio Issues

### Bot doesn't play sounds
1. Verify audio files exist in `./audio/` (`night_ambience.mp3`, `day_ambience.mp3`, etc.)
2. Bot needs `Connect` + `Speak` permissions in the voice channel
3. FFmpeg must be available (included in Docker; for manual install: `npm install ffmpeg-static`)

---

## Development

### Common patterns

```javascript
// Always check game exists
const game = gameManager.games.get(channelId);
if (!game) return interaction.editReply(t('errors.no_game'));

// Always check player state
const { inGame, alive, player } = isPlayerInGame(game, userId);

// Always defer before slow operations
if (!await checkCategoryAndDefer(interaction)) return;
```

### Logging
Set `LOG_LEVEL` in `.env` (DEBUG | INFO | WARN | ERROR | NONE):
```env
LOG_LEVEL=DEBUG    # Show all logs including debug
```

Use `/debug-info` (admin) to inspect game state at runtime.

---

## Deployment Checklist

- [ ] `.env` configured: `TOKEN`, `CLIENT_ID`, `GUILD_ID`
- [ ] Node.js ≥ 20 installed
- [ ] Dependencies installed: `npm install`
- [ ] Audio files in `./audio/` (optional)
- [ ] Discord bot permissions: Manage Channels, Manage Roles, Connect, Speak, Send Messages, Mute Members
- [ ] Run `/setup wizard` on first launch to configure the game category
- [ ] (Optional) Set `WEB_PORT`, `CLIENT_SECRET`, `SESSION_SECRET` for web dashboard

### Docker deployment
```bash
docker compose up -d
docker compose logs -f    # Verify startup
```

### Manual restart
```bash
npm start                 # Standard start
npm run health            # Verify health
```

---

## Useful Commands

| Command | Purpose |
|---------|---------|
| `/debug-info` | Inspect current game state |
| `/debug-games` | List all active games |
| `/debug-reset` | Delete a game |
| `/force-end` | Force-end any game |
| `/clear` | Clean up game channels |
| `npm run health` | Check bot health |
| `npm test` | Run test suite |
