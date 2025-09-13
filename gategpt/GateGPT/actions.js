const axios = require('axios');
const { getConfig } = require('./config');
const { sendPushoverNotification } = require('./notifications');
const { sendAuto, Location } = require('./messaging');
const { getTrackingsForPhone, removeTrackingForPhone } = require('./otp');
const { setStatus } = require('./deliveryLog');

async function sendLocation(chat) {
  try {
    const lat = Number(getConfig('LOCATION_LAT'));
    const lon = Number(getConfig('LOCATION_LON'));
    const location = new Location(
      lat,
      lon,
      getConfig('LOCATION_TITLE'),
      getConfig('LOCATION_SUBTITLE')
    );
    await sendAuto(chat, location);
    await sendAuto(
      chat,
      getConfig(
        'MESSAGE_LOCATION',
        'Here is the location, please message me when you are outside.'
      )
    );
  } catch (err) {
    console.error('❌ Failed to send location:', err.message);
    sendPushoverNotification('GateGPT', '❌ Failed to send location!');
  }
}

async function openGate(chat, convo) {
  try {
    await axios.post(getConfig('GATE_OPEN_URL'), {});
    await sendAuto(
      chat,
      getConfig(
        'MESSAGE_GATE_OPEN',
        'Please enter through the car gate and leave the item on the doorstep. The gate will close after 2 minutes. Thank you.'
      )
    );
    await chat.markUnread();
    console.log(`✅ Gate opened`);

    convo.instant = true;

    if (convo.gateCloseTimer) clearTimeout(convo.gateCloseTimer);
    convo.gateCloseTimer = setTimeout(async () => {
      try {
        await axios.post(getConfig('GATE_CLOSE_URL'), {});
        console.log(`🔐 Gate closed for ${chat.id._serialized}`);
        const trackings = getTrackingsForPhone(chat.id._serialized);
        trackings.forEach(t => {
          setStatus(t, 'delivered', chat.id._serialized);
          removeTrackingForPhone(chat.id._serialized, t);
        });
        sendPushoverNotification(
          'GateGPT',
          `Delivery from ${chat.id._serialized} handled.`
        );
      } catch (err) {
        console.error('❌ Failed to close gate:', err.message);
        sendPushoverNotification('GateGPT', '❌ Failed to close the gate!');
      }
      convo.instant = false;
      convo.triggered = false;
      convo.sentLocation = false;
      convo.delivering = false;
      convo.gateCloseTimer = null;
      console.log(`🕓 Instant mode OFF for ${chat.id._serialized}`);
    }, getConfig('AUTO_CLOSE_DELAY_MS', 120000));

    if (convo.instantTimer) clearTimeout(convo.instantTimer);
    convo.instantTimer = setTimeout(() => {
      convo.instant = false;
      convo.triggered = false;
      console.log(`🕓 Instant mode OFF for ${chat.id._serialized}`);
    }, getConfig('AUTO_CLOSE_DELAY_MS', 120000));
  } catch (err) {
    console.error('❌ Gate open failed:', err.message);
    sendPushoverNotification('GateGPT', '❌ Failed to open the gate!');
    await sendAuto(
      chat,
      getConfig(
        'MESSAGE_GATE_FAILED',
        'Sorry, the gate failed to open. Please leave the item outside the car gate.'
      )
    );
    await chat.markUnread();
  }
}

module.exports = { sendLocation, openGate };
