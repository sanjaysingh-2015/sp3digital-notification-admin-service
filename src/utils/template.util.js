/**
 * A deliberately tiny template language — no code ever runs inside a template:
 *   {{name}}                      the value of a variable
 *   {{#name}} ... {{/name}}       a block shown only when the variable is not empty
 * Values are escaped for HTML bodies, and stripped of line breaks in the subject
 * (so a variable can never inject extra mail headers).
 */
const NAME = '[A-Za-z][A-Za-z0-9_]*';
const VALUE_RE = new RegExp(`\\{\\{\\s*(${NAME})\\s*\\}\\}`, 'g');
const BLOCK_RE = new RegExp(`\\{\\{#(${NAME})\\}\\}([\\s\\S]*?)\\{\\{/\\1\\}\\}`, 'g');
const ANY_TAG_RE = new RegExp(`\\{\\{\\s*[#/]?(${NAME})\\s*\\}\\}`, 'g');

const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ').trim();

/** Every variable name a piece of template text refers to. */
function placeholdersIn(text) {
  const names = new Set();
  if (!text) return names;
  for (const match of text.matchAll(ANY_TAG_RE)) names.add(match[1]);
  return names;
}

const present = (value) => value !== undefined && value !== null && String(value).trim() !== '';

function renderString(text, variables, escape) {
  if (!text) return '';
  const withBlocks = text.replace(BLOCK_RE, (_, name, inner) => (present(variables[name]) ? inner : ''));
  return withBlocks.replace(VALUE_RE, (_, name) => (present(variables[name]) ? escape(variables[name]) : ''));
}

/** { subject, text, html } with the variables filled in. Unknown / empty variables become empty text. */
function render({ subject, bodyText, bodyHtml }, variables = {}) {
  return {
    subject: renderString(subject, variables, oneLine),
    text: renderString(bodyText, variables, (v) => String(v)),
    html: bodyHtml ? renderString(bodyHtml, variables, escapeHtml) : null,
  };
}

/** Names of required variables that were not supplied. */
function missingRequired(declared, variables = {}) {
  return (declared || []).filter((v) => v.required && !present(variables[v.name])).map((v) => v.name);
}

/** Why a tenant-written template must be refused, or null. Variables are escaped; the template's own HTML is not, so keep it inert. */
function unsafeReason(html) {
  if (!html) return null;
  if (/<\s*script/i.test(html)) return 'Scripts are not allowed in a message';
  if (/<\s*(iframe|object|embed|form)\b/i.test(html)) return 'iframes, objects, embeds and forms are not allowed in a message';
  if (/\son[a-z]+\s*=/i.test(html)) return 'Event handlers (onclick=...) are not allowed in a message';
  if (/javascript\s*:/i.test(html)) return 'javascript: links are not allowed in a message';
  return null;
}

module.exports = { render, placeholdersIn, missingRequired, unsafeReason, escapeHtml };
