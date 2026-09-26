/** @jest-environment node */

const { downloadMessageMedia } = require('../mediaDownload');

describe('downloadMessageMedia', () => {
  test('returns media immediately when WhatsApp has it ready', async () => {
    const media = { data: 'dm9pY2U=', mimetype: 'audio/ogg' };
    const message = { downloadMedia: jest.fn().mockResolvedValue(media) };

    await expect(downloadMessageMedia(message, { retryDelayMs: 0 })).resolves.toBe(media);
    expect(message.downloadMedia).toHaveBeenCalledTimes(1);
  });

  test('reloads and retries when WhatsApp temporarily returns no media', async () => {
    const media = { data: 'dm9pY2U=', mimetype: 'audio/ogg' };
    const message = {
      downloadMedia: jest.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(media),
      reload: jest.fn().mockResolvedValue(undefined)
    };

    await expect(downloadMessageMedia(message, { retryDelayMs: 0 })).resolves.toBe(media);
    expect(message.downloadMedia).toHaveBeenCalledTimes(2);
    expect(message.reload).toHaveBeenCalledTimes(1);
  });

  test('throws a useful error instead of dereferencing undefined media', async () => {
    const message = {
      downloadMedia: jest.fn().mockResolvedValue(undefined),
      reload: jest.fn().mockResolvedValue(undefined)
    };

    await expect(downloadMessageMedia(message, {
      attempts: 2,
      retryDelayMs: 0
    })).rejects.toThrow(
      'Unable to download voice media after 2 attempts: WhatsApp returned no media data'
    );
    expect(message.downloadMedia).toHaveBeenCalledTimes(2);
    expect(message.reload).toHaveBeenCalledTimes(1);
  });
});
