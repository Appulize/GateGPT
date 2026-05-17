const USER_JID_RE = /^\d+@(c\.us|s\.whatsapp\.net)$/i;
const LID_JID_RE = /^\d+@lid$/i;
const GROUP_JID_RE = /@g\.us$/i;
const STATUS_BROADCAST_JID = 'status@broadcast';

function serializedId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value._serialized === 'string') return value._serialized;
  return null;
}

function normalizeUserJid(jid) {
  if (typeof jid !== 'string') return null;
  const normalized = jid.trim();
  if (!USER_JID_RE.test(normalized)) return null;
  return normalized.replace(/@s\.whatsapp\.net$/i, '@c.us');
}

function isGroupJid(jid) {
  return typeof jid === 'string' && GROUP_JID_RE.test(jid);
}

function isStatusBroadcastJid(jid) {
  return typeof jid === 'string' && jid.toLowerCase() === STATUS_BROADCAST_JID;
}

function isLidJid(jid) {
  return typeof jid === 'string' && LID_JID_RE.test(jid);
}

function chatRawId(chat) {
  return serializedId(chat?.id) || serializedId(chat);
}

function phoneJidFromContact(contact) {
  const contactId = normalizeUserJid(serializedId(contact?.id));
  if (contactId) return contactId;

  // In whatsapp-web.js, `number` is only safe as a phone number when the
  // contact id itself is not a LID.  A LID user part is also just digits, so
  // blindly trusting contact.number would turn privacy IDs into fake phones.
  const server = contact?.id?.server;
  if (server && server !== 'lid' && /^\d{6,15}$/.test(String(contact?.number || ''))) {
    return `${contact.number}@c.us`;
  }

  return null;
}

async function resolveChatPrimaryId(chat, message, { resolvePhoneJid } = {}) {
  const rawId = chatRawId(chat) || serializedId(message?.id?.remote) || message?.from;
  const directPhone = normalizeUserJid(rawId);
  if (directPhone || isGroupJid(rawId) || isStatusBroadcastJid(rawId)) {
    return directPhone || rawId;
  }

  if (typeof resolvePhoneJid === 'function' && rawId) {
    try {
      const resolved = normalizeUserJid(await resolvePhoneJid(rawId));
      if (resolved) return resolved;
    } catch (err) {
      console.warn(`⚠️  Failed to resolve WhatsApp LID ${rawId}: ${err.message}`);
    }
  }

  if (typeof message?.getContact === 'function') {
    try {
      const contact = await message.getContact();
      const phoneJid = phoneJidFromContact(contact);
      if (phoneJid) return phoneJid;
    } catch (err) {
      console.warn(`⚠️  Failed to read contact for ${rawId || 'unknown chat'}: ${err.message}`);
    }
  }

  return rawId;
}

module.exports = {
  STATUS_BROADCAST_JID,
  chatRawId,
  isGroupJid,
  isLidJid,
  isStatusBroadcastJid,
  normalizeUserJid,
  phoneJidFromContact,
  resolveChatPrimaryId
};
