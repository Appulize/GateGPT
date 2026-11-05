/** @jest-environment node */
const { Client } = require('whatsapp-web.js');

test('disabled web cache never registers the response-body reader or interception', async () => {
  const page = { on: jest.fn(), setRequestInterception: jest.fn() };
  const client = { options: { webVersionCache: { type: 'none' } }, pupPage: page };
  await Client.prototype.initWebVersionCache.call(client);
  expect(page.on).not.toHaveBeenCalled();
  expect(page.setRequestInterception).not.toHaveBeenCalled();
});
