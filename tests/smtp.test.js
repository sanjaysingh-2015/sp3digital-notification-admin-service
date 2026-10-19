// The real SMTP path (nodemailer talking to a server), not the in-memory stand-in:
// proves the message really goes over SMTP with the right headers, and that a refused
// recipient or an unreachable server is classified correctly.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { SMTPServer } = require('smtp-server');

process.env.DB_DIALECT = 'sqlite';
process.env.EMAIL_TRANSPORT = 'smtp';
process.env.MAIL_FROM_ADDRESS = 'no-reply@sp3.example';
process.env.MAIL_FROM_NAME = 'SP3 Digital';
process.env.NOTIFICATION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.MAX_ATTEMPTS = '3';

const TENANT = '11111111-1111-1111-1111-111111111111';
const received = [];
const servers = [];
let port;
let db;
let notificationService;
let dispatcher;
let settingsService;

const startServer = (listenPort = 0) =>
  new Promise((resolve) => {
    const smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onRcptTo(address, session, callback) {
        if (address.address.startsWith('unknown@')) {
          const error = new Error('550 5.1.1 Recipient address rejected: user unknown');
          error.responseCode = 550;
          return callback(error);
        }
        return callback();
      },
      onData(stream, session, callback) {
        let raw = '';
        stream.on('data', (chunk) => { raw += chunk.toString(); });
        stream.on('end', () => { received.push({ raw, from: session.envelope.mailFrom.address, to: session.envelope.rcptTo.map((r) => r.address) }); callback(); });
      },
    });
    servers.push(smtp);
    smtp.listen(listenPort, '127.0.0.1', () => resolve({ smtp, port: smtp.server.address().port }));
  });

const stop = (server) => new Promise((resolve) => server.close(resolve));

test.before(async () => {
  ({ port } = await startServer());
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(port);
  db = require('../src/models');
  await db.sequelize.sync({ force: true });
  await require('../src/services/templateService').ensureDefaults();
  notificationService = require('../src/services/notificationService');
  settingsService = require('../src/services/settingsService');
  dispatcher = require('../src/worker/dispatcher');
});
test.after(async () => { for (const server of servers) await stop(server).catch(() => undefined); });

const VARS = { patientName: 'Asha Verma', appointmentDate: 'Wed, 21 Oct 2026', startTime: '11:00', serviceName: 'General consultation', facilityName: 'SP Healthcare' };
const queue = (address, over = {}) => notificationService.send({ templateKey: 'APPOINTMENT_CONFIRMATION', to: { address, name: 'Asha Verma' }, variables: VARS, ...over }, { tenantUuid: TENANT, userId: 1 });

test('a message really goes over SMTP with the right envelope, headers and body', async () => {
  const queued = await queue('asha@example.com');
  const tally = await dispatcher.processDue();
  assert.equal(tally.sent, 1);

  assert.equal(received.length, 1);
  const mail = received[0];
  assert.equal(mail.from, 'no-reply@sp3.example');
  assert.deepEqual(mail.to, ['asha@example.com']);
  assert.match(mail.raw, /Subject: Your appointment on Wed, 21 Oct 2026 at 11:00/);
  assert.match(mail.raw, /From: "?SP3 Digital"? <no-reply@sp3\.example>/);
  assert.match(mail.raw, /Content-Type: multipart\/alternative/); // text + HTML parts
  assert.match(mail.raw, /Hello Asha Verma/);

  const row = await db.Notification.findByPk(queued.notificationId);
  assert.equal(row.status, 'SENT');
  assert.equal(row.provider, 'smtp');
  assert.ok(row.providerMessageId);
  assert.equal(row.bodyText, null);
});

test('a refused recipient is a hard bounce: failed at once and the address is blocked', async () => {
  const queued = await queue('unknown@example.com');
  const tally = await dispatcher.processDue();
  assert.equal(tally.failed, 1);
  const row = await db.Notification.findByPk(queued.notificationId);
  assert.equal(row.status, 'FAILED');
  assert.equal(row.attempts, 1);
  assert.match(row.lastError, /550/);
  const blocked = await db.NotificationSuppression.findOne({ where: { address: 'unknown@example.com' } });
  assert.equal(blocked.reason, 'BOUNCED');
});

test('a tenant\'s own SMTP account sends From the tenant\'s address', async () => {
  await settingsService.updateEmail(TENANT, { smtpHost: '127.0.0.1', smtpPort: port, fromName: 'City Clinic', fromAddress: 'frontdesk@clinic.example' }, { userId: 1 });
  try {
    received.length = 0;
    await queue('ravi@example.com');
    await dispatcher.processDue();
    assert.equal(received[0].from, 'frontdesk@clinic.example');
    assert.match(received[0].raw, /From: "?City Clinic"? <frontdesk@clinic\.example>/);
  } finally {
    await db.TenantChannelSetting.destroy({ where: {} }); // never leak one test's settings into the next
  }
});

test('an unreachable server is a temporary failure: retried later, never given up on early', async () => {
  const temp = await startServer(); // borrow a free port, then free it again: nothing is listening there
  const deadPort = temp.port;
  await stop(temp.smtp);
  process.env.SMTP_PORT = String(deadPort);

  const queued = await queue('later@example.com');
  const tally = await dispatcher.processDue();
  assert.equal(tally.retried, 1);
  const row = await db.Notification.findByPk(queued.notificationId);
  assert.deepEqual([row.status, row.attempts], ['PENDING', 1]);
  assert.ok(row.lastError);

  // back up on that port: the next attempt delivers it
  await startServer(deadPort);
  const later = new Date(Date.now() + 10 * 60000);
  assert.equal((await dispatcher.processDue({ now: later })).sent, 1);
});
