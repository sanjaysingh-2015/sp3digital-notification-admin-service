const { httpError } = require('../utils/errors');
const email = require('./emailProvider');

// One adapter per channel. Adding SMS or WhatsApp means adding a file here that exports
// the same shape ({ send(message) -> { messageId, provider } }) and listing it below —
// the API, outbox, retries, templates and suppression already work per channel.
const CHANNELS = { EMAIL: { send: email.sendEmail } };

const SUPPORTED_CHANNELS = Object.keys(CHANNELS);

function providerFor(channel) {
  const provider = CHANNELS[channel];
  if (!provider) throw httpError(400, 'CHANNEL_NOT_SUPPORTED', `The ${channel} channel is not available yet`);
  return provider;
}

module.exports = { providerFor, SUPPORTED_CHANNELS };
