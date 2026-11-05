/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createConnectionRecovery, withTimeout } = require('../connectionRecovery');

const MINUTE = 60000;
let dir, file, monitor, probe, restart, notify;
beforeEach(() => {
  jest.useFakeTimers({ now: 100000000 });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gategpt-recovery-'));
  file = path.join(dir, 'state.json');
  probe = jest.fn().mockResolvedValue(false);
  restart = jest.fn().mockResolvedValue(undefined);
  notify = jest.fn().mockResolvedValue(true);
});
afterEach(() => {
  monitor?.stop();
  jest.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});
function start() {
  monitor = createConnectionRecovery({ file, probe, restart, notify });
}
const advance = ms => jest.advanceTimersByTimeAsync(ms);

test('waits, retries at 1/3/7 minutes, then alerts once at 10 minutes', async () => {
  start();
  await advance(MINUTE - 1);
  expect(restart).not.toHaveBeenCalled();
  await advance(1);
  expect(restart).toHaveBeenCalledTimes(1);
  await advance(2 * MINUTE);
  expect(restart).toHaveBeenCalledTimes(2);
  await advance(4 * MINUTE);
  expect(restart).toHaveBeenCalledTimes(3);
  expect(notify).not.toHaveBeenCalled();
  await advance(3 * MINUTE);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][1]).toContain('3 recovery attempts');
  await advance(60 * MINUTE);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(restart.mock.calls.length).toBeLessThan(9);
});

test('a transient outage recovers silently; flapping does not reset its age', async () => {
  start();
  probe.mockResolvedValue(true);
  monitor.online();
  await advance(6 * MINUTE);
  expect(notify).not.toHaveBeenCalled();
  expect(restart).not.toHaveBeenCalled();
  expect(JSON.parse(fs.readFileSync(file))).toBeNull();
  probe.mockResolvedValue(false);
  monitor.offline('network lost');
  await advance(8 * MINUTE);
  probe.mockResolvedValue(true);
  await advance(MINUTE);
  probe.mockResolvedValue(false);
  monitor.offline('network lost again');
  await advance(MINUTE);
  expect(notify).toHaveBeenCalledTimes(1);
});

test('deduplicates across process restarts, only resolves after five stable minutes', async () => {
  start();
  await advance(10 * MINUTE);
  monitor.stop();
  start();
  await advance(10 * MINUTE);
  expect(notify).toHaveBeenCalledTimes(1);
  probe.mockResolvedValue(true);
  monitor.online();
  await advance(4 * MINUTE);
  expect(notify).toHaveBeenCalledTimes(1);
  probe.mockResolvedValue(false);
  monitor.offline('flap');
  await advance(MINUTE);
  probe.mockResolvedValue(true);
  monitor.online();
  await advance(5 * MINUTE);
  expect(notify).toHaveBeenCalledTimes(2);
  expect(notify.mock.calls[1][0]).toContain('recovered');
  await advance(10 * MINUTE);
  expect(notify).toHaveBeenCalledTimes(2);
  probe.mockResolvedValue(false);
  monitor.offline('new incident');
  await advance(10 * MINUTE);
  expect(notify).toHaveBeenCalledTimes(3);
});

test('failed Pushover delivery is retried after fifteen minutes, not every tick', async () => {
  notify.mockResolvedValueOnce(false);
  start();
  await advance(24 * MINUTE);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fs.readFileSync(file)).notified).toBe(false);
  await advance(MINUTE);
  expect(notify).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fs.readFileSync(file)).notified).toBe(true);
});

test('QR outage retries three times then leaves the QR available for manual login', async () => {
  start();
  restart.mockImplementation(async () => monitor.offline('WhatsApp needs a QR login', true));
  monitor.offline('WhatsApp needs a QR login', true);
  await advance(60 * MINUTE);
  expect(restart).toHaveBeenCalledTimes(3);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][1]).toContain('scan the QR code');
});

test('failed teardown still alerts and never overlaps recovery attempts', async () => {
  restart.mockImplementation(() => withTimeout(() => new Promise(() => {})));
  start();
  await advance(11 * MINUTE);
  expect(restart).toHaveBeenCalledTimes(3);
  expect(notify).toHaveBeenCalledTimes(1);
});

test('a hung health probe is bounded and becomes an outage', async () => {
  start();
  probe.mockResolvedValue(true);
  monitor.online();
  await advance(6 * MINUTE);
  probe.mockImplementation(() => new Promise(() => {}));
  await advance(12 * MINUTE);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][1]).toContain('unresponsive');
});

test('stop prevents a late probe from restarting the client or alerting', async () => {
  let resolve;
  probe.mockImplementation(() => new Promise(done => { resolve = done; }));
  start();
  const pending = monitor.tick();
  await Promise.resolve();
  monitor.stop();
  resolve(false);
  await pending;
  await advance(30 * MINUTE);
  expect(notify).not.toHaveBeenCalled();
  expect(restart).not.toHaveBeenCalled();
});


test('a disconnect during the recovery notification cannot erase an outage', async () => {
  start();
  await advance(10 * MINUTE);
  let finishNotice;
  notify.mockImplementationOnce(() => new Promise(resolve => { finishNotice = resolve; }));
  probe.mockResolvedValue(true);
  monitor.online();
  await advance(5 * MINUTE);
  probe.mockResolvedValue(false);
  monitor.offline('disconnected during recovery notice');
  finishNotice(true);
  await advance(MINUTE);
  expect(notify).toHaveBeenCalledTimes(2);
  await advance(9 * MINUTE);
  expect(notify).toHaveBeenCalledTimes(3);
  expect(notify.mock.calls[2][0]).toContain('offline');
  expect(JSON.parse(fs.readFileSync(file)).notified).toBe(true);
});
