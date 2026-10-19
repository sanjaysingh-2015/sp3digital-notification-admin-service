const nodemailer = require('nodemailer');
const { maskEmail } = require('../utils/mask');

/**
 * Delivers one email. The result is { messageId } or an Error carrying
 *   error.permanent   true when retrying cannot help (address does not exist, rejected for good)
 *   error.hardBounce  true when the address itself is undeliverable (so it gets suppressed)
 *
 * EMAIL_TRANSPORT decides how:
 *   smtp    really send (the tenant's own SMTP account if it has one, else the platform's)
 *   log     print a line to the console and send nothing (local development; overrides tenant SMTP)
 *   memory  keep the message in `outbox` (tests)
 */
const outbox = [];

const transportMode = () => (process.env.EMAIL_TRANSPORT || 'log').toLowerCase();

function platformSmtp() {
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
  };
}

function classify(error) {
  const code = Number(error?.responseCode);
  // 550 / 551 / 553 / 554 on a recipient: the mailbox does not exist or refuses mail for good
  const hardBounce = [550, 551, 553, 554].includes(code) && /recipient|user|mailbox|address|unknown|exist/i.test(String(error?.response || error?.message || ''));
  const permanent = hardBounce || (code >= 500 && code < 600) || error?.code === 'EENVELOPE' || error?.code === 'EAUTH';
  const wrapped = new Error(String(error?.message || error).slice(0, 300));
  wrapped.permanent = permanent;
  wrapped.hardBounce = hardBounce;
  return wrapped;
}

async function sendEmail({ to, toName, subject, text, html, from, replyTo, smtp }) {
  const mode = transportMode();

  if (mode === 'memory') {
    // test hooks: an address containing these words fails on purpose
    if (/fail-temp/.test(to)) throw Object.assign(new Error('Simulated temporary failure'), { permanent: false, hardBounce: false });
    if (/fail-perm/.test(to)) throw Object.assign(new Error('550 5.1.1 Recipient address rejected: user unknown'), { permanent: true, hardBounce: true });
    outbox.push({ to, toName, subject, text, html, from, replyTo, smtp: smtp ? { host: smtp.host, user: smtp.user } : null });
    return { messageId: `memory-${outbox.length}`, provider: 'memory' };
  }

  if (mode === 'log') {
    console.log(`[notification:log] would send "${subject}" to ${maskEmail(to)} from ${from.address}`);
    return { messageId: `log-${Date.now()}`, provider: 'log' };
  }

  const config = smtp || platformSmtp();
  if (!config.host) {
    const error = new Error('No SMTP server is configured (SMTP_HOST, or the tenant\'s own SMTP settings)');
    error.permanent = false; // fixable by configuration; keep retrying until someone does
    throw error;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: !!config.secure,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
    const info = await transporter.sendMail({
      from: `"${String(from.name || '').replace(/"/g, '')}" <${from.address}>`,
      to: toName ? `"${String(toName).replace(/"/g, '')}" <${to}>` : to,
      replyTo: replyTo || undefined,
      subject,
      text,
      html: html || undefined,
    });
    return { messageId: info.messageId, provider: 'smtp', response: String(info.response || '').slice(0, 200) };
  } catch (error) {
    throw classify(error);
  }
}

module.exports = { sendEmail, outbox, transportMode, platformSmtp };
