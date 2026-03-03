const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { createReadStream, existsSync } = require('fs');
const path = require('path');
const { game: logger } = require('../utils/logger');

class VoiceManager {
  constructor() {
    this.connections = new Map();
    this.players = new Map();
    this.loops = new Map(); // voiceChannelId -> { soundFile }
  }

  async joinChannel(voiceChannel) {
    try {
      // Nettoyer une connexion existante pour éviter les fuites de listeners
      const existing = this.connections.get(voiceChannel.id);
      if (existing) {
        try { existing.destroy(); } catch (e) { /* ignore */ }
        this.connections.delete(voiceChannel.id);
        this.players.delete(voiceChannel.id);
      }

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });

      connection.on(VoiceConnectionStatus.Ready, () => {
        logger.info('VOICE_CONNECTED', { channelId: voiceChannel.id, channelName: voiceChannel.name });
      });

      connection.on(VoiceConnectionStatus.Disconnected, () => {
        logger.warn('VOICE_DISCONNECTED', { channelId: voiceChannel.id, channelName: voiceChannel.name });
      });

      // Catch network/DNS errors on the underlying socket so they don't
      // bubble up as uncaughtException and crash the entire bot.
      connection.on('error', (err) => {
        logger.warn('VOICE_CONNECTION_NETWORK_ERROR', {
          channelId: voiceChannel.id,
          code: err.code,
          message: err.message,
        });
      });

      this.connections.set(voiceChannel.id, connection);
      return connection;
    } catch (error) {
      logger.error('VOICE_CONNECTION_ERROR', error);
      return null;
    }
  }

  async playSound(voiceChannelId, soundFile) {
    try {
      const connection = this.connections.get(voiceChannelId);
      if (!connection) {
        logger.error('VOICE_NO_CONNECTION', { voiceChannelId });
        return false;
      }

      const soundPath = path.join(__dirname, '..', 'audio', soundFile);
      if (!existsSync(soundPath)) {
        logger.error('AUDIO_FILE_NOT_FOUND', { soundFile, soundPath });
        return false;
      }
      const resource = createAudioResource(createReadStream(soundPath));
      
      let player = this.players.get(voiceChannelId);
      if (!player) {
        player = createAudioPlayer();
        player.on('error', (err) => {
          logger.warn('AUDIO_PLAYER_ERROR', { voiceChannelId, code: err.code, message: err.message });
        });
        this.players.set(voiceChannelId, player);
        connection.subscribe(player);
      }

      // If there's an active loop for this channel, cancel it first
      if (this.loops.has(voiceChannelId)) {
        this.loops.delete(voiceChannelId);
      }

      player.play(resource);
      logger.info('SOUND_PLAYED', { soundFile, voiceChannelId });
      return true;
    } catch (error) {
      logger.error('PLAY_SOUND_ERROR', error);
      return false;
    }
  }

  // Start looping a given sound file until stopLoop is called for the channel
  async startLoop(voiceChannelId, soundFile) {
    try {
      const connection = this.connections.get(voiceChannelId);
      if (!connection) return false;

      const soundPath = path.join(__dirname, '..', 'audio', soundFile);
      if (!existsSync(soundPath)) {
        logger.error('AUDIO_FILE_NOT_FOUND_FOR_LOOP', { soundFile, soundPath });
        return false;
      }

      // stop any existing loop for this channel
      this.stopLoop(voiceChannelId);

      let player = this.players.get(voiceChannelId);
      if (!player) {
        player = createAudioPlayer();
        player.on('error', (err) => {
          logger.warn('AUDIO_PLAYER_LOOP_ERROR', { voiceChannelId, code: err.code, message: err.message });
        });
        this.players.set(voiceChannelId, player);
        connection.subscribe(player);
      }

      const playOnce = () => {
        const resource = createAudioResource(createReadStream(soundPath));
        try { player.play(resource); } catch (e) { logger.error('LOOP_PLAY_ERROR', e); }
      };

      // on idle, replay if loop still active
      const onState = (oldState, newState) => {
        if (newState.status === AudioPlayerStatus.Idle && this.loops.has(voiceChannelId)) {
          // small delay to avoid hammering
          setTimeout(() => playOnce(), 200);
        }
      };

      player.on('stateChange', onState);

      // store loop meta so we can stop it later
      this.loops.set(voiceChannelId, { soundFile, onState });

      // start first play
      playOnce();
      logger.info('LOOP_STARTED', { soundFile, voiceChannelId });
      return true;
    } catch (err) {
      logger.error('START_LOOP_ERROR', err);
      return false;
    }
  }

  stopLoop(voiceChannelId) {
    try {
      const meta = this.loops.get(voiceChannelId);
      if (!meta) return false;
      const player = this.players.get(voiceChannelId);
      if (player && meta.onState) {
        try { player.off('stateChange', meta.onState); } catch (e) { /* ignore */ }
      }
      this.loops.delete(voiceChannelId);
      logger.info('LOOP_STOPPED', { voiceChannelId });
      return true;
    } catch (err) {
      logger.error('STOP_LOOP_ERROR', err);
      return false;
    }
  }

  disconnect(voiceChannelId) {
    const connection = this.connections.get(voiceChannelId);
    if (connection) {
      // stop any loop for this channel
      try { this.stopLoop(voiceChannelId); } catch (e) { /* ignore */ }
      connection.destroy();
      this.connections.delete(voiceChannelId);
      this.players.delete(voiceChannelId);
      logger.info('VOICE_DISCONNECTED', { voiceChannelId });
    }
  }
}

module.exports = new VoiceManager();
