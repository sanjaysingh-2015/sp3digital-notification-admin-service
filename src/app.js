require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const swaggerSpec = require('./config/swagger');
const db = require('./models');
const { authenticate } = require('./middleware/authentication');
const routes = require('./routes/notificationRoutes');
const templateService = require('./services/templateService');
const { startWorker } = require('./worker/dispatcher');

const app = express();

// Swagger UI needs inline scripts/styles, so /docs gets a relaxed CSP and is
// registered before the strict global helmet() (same pattern as the other services).
app.use('/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'SP3 Digital — Notification Service API Docs',
}));
app.get('/docs.json', (req, res) => res.json(swaggerSpec));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);

app.use(helmet());
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins, credentials: true } : undefined));
app.use(express.json({ limit: '1mb' }));

// Other services send in bursts (a day's reminders), so the limit is generous.
const apiRateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 3000, standardHeaders: true, legacyHeaders: false });

const basePath = '/api/v1/notification';

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Liveness check
 *     security: []
 *     responses:
 *       200: { description: Service is up }
 */
app.get(`${basePath}/health`, (req, res) => res.status(200).json({ status: 'ok' }));

app.use(basePath, apiRateLimiter, authenticate, routes);

// Same error envelope as the other admin services.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.isJoi) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.details.map((d) => d.message) },
    });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }

  if (!error.statusCode || error.statusCode >= 500) console.error(error.message);
  return res.status(error.statusCode || 500).json({
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.expose ? error.message : 'An unexpected error occurred',
      ...(error.expose && error.details ? { details: error.details } : {}),
    },
  });
});

const PORT = process.env.PORT || 3500;

async function startServer() {
  try {
    await db.sequelize.authenticate();
    await templateService.ensureDefaults(); // the platform's shipped templates
    console.log('Database connection established successfully.');
    app.listen(PORT, () => console.log(`sp3digital-notification-service running on port ${PORT}`));
    if (process.env.NOTIFICATION_WORKER !== 'false') {
      startWorker();
      console.log('Delivery worker running in this process (set NOTIFICATION_WORKER=false to run it separately with `npm run worker`).');
    }
  } catch (error) {
    console.error('Unable to start notification-service:', error.message);
  }
}

// Only auto-start when run directly; tests `require` the configured app.
if (require.main === module) startServer();

module.exports = app;
