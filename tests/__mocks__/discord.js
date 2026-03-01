// Mock Discord.js pour les tests

/**
 * Minimal Discord Collection mimic (extends Map with find/filter/first)
 */
class MockCollection extends Map {
  find(fn) {
    for (const [key, val] of this) {
      if (fn(val, key, this)) return val;
    }
    return undefined;
  }
  filter(fn) {
    const result = new MockCollection();
    for (const [key, val] of this) {
      if (fn(val, key, this)) result.set(key, val);
    }
    return result;
  }
  first(n) {
    if (n === undefined) {
      return this.values().next().value;
    }
    const arr = [];
    let count = 0;
    for (const val of this.values()) {
      if (count >= n) break;
      arr.push(val);
      count++;
    }
    return arr;
  }
  map(fn) {
    const arr = [];
    for (const [key, val] of this) {
      arr.push(fn(val, key, this));
    }
    return arr;
  }
}

class MockUser {
  constructor(id = '123456', username = 'TestUser') {
    this.id = id;
    this.username = username;
    this.tag = `${username}#0000`;
    this.bot = false;
  }

  async send(content) {
    return { content, id: 'message-' + Date.now() };
  }

  async fetch() {
    return this;
  }
}

class MockMessage {
  constructor(content = '', channelId = '999') {
    this.id = 'msg-' + Date.now();
    this.content = content;
    this.channelId = channelId;
    this.author = new MockUser();
    this.embeds = [];
    this.components = [];
    this.files = [];
  }

  async edit(options) {
    if (options.embeds) this.embeds = options.embeds;
    if (options.components) this.components = options.components;
    return this;
  }

  async delete() {
    return this;
  }

  createMessageComponentCollector(options = {}) {
    const EventEmitter = require('events');
    const collector = new EventEmitter();
    collector._ended = false;
    collector.stop = jest.fn((reason) => {
      if (!collector._ended) {
        collector._ended = true;
        collector.emit('end', [], reason || 'user');
      }
    });
    // Auto-end after a short delay for testing
    const autoEndTimeout = setTimeout(() => {
      if (!collector._ended) {
        collector._ended = true;
        collector.emit('end', [], 'time');
      }
    }, 10);
    if (typeof autoEndTimeout.unref === 'function') {
      autoEndTimeout.unref();
    }
    return collector;
  }
}

class MockChannel {
  constructor(id = 'channel-123', type = 0) {
    this.id = id;
    this.type = type;
    this.name = 'test-channel';
    this.parentId = null;
    this.messages = [];
    this.permissionOverwrites = new Map();
  }

  async send(options) {
    const msg = new MockMessage(options.content || '', this.id);
    if (options.embeds) msg.embeds = options.embeds;
    if (options.components) msg.components = options.components;
    if (options.files) msg.files = options.files;
    this.messages.push(msg);
    return msg;
  }

  async delete() {
    return this;
  }

  async fetch() {
    return this;
  }

  permissionsFor(user) {
    return {
      has: jest.fn(() => true)
    };
  }
}

class MockVoiceChannel extends MockChannel {
  constructor(id = 'voice-123') {
    super(id, 2);
    this.members = new Map();
  }
}

class MockGuild {
  constructor(id = 'guild-123') {
    this.id = id;
    this.name = 'Test Guild';
    this.channels = {
      cache: new MockCollection(),
      fetch: jest.fn(async (channelId) => {
        return this.channels.cache.get(channelId) || new MockChannel(channelId);
      }),
      create: jest.fn(async (options) => {
        const channel = options.type === 2 ? 
          new MockVoiceChannel('voice-' + Date.now()) :
          new MockChannel('channel-' + Date.now());
        channel.name = options.name;
        channel.parentId = options.parent;
        if (options.type === 4) { // GuildCategory
          channel.type = 4;
        }
        this.channels.cache.set(channel.id, channel);
        return channel;
      })
    };
    this.members = {
      me: { id: 'bot-123' },
      cache: new MockCollection(),
      fetch: jest.fn(async (userId) => {
        return { user: new MockUser(userId), id: userId };
      })
    };
    this.roles = {
      cache: new MockCollection(),
      everyone: { id: 'everyone-role' }
    };
  }
}

class MockInteraction {
  constructor(commandName = 'test', channelId = 'channel-123', userId = 'user-123') {
    this.commandName = commandName;
    this.channelId = channelId;
    this.user = new MockUser(userId);
    this.guild = new MockGuild();
    this.guildId = this.guild.id;
    this.client = new MockClient();
    this.replied = false;
    this.deferred = false;
    this.member = {
      permissions: {
        has: jest.fn(() => true)
      }
    };
    this.options = {
      getInteger: jest.fn(() => null),
      getString: jest.fn(() => null),
      getUser: jest.fn(() => null),
      getBoolean: jest.fn(() => null),
      getSubcommand: jest.fn(() => null),
      getChannel: jest.fn(() => null)
    };
    this._replyContent = null;
    this._replyMessage = null;
  }

  async reply(options) {
    this.replied = true;
    this._replyContent = options;
    const msg = new MockMessage(options.content || '', this.channelId);
    if (options.embeds) msg.embeds = options.embeds;
    if (options.components) msg.components = options.components;
    // Support awaitMessageComponent on the reply message
    msg.awaitMessageComponent = jest.fn();
    this._replyMessage = msg;
    // withResponse: true returns { resource: { message } } wrapper
    if (options && options.withResponse) {
      return { resource: { message: msg } };
    }
    return msg;
  }

  async deferReply(options) {
    this.deferred = true;
    return;
  }

  async editReply(options) {
    this._replyContent = options;
    const msg = new MockMessage(options.content || options, this.channelId);
    return msg;
  }

  async followUp(options) {
    return new MockMessage(options.content || '', this.channelId);
  }
}

class MockClient {
  constructor() {
    this.user = new MockUser('bot-123', 'TestBot');
    this.guilds = {
      cache: new Map()
    };
    this.users = {
      cache: new Map(),
      fetch: jest.fn(async (userId) => new MockUser(userId))
    };
  }
}

// Builders Mock
class MockEmbedBuilder {
  constructor() {
    this.data = {};
  }
  setTitle(title) { this.data.title = title; return this; }
  setDescription(desc) { this.data.description = desc; return this; }
  setColor(color) { this.data.color = color; return this; }
  addFields(...fields) { this.data.fields = [...(this.data.fields || []), ...fields]; return this; }
  setImage(url) { this.data.image = url; return this; }
  setThumbnail(url) { this.data.thumbnail = url; return this; }
  setFooter(footer) { this.data.footer = footer; return this; }
  setTimestamp(ts) { this.data.timestamp = ts || true; return this; }
  toJSON() { return { ...this.data }; }
  static from(embed) { 
    const builder = new MockEmbedBuilder();
    builder.data = { ...embed.data };
    return builder;
  }
}

class MockActionRowBuilder {
  constructor() {
    this.components = [];
  }
  addComponents(...components) {
    this.components.push(...components);
    return this;
  }
}

class MockButtonBuilder {
  constructor() {
    this.data = {};
  }
  setCustomId(id) { this.data.customId = id; return this; }
  setLabel(label) { this.data.label = label; return this; }
  setStyle(style) { this.data.style = style; return this; }
  setDisabled(disabled) { this.data.disabled = disabled; return this; }
}

class MockStringSelectMenuBuilder {
  constructor() {
    this.data = { customId: null, placeholder: null, options: [] };
  }
  setCustomId(id) { this.data.customId = id; return this; }
  setPlaceholder(ph) { this.data.placeholder = ph; return this; }
  addOptions(options) { this.data.options.push(...(Array.isArray(options) ? options : [options])); return this; }
}

const ButtonStyle = {
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5
};

const MessageFlags = {
  Ephemeral: 64
};

const GatewayIntentBits = {
  Guilds: 1,
  GuildMembers: 2,
  GuildVoiceStates: 128,
  DirectMessages: 4096
};

const PermissionFlagsBits = {
  Administrator: 8n,
  ManageGuild: 32n,
  ManageChannels: 16n
};

const ChannelType = {
  GuildText: 0,
  GuildVoice: 2,
  GuildCategory: 4
};

const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3
};

module.exports = {
  Client: MockClient,
  User: MockUser,
  Message: MockMessage,
  Channel: MockChannel,
  VoiceChannel: MockVoiceChannel,
  Guild: MockGuild,
  Interaction: MockInteraction,
  EmbedBuilder: MockEmbedBuilder,
  ActionRowBuilder: MockActionRowBuilder,
  ButtonBuilder: MockButtonBuilder,
  StringSelectMenuBuilder: MockStringSelectMenuBuilder,
  ButtonStyle,
  MessageFlags,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
  ComponentType,
  SlashCommandBuilder: class {
    setName(name) { this.name = name; return this; }
    setDescription(desc) { this.description = desc; return this; }
    setDefaultMemberPermissions(perm) { return this; }
    addSubcommand(fn) { fn({ setName: () => ({ setDescription: () => ({ addChannelOption: () => ({ addChannelTypes: () => ({ setRequired: () => ({}) }) }), addStringOption: () => ({ setRequired: () => ({}) }), addIntegerOption: () => ({ setMinValue: () => ({ setMaxValue: () => ({ setRequired: () => ({}) }) }) }), addBooleanOption: () => ({ setRequired: () => ({}) }) }) }) }); return this; }
    addIntegerOption(fn) { return this; }
    addStringOption(fn) { return this; }
    addUserOption(fn) { return this; }
  },
  Collection: MockCollection,
  REST: jest.fn(),
  Routes: {}
};
