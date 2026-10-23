const { Joi } = require('../middleware/validate');
const { paginationQuerySchema } = require('../utils/pagination');
const { SUPPORTED_CHANNELS } = require('../providers');

const CATEGORIES = ['TRANSACTIONAL', 'REMINDER', 'SECURITY', 'MARKETING'];
const STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'SUPPRESSED'];

const templateKey = Joi.string().pattern(/^[A-Z][A-Z0-9_]{2,59}$/).message('template keys are UPPER_SNAKE_CASE');
// TLD list checking is off: a valid address on a newer domain ending (.clinic, .health ...) must not be refused.
const email = Joi.string().trim().email({ tlds: { allow: false } }).max(255);
const phone = Joi.string().trim().pattern(/^\+?[1-9]\d{1,14}$/).message('must be a valid E.164 phone number, e.g. +15551234567').max(20);
const hhmm = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).message('must be a time like 21:00');
const positiveId = Joi.number().integer().positive();

// Values are plain text/numbers/booleans only: nothing structured can reach a template.
const variableValue = Joi.alternatives(Joi.string().max(1000).allow(''), Joi.number(), Joi.boolean());

const toSchema = Joi.alternatives(
  Joi.object({ address: email.required(), name: Joi.string().trim().max(150).allow('', null) }),
  Joi.object({ address: phone.required(), name: Joi.string().trim().max(150).allow('', null) })
).required();

const sendSchema = Joi.object({
  templateKey: templateKey.required(),
  channel: Joi.string().valid(...SUPPORTED_CHANNELS).default('EMAIL'),
  to: toSchema,
  variables: Joi.object().pattern(Joi.string().max(60), variableValue).default({}),
  locale: Joi.string().trim().min(2).max(10).default('en'),
  scheduledAt: Joi.date().iso().optional(),
  priority: Joi.number().integer().min(1).max(9).default(5),
  idempotencyKey: Joi.string().trim().max(100).optional(),
  sourceService: Joi.string().trim().max(50).optional(),
  sourceRef: Joi.string().trim().max(100).optional(),
});

const listQuerySchema = paginationQuerySchema({
  status: Joi.string().valid(...STATUSES, '').optional(),
  templateKey: templateKey.optional(),
  sourceService: Joi.string().max(50).optional(),
  sourceRef: Joi.string().max(100).optional(),
  dateFrom: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const cancelBySourceSchema = Joi.object({
  sourceService: Joi.string().trim().max(50).required(),
  sourceRef: Joi.string().trim().max(100).required(),
  templateKey: templateKey.optional(),
});

const templateQuerySchema = Joi.object({
  channel: Joi.string().valid(...SUPPORTED_CHANNELS).default('EMAIL'),
  locale: Joi.string().trim().min(2).max(10).default('en'),
});

const templateSaveSchema = Joi.object({
  channel: Joi.string().valid(...SUPPORTED_CHANNELS).default('EMAIL'),
  locale: Joi.string().trim().min(2).max(10).default('en'),
  subject: Joi.string().trim().min(1).max(255).required(),
  bodyText: Joi.string().min(1).max(50000).required(),
  bodyHtml: Joi.string().max(100000).allow('', null),
});

const previewSchema = Joi.object({
  templateKey: templateKey.required(),
  channel: Joi.string().valid(...SUPPORTED_CHANNELS).default('EMAIL'),
  locale: Joi.string().trim().min(2).max(10).default('en'),
  variables: Joi.object().pattern(Joi.string().max(60), variableValue).default({}),
});

const channelSettingsSchema = Joi.object({
  isEnabled: Joi.boolean(),
  fromName: Joi.string().trim().max(150).allow('', null),
  fromAddress: Joi.string().trim().max(255).allow('', null),
  replyTo: Joi.string().trim().max(255).allow('', null),
  smtpHost: Joi.string().trim().max(255).allow('', null),
  smtpPort: Joi.number().integer().min(1).max(65535).allow(null),
  smtpSecure: Joi.boolean(),
  smtpUser: Joi.string().trim().max(255).allow('', null),
  smtpPassword: Joi.string().max(255).allow('', null),
  hourlyLimit: Joi.number().integer().min(1).max(100000).allow(null),
  quietHoursStart: hhmm.allow('', null),
  quietHoursEnd: hhmm.allow('', null),
}).min(1);

const emailSettingsSchema = channelSettingsSchema;

const whatsappSettingsSchema = channelSettingsSchema.keys({
  smtpHost: Joi.forbidden(),
  smtpPort: Joi.forbidden(),
  smtpSecure: Joi.forbidden(),
  smtpUser: Joi.forbidden(),
  smtpPassword: Joi.forbidden(),
  replyTo: Joi.forbidden(),
});

const smsSettingsSchema = channelSettingsSchema.keys({
  smtpHost: Joi.forbidden(),
  smtpPort: Joi.forbidden(),
  smtpSecure: Joi.forbidden(),
  smtpUser: Joi.forbidden(),
  smtpPassword: Joi.forbidden(),
  replyTo: Joi.forbidden(),
});

const testSendSchema = Joi.object({ to: Joi.alternatives(email, phone).required() });

const suppressionAddSchema = Joi.object({
  channel: Joi.string().valid(...SUPPORTED_CHANNELS).default('EMAIL'),
  address: Joi.alternatives(email, phone).required(),
  category: Joi.string().valid(...CATEGORIES).allow(null).default(null),
  reason: Joi.string().valid('UNSUBSCRIBED', 'COMPLAINT', 'CONSENT_WITHDRAWN', 'MANUAL').default('MANUAL'),
  note: Joi.string().trim().max(255).allow('', null),
});

const suppressionListQuerySchema = paginationQuerySchema({ status: Joi.string().valid('ACTIVE', 'LIFTED', '').optional() });

const idParam = Joi.object({ id: positiveId.required() });
const keyParam = Joi.object({ key: templateKey.required() });

module.exports = {
  sendSchema, listQuerySchema, cancelBySourceSchema, templateQuerySchema, templateSaveSchema, previewSchema,
  emailSettingsSchema, whatsappSettingsSchema, smsSettingsSchema, testSendSchema,
  suppressionAddSchema, suppressionListQuerySchema, idParam, keyParam,
};