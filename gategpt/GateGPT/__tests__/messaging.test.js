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
      this.sendMessage = jest.fn();
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
  sendAuto,
  isAutoMessage,
  getChatById,
  getChatForMessage,
  installWhatsAppWebPatches
} = require('../messaging');

// WhatsApp Web stopped populating `_serialized`; ids carry the parts instead.
function waMessage(fromMe, remote, id) {
  return { id: { fromMe, remote, id } };
}

function createMsgStore(getMessagesById) {
  return { getMessagesById: jest.fn(getMessagesById) };
}

// Mirrors the current WhatsApp Web key class: toString() works, the
// `_serialized` getter it used to carry is gone.
function createMsgKeyClass() {
  class MsgKey {
    constructor(fromMe, remote, id) {
      this.fromMe = fromMe;
      this.remote = remote;
      this.id = id;
    }
    toString() {
      return `${this.fromMe}_${this.remote}_${this.id}`;
    }
  }
  return MsgKey;
}

describe('installWhatsAppWebPatches', () => {
  afterEach(() => {
    delete global.window;
  });

  test('puts back the _serialized getter WhatsApp Web dropped', () => {
    const MsgKey = createMsgKeyClass();
    global.window = { Store: { MsgKey, Msg: createMsgStore(async () => ({ messages: [] })) } };

    expect(installWhatsAppWebPatches().keyRestored).toBe(true);

    const key = new MsgKey(true, '48531858363@c.us', 'AAA');
    expect(key._serialized).toBe('true_48531858363@c.us_AAA');
  });

  test('leaves a working _serialized alone', () => {
    const MsgKey = createMsgKeyClass();
    Object.defineProperty(MsgKey.prototype, '_serialized', {
      get() { return 'original'; },
      configurable: true
    });
    global.window = { Store: { MsgKey, Msg: createMsgStore(async () => ({ messages: [] })) } };

    expect(installWhatsAppWebPatches().keyRestored).toBe(false);
    expect(new MsgKey(true, 'x@c.us', 'A')._serialized).toBe('original');
  });

  test('restores the key only once', () => {
    const MsgKey = createMsgKeyClass();
    global.window = { Store: { MsgKey, Msg: createMsgStore(async () => ({ messages: [] })) } };

    expect(installWhatsAppWebPatches().keyRestored).toBe(true);
    expect(installWhatsAppWebPatches().keyRestored).toBe(false);
  });

  test('keeps IndexedDB away from ids WhatsApp Web no longer serialises', async () => {
    const store = createMsgStore(async () => {
      throw new Error("DataError: Failed to execute 'get' on 'IDBObjectStore'");
    });
    const original = store.getMessagesById;
    // No MsgKey: the fallback has to hold on its own.
    global.window = { Store: { Msg: store } };

    expect(installWhatsAppWebPatches().lookupGuarded).toBe(true);

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
    installWhatsAppWebPatches();

    await expect(window.Store.Msg.getMessagesById(['abc', undefined])).resolves.toEqual({
      messages: ['msg']
    });
    expect(original).toHaveBeenCalledWith(['abc']);
  });

  test('only wraps the store once', () => {
    global.window = { Store: { Msg: createMsgStore(async () => ({ messages: [] })) } };
    expect(installWhatsAppWebPatches().lookupGuarded).toBe(true);
    expect(installWhatsAppWebPatches().lookupGuarded).toBe(false);
  });
});

describe('auto-message detection', () => {
  let client;

  beforeAll(() => {
    initMessaging({});
    client = wweb.__clients[wweb.__clients.length - 1];
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('recognises its own reply when the id has no _serialized', async () => {
    const sent = waMessage(true, '48531858363@c.us', 'AAA');
    const chat = {
      id: { _serialized: '48531858363@c.us' },
      sendMessage: jest.fn(async () => sent)
    };

    await sendAuto(chat, 'Are you outside?');

    expect(isAutoMessage(sent)).toBe(true);
  });

  test('does not swallow the courier\'s next message', async () => {
    const sent = waMessage(true, '48531858363@c.us', 'BBB');
    const chat = {
      id: { _serialized: '48531858363@c.us' },
      sendMessage: jest.fn(async () => sent)
    };

    await sendAuto(chat, 'Are you outside?');

    // The reply that used to be dropped because add(undefined)/has(undefined) matched
    expect(isAutoMessage(waMessage(false, '48531858363@c.us', 'CCC'))).toBe(false);
  });

  test('never matches a message that has no usable id', async () => {
    const chat = {
      id: { _serialized: '48531858363@c.us' },
      sendMessage: jest.fn(async () => waMessage(true, '48531858363@c.us', 'FFF'))
    };
    // Populate the set first: the bug was that a recorded reply matched everything.
    await sendAuto(chat, 'Are you outside?');

    expect(isAutoMessage({})).toBe(false);
    expect(isAutoMessage({ id: {} })).toBe(false);
    expect(isAutoMessage(undefined)).toBe(false);
  });

  test('still records the reply when it goes out via the client fallback', async () => {
    const sent = waMessage(true, '48531858363@c.us', 'DDD');
    client.sendMessage.mockResolvedValueOnce(sent);
    const chat = {
      id: { _serialized: '48531858363@c.us' },
      sendMessage: jest.fn(async () => {
        throw new Error('chat handle is stale');
      })
    };

    await sendAuto(chat, 'Are you outside?');

    expect(client.sendMessage).toHaveBeenCalled();
    expect(isAutoMessage(sent)).toBe(true);
  });

  test('forgets the reply after an hour so the set cannot grow forever', async () => {
    const sent = waMessage(true, '48531858363@c.us', 'EEE');
    const chat = {
      id: { _serialized: '48531858363@c.us' },
      sendMessage: jest.fn(async () => sent)
    };

    await sendAuto(chat, 'Are you outside?');
    expect(isAutoMessage(sent)).toBe(true);

    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(isAutoMessage(sent)).toBe(false);
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
    expect(client.pupPage.evaluate).toHaveBeenCalledWith(installWhatsAppWebPatches);
    expect(client.getChatById).toHaveBeenCalledWith('123@c.us');

    client.pupPage.evaluate.mockClear();
    const getChat = jest.fn(async () => 'chat');
    await expect(getChatForMessage({ getChat })).resolves.toBe('chat');
    expect(client.pupPage.evaluate).toHaveBeenCalledWith(installWhatsAppWebPatches);
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
