const axios = require('axios');
const FormData = require('form-data');
const { getConfig } = require('./config');

/**
 * Send a push notification via Pushover.
 * @param {string} title   The message title.
 * @param {string} message The message body.
 * @param {object} [opts]  Optional file attachment.
 *   opts.attachment   → Buffer | Readable
 *   opts.filename     → string (default: "file")
 *   opts.contentType  → string (default inferred by Pushover)
 */
async function sendPushoverNotification(title, message, opts = {}) {
  const { attachment, filename = 'file', contentType } = opts;
  const url = 'https://api.pushover.net/1/messages.json';

  try {
    if (attachment) {
      // multipart/form-data branch (image, etc.)
      const form = new FormData();
      form.append('token', getConfig('PUSHOVER_TOKEN'));
      form.append('user', getConfig('PUSHOVER_USER'));
      form.append('title', title);
      form.append('message', message);
      form.append('attachment', attachment, { filename, contentType });

      await axios.post(url, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity
      });
    } else {
      // simple JSON branch (no file)
      const params = new URLSearchParams();
      params.append('token', getConfig('PUSHOVER_TOKEN'));
      params.append('user', getConfig('PUSHOVER_USER'));
      params.append('title', title);
      params.append('message', message);

      await axios.post(url, params); // axios sets the correct header automatically
    }

    console.log(`${title}: ${message}`);
  } catch (err) {
    const code = err.response?.status ?? 'N/A';
    const body = err.response?.data ?? err.message;
    console.error(`❌ Pushover failed (HTTP ${code}):`, body);
  }
}

module.exports = { sendPushoverNotification };
