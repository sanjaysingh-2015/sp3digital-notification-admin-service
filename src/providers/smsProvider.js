const { maskPhone } = require('../utils/mask');

const outbox = [];

const transportMode = () => (process.env.SMS_TRANSPORT || 'log').toLowerCase();

function platformConfig() {
  return {
    accountSid: process.env.SMS_ACCOUNT_SID,
    authToken: process.env.SMS_AUTH_TOKEN,
    fromNumber: process.env.SMS_FROM_NUMBER,
  };
}

function classify(error) {
  const code = Number(error?.statusCode);
  const permanent = code >= 400 && code < 500 && code !== 429;
  const wrapped = new Error(String(error?.message || error).slice(0, 300));
  wrapped.permanent = permanent;
  return wrapped;
}

async function sendSms({ to, toName, body, from, providerConfig }) {
  const mode = transportMode();

  if (mode === 'memory') {
    if (/fail-temp/.test(to)) throw Object.assign(new Error('Simulated temporary failure'), { permanent: false });
    if (/fail-perm/.test(to)) throw Object.assign(new Error('Simulated permanent failure'), { permanent: true });
    outbox.push({ to, toName, body, from, providerConfig });
    return { messageId: `memory-${outbox.length}`, provider: 'memory' };
  }

  if (mode === 'log') {
    console.log(`[notification:log] would send SMS "${body?.slice(0, 50)}..." to ${maskPhone(to)} from ${from}`);
    return { messageId: `log-${Date.now()}`, provider: 'log' };
  }

  const config = providerConfig || platformConfig();
  if (!config.accountSid || !config.authToken || !config.fromNumber) {
    const error = new Error('SMS credentials not configured (SMS_ACCOUNT_SID, SMS_AUTH_TOKEN, SMS_FROM_NUMBER)');
    error.permanent = false;
    throw error;
  }

  try {
    const twilio = require('twilio')(config.accountSid, config.authToken);
    const message = await twilio.messages.create({
      from: config.fromNumber,
      to: to,
      body: body,
    });
    return { messageId: message.sid, provider: 'twilio' };
  } catch (error) {
    throw classify(error);
  }
}

module.exports = { sendSms, outbox, transportMode, platformConfig };