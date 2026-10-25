const notificationService = require('../services/notificationService');
const templateService = require('../services/templateService');
const settingsService = require('../services/settingsService');
const eventDefinitionService = require('../services/eventDefinitionService');
const suppressionService = require('../services/suppressionService');

const ctxOf = (req) => ({ tenantUuid: req.auth.tenantUuid, userId: req.auth.userId });

// Thin wrappers only — every rule lives in the services.
const handle = (fn) => async (req, res, next) => {
  try {
    const { status, body } = await fn(req);
    return res.status(status).json(body);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  // notifications
  send: handle(async (req) => {
    const result = await notificationService.send(req.body, ctxOf(req));
    return { status: result.duplicate ? 200 : 202, body: result }; // 202: accepted, delivered in the background
  }),
  list: handle(async (req) => ({ status: 200, body: await notificationService.list({ ...req.query, tenantUuid: req.auth.tenantUuid }) })),
  get: handle(async (req) => ({ status: 200, body: await notificationService.getById(req.params.id, ctxOf(req)) })),
  cancel: handle(async (req) => ({ status: 200, body: await notificationService.cancel(req.params.id, ctxOf(req)) })),
  retry: handle(async (req) => ({ status: 200, body: await notificationService.retry(req.params.id, ctxOf(req)) })),
  cancelBySource: handle(async (req) => ({ status: 200, body: await notificationService.cancelBySource({ ...req.body, tenantUuid: req.auth.tenantUuid }) })),

  // templates
  listTemplates: handle(async (req) => ({ status: 200, body: await templateService.list({ ...req.query, tenantUuid: req.auth.tenantUuid }) })),
  getTemplate: handle(async (req) => ({ status: 200, body: await templateService.get({ tenantUuid: req.auth.tenantUuid, templateKey: req.params.key, ...req.query }) })),
  saveTemplate: handle(async (req) => ({ status: 200, body: await templateService.saveOverride({ ...ctxOf(req), templateKey: req.params.key, ...req.body }) })),
  removeTemplate: handle(async (req) => ({ status: 200, body: await templateService.removeOverride({ tenantUuid: req.auth.tenantUuid, templateKey: req.params.key, ...req.query }) })),
  previewTemplate: handle(async (req) => ({ status: 200, body: await templateService.preview({ tenantUuid: req.auth.tenantUuid, ...req.body }) })),

  // templates by id (admin screen)
  getTemplateById: handle(async (req) => ({ status: 200, body: await templateService.getById({ tenantUuid: req.auth.tenantUuid, templateId: req.params.id }) })),
  createTemplate: handle(async (req) => ({ status: 201, body: await templateService.create({ ...ctxOf(req), ...req.body }) })),
  updateTemplateById: handle(async (req) => ({ status: 200, body: await templateService.updateById({ ...ctxOf(req), templateId: req.params.id, ...req.body }) })),
  removeTemplateById: handle(async (req) => ({ status: 200, body: await templateService.removeById({ tenantUuid: req.auth.tenantUuid, templateId: req.params.id }) })),

  // channel settings by id (admin screen)
  listChannelSettings: handle(async (req) => ({ status: 200, body: await settingsService.listAll(req.auth.tenantUuid) })),
  getChannelSetting: handle(async (req) => ({ status: 200, body: await settingsService.getById(req.auth.tenantUuid, req.params.id) })),
  createChannelSetting: handle(async (req) => ({ status: 201, body: await settingsService.create(req.auth.tenantUuid, req.body, ctxOf(req)) })),
  updateChannelSetting: handle(async (req) => ({ status: 200, body: await settingsService.updateById(req.auth.tenantUuid, req.params.id, req.body, ctxOf(req)) })),
  removeChannelSetting: handle(async (req) => ({ status: 200, body: await settingsService.removeById(req.auth.tenantUuid, req.params.id) })),

  // event definitions
  listEventDefinitions: handle(async (req) => ({ status: 200, body: await eventDefinitionService.list({ ...req.query, tenantUuid: req.auth.tenantUuid }) })),
  getEventDefinition: handle(async (req) => ({ status: 200, body: await eventDefinitionService.getById({ tenantUuid: req.auth.tenantUuid, eventId: req.params.id }) })),
  createEventDefinition: handle(async (req) => ({ status: 201, body: await eventDefinitionService.create({ ...ctxOf(req), ...req.body }) })),
  updateEventDefinition: handle(async (req) => ({ status: 200, body: await eventDefinitionService.update({ ...ctxOf(req), eventId: req.params.id, ...req.body }) })),
  removeEventDefinition: handle(async (req) => ({ status: 200, body: await eventDefinitionService.remove({ tenantUuid: req.auth.tenantUuid, eventId: req.params.id }) })),

  // settings
  getEmailSettings: handle(async (req) => ({ status: 200, body: await settingsService.getEmail(req.auth.tenantUuid) })),
  updateEmailSettings: handle(async (req) => ({ status: 200, body: await settingsService.updateEmail(req.auth.tenantUuid, req.body, ctxOf(req)) })),
  testEmail: handle(async (req) => {
    const sender = (await settingsService.effectiveEmail(req.auth.tenantUuid)).from.name;
    const result = await notificationService.send(
      { templateKey: 'TEST_EMAIL', to: { address: req.body.to }, variables: { senderName: sender }, priority: 1, sourceService: 'notification-service', sourceRef: 'settings-test' },
      ctxOf(req),
    );
    return { status: 202, body: result };
  }),

  getWhatsAppSettings: handle(async (req) => ({ status: 200, body: await settingsService.get(req.auth.tenantUuid, 'WHATSAPP') })),
  updateWhatsAppSettings: handle(async (req) => ({ status: 200, body: await settingsService.update(req.auth.tenantUuid, 'WHATSAPP', req.body, ctxOf(req)) })),
  testWhatsApp: handle(async (req) => {
    const sender = (await settingsService.effective('WHATSAPP', req.auth.tenantUuid)).from.name;
    const result = await notificationService.send(
      { templateKey: 'TEST_WHATSAPP', channel: 'WHATSAPP', to: { address: req.body.to }, variables: { senderName: sender }, priority: 1, sourceService: 'notification-service', sourceRef: 'settings-test' },
      ctxOf(req),
    );
    return { status: 202, body: result };
  }),

  getSmsSettings: handle(async (req) => ({ status: 200, body: await settingsService.get(req.auth.tenantUuid, 'SMS') })),
  updateSmsSettings: handle(async (req) => ({ status: 200, body: await settingsService.update(req.auth.tenantUuid, 'SMS', req.body, ctxOf(req)) })),
  testSms: handle(async (req) => {
    const sender = (await settingsService.effective('SMS', req.auth.tenantUuid)).from.name;
    const result = await notificationService.send(
      { templateKey: 'TEST_SMS', channel: 'SMS', to: { address: req.body.to }, variables: { senderName: sender }, priority: 1, sourceService: 'notification-service', sourceRef: 'settings-test' },
      ctxOf(req),
    );
    return { status: 202, body: result };
  }),

  // suppressions
  listSuppressions: handle(async (req) => ({ status: 200, body: await suppressionService.list({ ...req.query, tenantUuid: req.auth.tenantUuid }) })),
  addSuppression: handle(async (req) => ({ status: 201, body: await suppressionService.add({ ...req.body, ...ctxOf(req) }) })),
  liftSuppression: handle(async (req) => ({ status: 200, body: await suppressionService.lift(req.params.id, ctxOf(req)) })),
};
