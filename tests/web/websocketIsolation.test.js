const WebServer = require('../../web/server');

function createServerForSocketTests() {
  const gameManager = {
    games: new Map(),
    getAllGames: jest.fn(() => [])
  };

  const client = {
    guilds: {
      cache: new Map([
        ['111111111111111111', { id: '111111111111111111', name: 'GuildOne' }]
      ])
    }
  };

  const server = new WebServer({ gameManager, client, db: {} });

  let connectionHandler = null;
  const roomEmitter = { emit: jest.fn() };
  server.io = {
    use: jest.fn(),
    on: jest.fn((eventName, handler) => {
      if (eventName === 'connection') {
        connectionHandler = handler;
      }
    }),
    to: jest.fn(() => roomEmitter)
  };

  server._setupSocketIO();

  const handlers = {};
  const socket = {
    id: 'sock-1',
    rooms: new Set(['sock-1']),
    request: {
      session: {
        passport: {
          user: {
            id: 'user-1',
            guilds: [{ id: '111111111111111111' }]
          }
        }
      }
    },
    on: jest.fn((eventName, handler) => {
      handlers[eventName] = handler;
    }),
    emit: jest.fn(),
    join: jest.fn((room) => socket.rooms.add(room)),
    leave: jest.fn((room) => socket.rooms.delete(room))
  };

  connectionHandler(socket);

  return { server, socket, handlers };
}

describe('WebSocket isolation', () => {
  test('rejects malicious joinGuild to unauthorized guild room', () => {
    const { socket, handlers } = createServerForSocketTests();

    handlers.joinGuild('222222222222222222');

    expect(socket.join).not.toHaveBeenCalledWith('guild:222222222222222222');
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized guild' });
  });

  test('allows joinGuild only for server-validated membership', () => {
    const { socket, handlers } = createServerForSocketTests();

    handlers.joinGuild('111111111111111111');

    expect(socket.join).toHaveBeenCalledWith('guild:111111111111111111');
    expect(socket.emit).toHaveBeenCalledWith('joinedGuild', { guildId: '111111111111111111' });
  });

  test('rejects spectate for a game in an unauthorized guild', () => {
    const { server, socket, handlers } = createServerForSocketTests();
    server.gameManager.games.set('game-unauthorized', {
      mainChannelId: 'game-unauthorized',
      guildId: '222222222222222222'
    });

    handlers.spectate('game-unauthorized');

    expect(socket.join).not.toHaveBeenCalledWith('game:game-unauthorized');
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized game' });
  });

  test('throttles guild-scoped broadcasts and emits latest payload after window', async () => {
    jest.useFakeTimers();
    const { server } = createServerForSocketTests();

    const roomEmitter = { emit: jest.fn() };
    server.io.to = jest.fn(() => roomEmitter);

    server._emitGuildScopedThrottled('111111111111111111', 'globalEvent', { seq: 1 }, 250);
    server._emitGuildScopedThrottled('111111111111111111', 'globalEvent', { seq: 2 }, 250);
    server._emitGuildScopedThrottled('111111111111111111', 'globalEvent', { seq: 3 }, 250);

    expect(roomEmitter.emit).toHaveBeenCalledTimes(1);
    expect(roomEmitter.emit).toHaveBeenNthCalledWith(1, 'globalEvent', { seq: 1 });

    await jest.advanceTimersByTimeAsync(260);

    expect(roomEmitter.emit).toHaveBeenCalledTimes(2);
    expect(roomEmitter.emit).toHaveBeenNthCalledWith(2, 'globalEvent', { seq: 3 });
    jest.useRealTimers();
  });
});
