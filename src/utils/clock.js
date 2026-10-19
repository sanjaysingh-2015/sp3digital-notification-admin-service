/**
 * Time helpers for quiet hours. Reminders should not land in the middle of the night,
 * so "what time is it for the people being written to" is read in
 * NOTIFICATION_TIMEZONE (IANA name, default Asia/Kolkata), not the server's zone.
 * `clock.now` is a property so tests can pin the time.
 */
const timezone = () => process.env.NOTIFICATION_TIMEZONE || 'Asia/Kolkata';
const clock = { now: () => new Date() };

/** Minutes since local midnight for a moment. */
function localMinutes(at) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return Number(parts.hour) * 60 + Number(parts.minute);
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/**
 * If `at` falls inside the quiet window ("21:00" to "07:00", which may cross midnight),
 * the moment the window ends; otherwise null.
 */
function quietHoursEnd(at, start, end) {
  if (!start || !end) return null;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return null;
  const now = localMinutes(at);
  const inside = s < e ? now >= s && now < e : now >= s || now < e;
  if (!inside) return null;
  const wait = (e - now + 1440) % 1440 || 1440;
  return new Date(at.getTime() + wait * 60000);
}

module.exports = { clock, timezone, quietHoursEnd, localMinutes };
