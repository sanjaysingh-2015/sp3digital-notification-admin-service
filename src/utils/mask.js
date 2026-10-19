/** a***@example.com — enough to recognise an address, never the whole of it. */
function maskEmail(address) {
  if (!address) return null;
  const [name, domain] = String(address).split('@');
  if (!domain) return '***';
  return `${name.slice(0, 1)}***@${domain}`;
}

module.exports = { maskEmail };
