/** a***@example.com — enough to recognise an address, never the whole of it. */
function maskEmail(address) {
  if (!address) return null;
  const [name, domain] = String(address).split('@');
  if (!domain) return '***';
  return `${name.slice(0, 1)}***@${domain}`;
}

/** +1 *** ** ** 42 — masks the middle digits of a phone number. */
function maskPhone(number) {
  if (!number) return null;
  const str = String(number);
  if (str.length <= 4) return '****';
  return `${str.slice(0, 2)} *** ${str.slice(-2)}`;
}

module.exports = { maskEmail, maskPhone };
