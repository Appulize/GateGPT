/** @jest-environment node */

const fs = require('fs');
const os = require('os');
const path = require('path');

const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gategpt-messaging-'));
process.env.SESSION_DIR = sessionDir;

jest.mock('whatsapp-web.js', () => {
  const EventEmitter = require('events');
  const clients = [];

  class Client extends EventEmitter {
    constructor() {
      super();
      this.pupPage = { evaluate: jest.fn(async fn => fn()) };
      this.getChatById = jest.fn(async id => ({ id: { _serialized: id } }));
      clients.push(this);
    }
    initialize() {}
  }

  return {
    Client,
    LocalAuth: class LocalAuth {},
    Location: class Location {},
    __clients: clients
  };
});

jest.mock('qrcode', () => ({ toFile: jest.fn() }));
jest.mock('qrcode-terminal', () => ({ generate: jest.fn() }));
jest.mock('../notifications', () => ({ sendPushoverNotification: jest.fn() }));

const wweb = require('whatsapp-web.js');
const { sendPushoverNotification } = require('../notifications');
const {
  initMessaging,
  getChatById,
  getChatForMessage,
  installMessageIdGuard
} = require('../messaging');

function createMsgStore(getMessagesById) {
  return { getMessagesById: jest.fn(getMessagesById) };
}

describe('installMessageIdGuard', () => {
  afterEach(() => {
    delete global.window;
  });

  test('keeps IndexedDB away from ids WhatsApp Web no longer serialises', async () => {
    const store = createMsgStore(async () => {
      throw new Error("DataError: Failed to execute 'get' on 'IDBObjectStore'");
    });
    const original = store.getMessagesById;
    global.window = { Store: { Msg: store } };

    expect(installMessageIdGuard()).toBe(true);

    // whatsapp-web.js passes `chat.lastReceivedKey._serialized`, now undefined
    await expect(window.Store.Msg.getMessagesById([undefined])).resolves.toEqual({
      messages: []
    });
    expect(original).not.toHaveBeenCalled();
  });

  test('still looks up real message ids', async () => {
    const store = createMsgStore(async () => ({ messages: ['msg'] }));
    const original = store.getMessagesById;
    global.window = { Store: { Msg: store } };
    installMessageIdGuard();

    await expect(window.Store.Msg.getMessagesById(['abc', undefined])).resolves.toEqual({
      messages: ['msg']
    });
    expect(original).toHaveBeenCalledWith(['abc']);
  });

  test('only wraps the store once', () => {
    global.window = { Store: { Msg: createMsgStore(async () => ({ messages: [] })) } };
    expect(installMessageIdGuard()).toBe(true);
    expect(installMessageIdGuard()).toBe(false);
  });
});

describe('WhatsApp event handlers', () => {
  let client;
  let onMessage;
  let onCall;

  beforeAll(() => {
    onMessage = jest.fn();
    onCall = jest.fn();
    initMessaging({ onMessage, onCall });
    client = wweb.__clients[wweb.__clients.length - 1];
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.window = { Store: { Msg: createMsgStore(async () => ({ messages: [] })) } };
  });

  afterEach(() => {
    delete global.window;
  });

  afterAll(() => {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    delete process.env.SESSION_DIR;
  });

  test('a failing message handler does not reject and is reported', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    onMessage.mockRejectedValueOnce(new Error('getChat blew up'));

    const [listener] = client.listeners('message_create');
    await expect(listener({})).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    expect(sendPushoverNotification).toHaveBeenCalledWith(
      'GateGPT',
      expect.stringContaining('getChat blew up')
    );
    errorSpy.mockRestore();
  });

  test('a failing call handler does not reject', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    onCall.mockRejectedValueOnce(new Error('call failed'));

    const [listener] = client.listeners('incoming_call');
    await expect(listener({})).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('chat lookups install the page workaround first', async () => {
    await getChatById('123@c.us');
    expect(client.pupPage.evaluate).toHaveBeenCalledWith(installMessageIdGuard);
    expect(client.getChatById).toHaveBeenCalledWith('123@c.us');

    client.pupPage.evaluate.mockClear();
    const getChat = jest.fn(async () => 'chat');
    await expect(getChatForMessage({ getChat })).resolves.toBe('chat');
    expect(client.pupPage.evaluate).toHaveBeenCalledWith(installMessageIdGuard);
    expect(getChat).toHaveBeenCalled();
  });

  test('an unusable page does not stop the chat lookup', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    client.pupPage.evaluate.mockRejectedValueOnce(new Error('page closed'));

    await expect(getChatById('123@c.us')).resolves.toEqual({
      id: { _serialized: '123@c.us' }
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
