import express from 'express';
import cookieParser from 'cookie-parser';
import { SESSION_TTL_MS } from './config.js';
import { createSessionStore } from './auth/sessionStore.js';
import { sessionMiddleware } from './auth/sessionMiddleware.js';
import { createSamlRouter } from './saml/routes.js';
import { createAccountRouter } from './routes/account.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function createApp({ config, saml, idp, store = createSessionStore({ ttlMs: SESSION_TTL_MS }) }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser(config.sessionSecret));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(sessionMiddleware(store, {
    secure: config.cookieSecure,
    ttlMs: SESSION_TTL_MS,
  }));

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', createAccountRouter(config));
  app.use('/api/saml', createSamlRouter({ config, saml, store, idp }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.get('/', (req, res) => {
    res
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"><title>Platform API</title>` +
          `<p>API is running. Open the demo at <a href="${escapeHtml(config.appBaseUrl)}">${escapeHtml(config.appBaseUrl)}</a>.</p>` +
          `<p>SP metadata: <a href="/api/saml/metadata">/api/saml/metadata</a></p>`,
      );
  });

  app.use((err, req, res, next) => {
    console.error(err.message);
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(400).type('text/plain').send('The SAML operation was rejected.');
  });

  return app;
}
