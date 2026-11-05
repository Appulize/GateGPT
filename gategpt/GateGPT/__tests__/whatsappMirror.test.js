/** @jest-environment node */
const { Jimp } = require('jimp');
jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../notifications', () => ({ sendPushoverNotification: jest.fn() }));
const axios = require('axios');
const { sendPushoverNotification } = require('../notifications');
const { mirrorIncomingMessage } = require('../whatsappMirror');
const message = { body: 'Test delivery', type: 'chat', fromMe: false,
  getContact: async () => ({ name: 'Test courier', getProfilePicUrl: async () => 'https://example.invalid/avatar.png' }) };
afterEach(() => jest.clearAllMocks());
test('Jimp migration produces a valid 128x128 JPEG attachment', async () => {
  const source = new Jimp({ width: 400, height: 200, color: 0xff0000ff });
  axios.get.mockResolvedValue({ data: await source.getBuffer('image/png') });
  await mirrorIncomingMessage(message, {});
  const options = sendPushoverNotification.mock.calls[0][2];
  expect(options.contentType).toBe('image/jpeg');
  expect(options.attachment.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  const decoded = await Jimp.read(options.attachment);
  expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([128, 128]);
});
test('corrupt avatar does not prevent the notification', async () => {
  axios.get.mockResolvedValue({ data: Buffer.from('not an image') });
  await mirrorIncomingMessage(message, {});
  expect(sendPushoverNotification).toHaveBeenCalledWith('Test courier', 'Test delivery');
});
