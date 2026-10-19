const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const basePath = '/api/v1/notification';

module.exports = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'SP3 Digital — Notification Service API',
      version: '1.0.0',
      description:
        'One place that delivers messages for the whole platform. Services say which template to send and with what values; ' +
        'this service renders it with the tenant\'s wording, queues it, delivers it in the background with retries, respects ' +
        'suppression and quiet hours, and keeps a delivery log. Email today; other channels plug in behind the same API.\n\n' +
        'Every route below `' + basePath + '` (other than `/health`) needs either a bearer token from identity-admin-service ' +
        '(permissions `notification-admin:*`) or, for other services, the shared internal token with an `X-Tenant-Uuid` header. ' +
        'Message bodies are wiped once delivered; recipients are always masked in responses.',
    },
    servers: [{ url: basePath }],
    tags: [
      { name: 'Health', description: 'Liveness check (no auth)' },
      { name: 'Notifications', description: 'Queue, list, cancel and retry messages' },
      { name: 'Templates', description: 'Platform templates and per-tenant overrides' },
      { name: 'Settings', description: 'Sender identity, own SMTP account, limits, quiet hours' },
      { name: 'Suppressions', description: 'Addresses that must not be written to' },
    ],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      parameters: {
        PageParam: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        LimitParam: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      },
      responses: { ValidationError: { description: 'Request validation failed' } },
      schemas: {
        SendRequest: {
          type: 'object',
          required: ['templateKey', 'to'],
          properties: {
            templateKey: { type: 'string', example: 'APPOINTMENT_CONFIRMATION' },
            channel: { type: 'string', enum: ['EMAIL'], default: 'EMAIL' },
            to: { type: 'object', required: ['address'], properties: { address: { type: 'string', format: 'email' }, name: { type: 'string' } } },
            variables: { type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] }, example: { patientName: 'Asha Verma', appointmentDate: 'Wed, 14 Oct 2026', startTime: '11:00', serviceName: 'General consultation', facilityName: 'SP Healthcare' } },
            locale: { type: 'string', default: 'en' },
            scheduledAt: { type: 'string', format: 'date-time', description: 'Not before this moment' },
            priority: { type: 'integer', minimum: 1, maximum: 9, default: 5, description: '1 = most urgent' },
            idempotencyKey: { type: 'string', description: 'The same key twice returns the first notification' },
            sourceService: { type: 'string', example: 'appointment-admin-service' },
            sourceRef: { type: 'string', example: 'appointment:42' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [path.join(__dirname, '../routes/*.js'), path.join(__dirname, '../app.js')],
});
