const express = require('express');
const router = express.Router();

const c = require('../controllers/notificationController');
const { validate } = require('../middleware/validate');
const { authorize } = require('../middleware/authentication');
const { NOTIFICATION_PERMISSIONS: P } = require('../utils/permissions');
const v = require('../validations/notification.validation');

// Paths are relative to /api/v1/notification (see app.js). Other services call these with the
// shared internal token and an X-Tenant-Uuid header, which authorize() lets through.

/**
 * @openapi
 * /notifications:
 *   post:
 *     tags: [Notifications]
 *     summary: Queue a notification from a template
 *     description: >
 *       Renders the template (the tenant's wording, or the platform default) with the given values, checks the address is
 *       not suppressed, and puts it in the outbox. Answers 202 at once; delivery happens in the background with retries
 *       (1, 5, 30 minutes, 2 and 6 hours). `scheduledAt` holds it until then (a reminder for tomorrow morning). The same
 *       `idempotencyKey` twice returns the first notification (200) instead of sending again. A switched-off channel or a
 *       suppressed address does NOT fail the call: it is logged with status SUPPRESSED. 400 MISSING_VARIABLES lists any
 *       required template values you left out.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/SendRequest' }
 *     responses:
 *       202: { description: Queued }
 *       200: { description: Duplicate of an earlier request with the same idempotencyKey }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *   get:
 *     tags: [Notifications]
 *     summary: Delivery log (recipients are masked; message text is never shown)
 *     parameters:
 *       - { name: status, in: query, schema: { type: string } }
 *       - { name: templateKey, in: query, schema: { type: string } }
 *       - { name: sourceService, in: query, schema: { type: string } }
 *       - { name: sourceRef, in: query, schema: { type: string } }
 *       - { name: dateFrom, in: query, schema: { type: string, format: date } }
 *       - { name: dateTo, in: query, schema: { type: string, format: date } }
 *       - { $ref: '#/components/parameters/PageParam' }
 *       - { $ref: '#/components/parameters/LimitParam' }
 *     responses:
 *       200: { description: Paginated notifications }
 */
router.post('/notifications', authorize(P.SEND), validate(v.sendSchema), c.send);
router.get('/notifications', authorize(P.READ), validate(v.listQuerySchema, 'query'), c.list);

/**
 * @openapi
 * /notifications/cancel-by-source:
 *   post:
 *     tags: [Notifications]
 *     summary: Cancel every queued message that belongs to one thing
 *     description: >
 *       For example when an appointment is cancelled, stop its queued reminder. Body: sourceService and sourceRef (such as appointment:42).
 *     responses:
 *       200: { description: '{ cancelled: <count> }' }
 * /notifications/{id}:
 *   get:
 *     tags: [Notifications]
 *     summary: One notification with its delivery attempts
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Notification detail }
 * /notifications/{id}/cancel:
 *   post:
 *     tags: [Notifications]
 *     summary: Cancel a queued notification
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Cancelled }
 * /notifications/{id}/retry:
 *   post:
 *     tags: [Notifications]
 *     summary: Try a failed notification again
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Queued again }
 */
router.post('/notifications/cancel-by-source', authorize(P.UPDATE), validate(v.cancelBySourceSchema), c.cancelBySource);
router.get('/notifications/:id', authorize(P.READ), validate(v.idParam, 'params'), c.get);
router.post('/notifications/:id/cancel', authorize(P.UPDATE), validate(v.idParam, 'params'), c.cancel);
router.post('/notifications/:id/retry', authorize(P.UPDATE), validate(v.idParam, 'params'), c.retry);

/**
 * @openapi
 * /templates:
 *   get:
 *     tags: [Templates]
 *     summary: Message templates in effect for this tenant (its own wording where overridden, else the platform's)
 *     responses:
 *       200: { description: '{ data: [template] }' }
 * /templates/preview:
 *   post:
 *     tags: [Templates]
 *     summary: Render a template with sample values, sending nothing
 *     responses:
 *       200: { description: '{ subject, text, html }' }
 * /templates/{key}:
 *   get:
 *     tags: [Templates]
 *     summary: One template
 *     parameters:
 *       - { name: key, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The template with its variables }
 *   put:
 *     tags: [Templates]
 *     summary: Override the wording for this tenant
 *     description: >
 *       Use {{variable}} and {{#variable}}...{{/variable}} (shown only when the value is not empty). Only the template's
 *       declared variables may be used. Scripts, iframes, forms and event handlers are refused.
 *     parameters:
 *       - { name: key, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The overriding template }
 *   delete:
 *     tags: [Templates]
 *     summary: Go back to the platform wording
 *     parameters:
 *       - { name: key, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The platform template now in effect }
 */
router.get('/templates', authorize(P.TEMPLATE_READ), c.listTemplates);
router.post('/templates/preview', authorize(P.TEMPLATE_READ), validate(v.previewSchema), c.previewTemplate);
router.get('/templates/:key', authorize(P.TEMPLATE_READ), validate(v.keyParam, 'params'), validate(v.templateQuerySchema, 'query'), c.getTemplate);
router.put('/templates/:key', authorize(P.TEMPLATE_MANAGE), validate(v.keyParam, 'params'), validate(v.templateSaveSchema), c.saveTemplate);
router.delete('/templates/:key', authorize(P.TEMPLATE_MANAGE), validate(v.keyParam, 'params'), validate(v.templateQuerySchema, 'query'), c.removeTemplate);

/**
 * @openapi
 * /settings/email:
 *   get:
 *     tags: [Settings]
 *     summary: Email settings (the SMTP password is never returned, only whether one is set)
 *     responses:
 *       200: { description: Settings }
 *   put:
 *     tags: [Settings]
 *     summary: Sender identity, own SMTP account, hourly limit, quiet hours
 *     description: >
 *       With the tenant's own SMTP server, messages are sent From the tenant's address. Without one, the platform's account
 *       sends them and the tenant's address becomes Reply-To. Quiet hours hold back reminders only.
 *     responses:
 *       200: { description: Updated settings }
 * /settings/email/test:
 *   post:
 *     tags: [Settings]
 *     summary: Send a test message to an address
 *     responses:
 *       202: { description: Queued }
 */
router.get('/settings/email', authorize(P.SETTINGS), c.getEmailSettings);
router.put('/settings/email', authorize(P.SETTINGS), validate(v.emailSettingsSchema), c.updateEmailSettings);
router.post('/settings/email/test', authorize(P.SETTINGS), validate(v.testSendSchema), c.testEmail);

/**
 * @openapi
 * /suppressions:
 *   get:
 *     tags: [Suppressions]
 *     summary: Addresses that are not written to (masked)
 *     responses:
 *       200: { description: Paginated suppressions }
 *   post:
 *     tags: [Suppressions]
 *     summary: Block an address (every category except SECURITY, or one category)
 *     responses:
 *       201: { description: Suppressed }
 * /suppressions/{id}/lift:
 *   post:
 *     tags: [Suppressions]
 *     summary: Allow the address again
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Lifted }
 */
router.get('/suppressions', authorize(P.SUPPRESSION), validate(v.suppressionListQuerySchema, 'query'), c.listSuppressions);
router.post('/suppressions', authorize(P.SUPPRESSION), validate(v.suppressionAddSchema), c.addSuppression);
router.post('/suppressions/:id/lift', authorize(P.SUPPRESSION), validate(v.idParam, 'params'), c.liftSuppression);

module.exports = router;
