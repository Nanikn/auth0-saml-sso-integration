import { Router } from 'express';

export function createAccountRouter(config) {
  const router = Router();

  router.get('/me', (req, res) => {
    if (!req.sessionUser) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    res.json({ user: req.sessionUser });
  });

  router.get('/demo-links', (req, res) => {
    res.json({
      spEntityId: config.spEntityId,
      acsUrl: config.acsUrl,
      metadataUrl: `${config.appBaseUrl}/api/saml/metadata`,
      spLoginUrl: `${config.appBaseUrl}/api/saml/login`,
      idpInitiatedLoginUrl: config.idpLoginUrl,
      idpInitiatedLogoutUrl: config.idpInitiatedLogoutUrl,
    });
  });

  return router;
}
