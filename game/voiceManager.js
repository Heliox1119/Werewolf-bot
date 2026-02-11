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
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });

      connection.on(VoiceConnectionStatus.Ready, () => {
        logger.info('Voice connected', { channelId: voiceChannel.id, channelName: voiceChannel.name });
      });

      connection.on(VoiceConnectionStatus.Disconnected, () => {
        logger.warn('Voice disconnected', { channelId: voiceChannel.id, channelName: voiceChannel.name });
      });

      this.connections.set(voiceChannel.id, connection);
      return connection;
    } catch (error) {
      logger.error('Voice connection error', error);
      return null;
    }
  }

  async playSound(voiceChannelId, soundFile) {
    try {
      const connection = this.connections.get(voiceChannelId);
      if (!connection) {
        logger.error('No voice connection', { voiceChannelId });
        return false;
      }

      const soundPath = path.join(__dirname, '..', 'audio', soundFile);
      if (!existsSync(soundPath)) {
        logger.error('Audio file not found', { soundFile, soundPath });
        return false;
      }
      const resource = createAudioResource(createReadStream(soundPath));
      
      let player = this.players.get(voiceChannelId);
      if (!player) {
        player = createAudioPlayer();
        this.players.set(voiceChannelId, player);
        connection.subscribe(player);
      }

      // If there's an active loop for this channel, cancel it first
      if (this.loops.has(voiceChannelId)) {
        this.loops.delete(voiceChannelId);
      }

      player.play(resource);
      logger.info('Sound played', { soundFile, voiceChannelId });
      return true;
    } catch (error) {
      logger.error('playSound error', error);
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
        logger.error('Audio file not found for loop', { soundFile, soundPath });
        return false;
      }

      // stop any existing loop for this channel
      this.stopLoop(voiceChannelId);

      let player = this.players.get(voiceChannelId);
      if (!player) {
        player = createAudioPlayer();
        this.players.set(voiceChannelId, player);
        connection.subscribe(player);
      }

      const playOnce = () => {
        const resource = createAudioResource(createReadStream(soundPath));
        try { player.play(resource); } catch (e) { logger.error('loop play error', e); }
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
      logger.info('Loop started', { soundFile, voiceChannelId });
      return true;
    } catch (err) {
      logger.error('startLoop error', err);
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
      logger.info('Loop stopped', { voiceChannelId });
      return true;
    } catch (err) {
      logger.error('stopLoop error', err);
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
      logger.info('Voice disconnected', { voiceChannelId });
    }
  }
}

module.exports = new VoiceManager();
