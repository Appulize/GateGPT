const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * WhatsApp Web can briefly report media as FETCHING, causing whatsapp-web.js
 * to return undefined from downloadMedia(). Reload and retry before treating
 * the voice note as unavailable.
 */
async function downloadMessageMedia(message, { attempts = 3, retryDelayMs = 1000 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const media = await message.downloadMedia();
      if (media?.data) return media;
      lastError = new Error('WhatsApp returned no media data');
    } catch (err) {
      lastError = err;
    }

    if (attempt < attempts) {
      await wait(retryDelayMs);
      if (typeof message.reload === 'function') {
        try {
          await message.reload();
        } catch {
          // A reload is best-effort; downloadMedia() performs its own lookup.
        }
      }
    }
  }

  const reason = lastError?.message || String(lastError || 'unknown error');
  throw new Error(`Unable to download voice media after ${attempts} attempts: ${reason}`, {
    cause: lastError
  });
}

module.exports = { downloadMessageMedia };
