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
    constructor(options) {
      super();
      this.options = options;
      this.pupPage = { evaluate: jest.fn(async fn => fn()) };
      this.getChatById = jest.fn(async id => ({ id: { _serialized: id } }));
      this.sendMessage = jest.fn();
      clients.push(this);
    }
    initialize() { return Promise.resolve(); }
    destroy() { return Promise.resolve(); }
    getState() { return Promise.resolve('CONNECTED'); }
  }

  return {
    Client,
    LocalAuth: class LocalAuth { async afterBrowserInitialized() {} },
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
  installWhatsAppWebPatches,
  getStatus
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

  test('patches the current whatsapp-web.js module registry without Store', async () => {
    const MsgKey = createMsgKeyClass();
    const Msg = createMsgStore(async () => ({ messages: ['msg'] }));
    const original = Msg.getMessagesById;
    global.window = {
      require: name => ({ WAWebMsgKey: MsgKey, WAWebCollections: { Msg } })[name]
    };

    expect(installWhatsAppWebPatches()).toEqual({
      keyRestored: true,
      lookupGuarded: true
    });
    expect(new MsgKey(false, 'x@c.us', 'A')._serialized).toBe('false_x@c.us_A');
    await expect(Msg.getMessagesById([undefined, 'abc'])).resolves.toEqual({ messages: ['msg'] });
    expect(original).toHaveBeenCalledWith(['abc']);
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


describe('WhatsApp startup', () => {
  test('loads the live app without a version pin or HTML cache', () => {
    initMessaging({});
    const options = wweb.__clients.at(-1).options;
    expect(options.webVersion).toBeUndefined();
    expect(options.webVersionCache).toEqual({ type: 'none' });
    expect(options.userAgent).toBe(false);
  });

  test.each(['HeadlessChrome/149.0.0.0', 'Chrome/150.0.0.0'])(
    'preserves the actual browser version with %s and bypasses stale service workers', async browserToken => {
      initMessaging({});
      const auth = wweb.__clients.at(-1).options.authStrategy;
      const setBypassServiceWorker = jest.fn().mockResolvedValue(undefined);
      const setUserAgent = jest.fn().mockResolvedValue(undefined);
      auth.client = {
        pupPage: { setBypassServiceWorker, setUserAgent },
        pupBrowser: { userAgent: async () => `Mozilla/5.0 ${browserToken} Safari/537.36` }
      };
      await auth.afterBrowserInitialized();
      expect(setBypassServiceWorker).toHaveBeenCalledWith(true);
      expect(setUserAgent).toHaveBeenCalledWith(`Mozilla/5.0 ${browserToken.replace('HeadlessChrome/', 'Chrome/')} Safari/537.36`);
    }
  );

  test('reports startup failure without an unhandled rejection taking down the UI', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const initSpy = jest.spyOn(wweb.Client.prototype, 'initialize')
      .mockRejectedValueOnce(new Error('Socket unavailable'));
    initMessaging({});
    await new Promise(resolve => setImmediate(resolve));
    expect(getStatus()).toMatchObject({ ready: false, startupError: expect.stringContaining('failed to start') });
    expect(errorSpy).toHaveBeenCalled();
    initSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('WhatsApp automatic recovery integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    fs.rmSync(path.join(sessionDir, 'whatsapp-recovery.json'), { force: true });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('destroys the old client before retry, ignores stale events, and keeps auth', async () => {
    const onMessage = jest.fn();
    initMessaging({ onMessage });
    const old = wweb.__clients.at(-1);
    const destroy = jest.spyOn(old, 'destroy');
    old.emit('ready');
    const message = { ...waMessage(false, 'test@c.us', 'replayed'), timestamp: Date.now() / 1000 };
    old.emit('message_create', message);
    const authDir = path.join(sessionDir, 'whatsapp-auth');
    fs.writeFileSync(path.join(authDir, 'preserve-me'), 'session sentinel');
    await jest.advanceTimersByTimeAsync(2 * 60000);
    old.emit('disconnected', 'NETWORK');
    await jest.advanceTimersByTimeAsync(61 * 60000);
    const replacement = wweb.__clients.at(-1);
    expect(replacement).not.toBe(old);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(authDir, 'preserve-me'), 'utf8')).toBe('session sentinel');
    expect(replacement.options.authStrategy).not.toBe(old.options.authStrategy);
    old.emit('ready');
    expect(getStatus().ready).toBe(false);
    replacement.emit('ready');
    replacement.emit('message_create', message);
    expect(onMessage).toHaveBeenCalledTimes(1);
    replacement.emit('message_create', { ...message, ...waMessage(false, 'test@c.us', 'unseen-backlog') });
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(getStatus()).toMatchObject({ ready: true, startupError: null, qrId: 0 });
    await jest.advanceTimersByTimeAsync(6 * 60000);
    expect(sendPushoverNotification.mock.calls.every(([title]) => title.includes('WhatsApp'))).toBe(true);
  });

  test('a stuck initializer never creates overlapping clients and still raises an alert', async () => {
    jest.spyOn(wweb.Client.prototype, 'initialize').mockImplementation(() => new Promise(() => {}));
    initMessaging({});
    const count = wweb.__clients.length;
    await jest.advanceTimersByTimeAsync(11 * 60000);
    expect(wweb.__clients).toHaveLength(count);
    expect(sendPushoverNotification).toHaveBeenCalledWith(
      'GateGPT — WhatsApp offline', expect.stringContaining('recovery attempts')
    );
  });

  test('health-probe failure marks the UI offline, then rebuilds the client', async () => {
    initMessaging({});
    const old = wweb.__clients.at(-1);
    jest.spyOn(old, 'getState').mockRejectedValue(new Error('page crashed'));
    old.emit('ready');
    await jest.advanceTimersByTimeAsync(30000);
    expect(getStatus().ready).toBe(false);
    await jest.advanceTimersByTimeAsync(60000);
    expect(wweb.__clients.at(-1)).not.toBe(old);
  });

  test('kills only its disconnected-but-live browser before launching a replacement', async () => {
    initMessaging({});
    const old = wweb.__clients.at(-1);
    const { EventEmitter } = require('events');
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = jest.fn(() => {
      child.signalCode = 'SIGKILL';
      child.emit('exit');
    });
    old.pupBrowser = { process: () => child, isConnected: () => false };
    old.emit('ready');
    old.emit('disconnected', 'NETWORK');
    await jest.advanceTimersByTimeAsync(76000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(wweb.__clients.at(-1)).not.toBe(old);
  });

  test('a healthy socket alone cannot hide authentication stuck before ready', async () => {
    initMessaging({});
    const old = wweb.__clients.at(-1);
    old.emit('authenticated');
    await jest.advanceTimersByTimeAsync(60000);
    expect(getStatus().ready).toBe(false);
    expect(wweb.__clients.at(-1)).not.toBe(old);
  });
});

afterAll(() => {
  fs.rmSync(sessionDir, { recursive: true, force: true });
  delete process.env.SESSION_DIR;
});
