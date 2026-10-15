const REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

function readElements(xml, tagName) {
  const expression = new RegExp(`<(?:[\\w]+:)?${tagName}\\b([^>]*)\\/?>`, 'g');
  const found = [];
  for (const match of xml.matchAll(expression)) {
    const attrs = match[1];
    found.push({
      binding: attrs.match(/\bBinding="([^"]+)"/)?.[1] ?? null,
      location: attrs.match(/\bLocation="([^"]+)"/)?.[1] ?? null,
    });
  }
  return found;
}

function preferRedirect(services) {
  return (
    services.find((service) => service.binding === REDIRECT_BINDING && service.location)?.location
    ?? services.find((service) => service.location)?.location
    ?? null
  );
}

function signingCertificates(xml) {
  const blocks = xml.split(/<(?:[\w]+:)?KeyDescriptor\b/).slice(1);
  const certs = [];
  for (const block of blocks) {
    const openEnd = block.indexOf('>');
    const open = openEnd === -1 ? block : block.slice(0, openEnd);
    const use = open.match(/\buse="([^"]+)"/)?.[1];
    if (use === 'encryption') continue;
    const body = block.split(/<\/(?:[\w]+:)?KeyDescriptor>/)[0];
    for (const match of body.matchAll(/<(?:[\w]+:)?X509Certificate>\s*([^<]+?)\s*<\/(?:[\w]+:)?X509Certificate>/g)) {
      certs.push(match[1].replace(/\s+/g, ''));
    }
  }
  return certs;
}

/**
 * Pulls the fields we need out of Auth0's IdP metadata.
 * Auth0 publishes this at /samlp/metadata/{clientId}. We trust it only as
 * configuration we fetch from the tenant we were given, then pin those certs
 * for signature checks. We do not re-fetch per login.
 */
export function parseIdpMetadata(xml) {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new Error('IdP metadata was empty.');
  }

  const entityId = xml.match(/\bentityID="([^"]+)"/)?.[1] ?? null;
  const certs = signingCertificates(xml);
  return {
    entityId,
    certs,
    ssoUrl: preferRedirect(readElements(xml, 'SingleSignOnService')),
    sloUrl: preferRedirect(readElements(xml, 'SingleLogoutService')),
  };
}
