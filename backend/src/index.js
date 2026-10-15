import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createSamlClient, loadIdentityProvider } from './saml/createClient.js';

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error('Node.js 20 or newer is required.');
  process.exit(1);
}

function banner(config, idp) {
  console.log('');
  console.log('Platform SAML service provider');
  console.log(`  SP entity ID     ${config.spEntityId}`);
  console.log(`  ACS URL          ${config.acsUrl}`);
  console.log(`  SP metadata      ${config.appBaseUrl}/api/saml/metadata`);
  console.log(`  IdP issuer       ${idp.issuer} (${idp.source})`);
  console.log(`  IdP login URL    ${config.idpLoginUrl}`);
  console.log(`  API listening    http://localhost:${config.port}`);
  console.log(`  Open the demo    ${config.appBaseUrl}`);
  console.log('');
  console.log('Auth0 must use that ACS URL and entity ID. Browser traffic goes to the demo URL.');
  console.log('');
}

async function main() {
  const config = loadConfig();
  const idp = await loadIdentityProvider(config);
  const saml = createSamlClient(config, idp);
  const app = createApp({ config, saml, idp });
  app.listen(config.port, () => banner(config, idp));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
