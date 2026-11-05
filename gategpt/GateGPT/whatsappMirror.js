const axios = require('axios');
const { Jimp } = require('jimp');
const { getConfig } = require('./config');
const { sendPushoverNotification } = require('./notifications');

const DEFAULT_AVATAR_SIZE = 128;

function isMirrorEnabled() {
  const raw = getConfig('MIRROR_WA_MESSAGES', true);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }
  return Boolean(raw);
}

function getDisplayName(contact) {
  return (
    contact?.name ||
    contact?.pushname ||
    contact?.shortName ||
    contact?.number ||
    'Unknown sender'
  );
}

function formatLocation(location) {
  if (!location) return '📍 Location';
  const label = location.description || location.name || location.address;
  if (label) return `📍 ${label}`;
  if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
    return `📍 ${location.latitude}, ${location.longitude}`;
  }
  return '📍 Location';
}

function formatMessageBody(message) {
  const body = (message.body || '').trim();

  switch (message.type) {
    case 'chat':
      return body || '📩 Message received';
    case 'image':
      return body ? `🖼️ ${body}` : '🖼️ Image';
    case 'video':
      return body ? `🎬 ${body}` : '🎬 Video';
    case 'audio':
      return body ? `🎧 ${body}` : '🎧 Audio';
    case 'ptt':
      return '🎙️ Voice message';
    case 'document':
      return body ? `📎 ${body}` : '📎 Document';
    case 'sticker':
      return '✨ Sticker';
    case 'location':
      return formatLocation(message.location);
    default:
      return body || `📩 ${message.type} message`;
  }
}

async function fetchAvatarBuffer(contact) {
  try {
    const url = await contact?.getProfilePicUrl();
    if (!url) return null;

    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    const image = await Jimp.read(buffer);

    image.cover({ w: DEFAULT_AVATAR_SIZE, h: DEFAULT_AVATAR_SIZE });
    return await image.getBuffer('image/jpeg', { quality: 70 });
  } catch (err) {
    console.warn('⚠️  Failed to fetch or resize avatar:', err.message);
    return null;
  }
}

async function mirrorIncomingMessage(message, chat) {
  if (!isMirrorEnabled()) return;
  if (!message || message.fromMe || message.isStatus) return;
  if (message.type === 'e2e_notification') return;
  if (chat?.isMuted) return;

  try {
    const contact = await message.getContact();
    const senderName = getDisplayName(contact);
    const title = chat?.isGroup
      ? `${chat.name || 'Group'} — ${senderName}`
      : senderName;
    const body = formatMessageBody(message);
    const avatar = await fetchAvatarBuffer(contact);

    if (avatar) {
      await sendPushoverNotification(title, body, {
        attachment: avatar,
        filename: 'avatar.jpg',
        contentType: 'image/jpeg'
      });
    } else {
      await sendPushoverNotification(title, body);
    }
  } catch (err) {
    console.error('❌ Failed to mirror WhatsApp message:', err.message);
  }
}

module.exports = { mirrorIncomingMessage };
