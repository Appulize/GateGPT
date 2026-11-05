/** @jest-environment node */
jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../config', () => ({ getConfig: () => 'test-only-placeholder' }));
const axios = require('axios');
const { sendPushoverNotification } = require('../notifications');

test('Pushover reports success and uses a bounded request timeout', async () => {
  axios.post.mockResolvedValueOnce({ status: 200 });
  await expect(sendPushoverNotification('Test', 'Offline')).resolves.toBe(true);
  expect(axios.post).toHaveBeenLastCalledWith(
    'https://api.pushover.net/1/messages.json', expect.any(URLSearchParams), { timeout: 15000 }
  );
});

test('Pushover failures return false without logging request credentials', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  axios.post.mockRejectedValueOnce({ code: 'ETIMEDOUT', message: 'secret payload', config: { secret: true } });
  await expect(sendPushoverNotification('Test', 'Offline')).resolves.toBe(false);
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  log.mockRestore();
});
