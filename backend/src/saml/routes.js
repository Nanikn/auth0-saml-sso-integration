import { Router } from 'express';
import { CLOCK_SKEW_MS } from '../config.js';
import { acceptAssertion, classifySamlError } from './assertionGuard.js';
import { identityFromProfile } from './identity.js';
import { ReplayCache } from './replayCache.js';

function redirectWithError(res, appBaseUrl, err) {
  const code = classifySamlError(err);
  console.error(`SAML login rejected (${code}): ${err.message}`);
  res.redirect(`${appBaseUrl}/?error=${encodeURIComponent(code)}`);
}

export function createSamlRouter({ config, saml, store, idp }) {
  const router = Router();
  const replayCache = new ReplayCache();

  router.get('/metadata', (req, res, next) => {
    try {
      const xml = saml.generateServiceProviderMetadata(null, null);
      res.type('application/xml').send(xml);
    } catch (err) {
      next(err);
    }
  });

  router.get('/login', async (req, res, next) => {
    try {
      // RelayState is not read on the way back. The flow label comes from
      // whether the signed assertion contains InResponseTo.
      const url = await saml.getAuthorizeUrlAsync('platform');
      res.redirect(url);
    } catch (err) {
      next(err);
    }
  });

  router.post('/acs', async (req, res) => {
    try {
      const result = await saml.validatePostResponseAsync(req.body);
      if (!result?.profile) {
        throw new Error('SAML response did not contain an assertion.');
      }

      const assertionId = acceptAssertion(result.profile, {
        cache: replayCache,
        acsUrl: config.acsUrl,
        expectedIssuer: idp.issuer,
        clockSkewMs: CLOCK_SKEW_MS,
      });

      const user = identityFromProfile(result.profile, assertionId);
      res.establishSession(user);
      // Fixed destination. RelayState is attacker-controlled and is not a return URL.
      res.redirect(`${config.appBaseUrl}/home`);
    } catch (err) {
      redirectWithError(res, config.appBaseUrl, err);
    }
  });

  // SP-initiated logout. Local session dies first, then the browser is sent to
  // Auth0 /v2/logout so the Auth0 session dies too. This is not a SAML
  // LogoutRequest; see DECISIONS.md.
  router.post('/logout', (req, res) => {
    if (!req.sessionUser) {
      res.redirect(`${config.appBaseUrl}/`);
      return;
    }
    res.clearSession();
    res.redirect(config.spInitiatedLogoutUrl);
  });

  // Return target for IdP-initiated logout. Auth0 redirects the browser here
  // after /v2/logout. Top-level GET, so the SameSite=Lax cookie is present.
  router.get('/logout/callback', (req, res) => {
    res.clearSession();
    res.redirect(`${config.appBaseUrl}/logged-out/idp`);
  });

  // Receiver for a real SAML logout, if the addon later has slo_enabled.
  // The demo buttons do not send the browser here. A failed signature check
  // must not destroy sessions.
  router.post('/slo', async (req, res, next) => {
    try {
      if (req.body?.SAMLRequest) {
        const { profile } = await saml.validatePostRequestAsync(req.body);
        if (profile?.nameID) store.destroyByNameId(profile.nameID);
        res.clearSession();
        const url = await saml.getLogoutResponseUrlAsync(profile, '', {}, true);
        res.redirect(url);
        return;
      }

      if (req.body?.SAMLResponse) {
        await saml.validatePostResponseAsync(req.body);
        res.clearSession();
        res.redirect(`${config.appBaseUrl}/logged-out/sp`);
        return;
      }

      res.status(400).type('text/plain').send('Expected a SAML logout message.');
    } catch (err) {
      console.error(`SAML logout rejected: ${err.message}`);
      next(err);
    }
  });

  return router;
}
