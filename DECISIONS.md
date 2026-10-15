# Decisions

This is the reasoning behind the demo, including the parts of the ticket I did not take at face value.

## What I did with the ticket

The ticket says to put Auth0 in front of the platform with SAML, let a customer start either at Auth0 or on our login page, and that it should be straightforward because similar integrations exist.

I did not start from a generic "add Auth0 login" guide. Most of those guides make Auth0 the application (OIDC) or make Auth0 the service provider in front of Okta or Azure AD. Neither is this ticket. The ticket names SAML and names Auth0 as the identity provider, so our app is the service provider.

A few gaps were large enough that building past them without writing them down would have produced the wrong system.

## The ambiguity I would escalate

"Customers should be able to log in" plus "Auth0 as our Identity Provider" can mean two products:

1. **One directory.** Auth0 holds the users. Our app trusts Auth0's SAML assertions. Every customer is a user in that tenant.
2. **Customer SSO.** Each customer brings Okta, Azure AD, or their own Auth0. Our app, or Auth0 acting as a broker, trusts those IdPs. "Auth0" in the ticket might mean the broker, not the place the passwords live.

I built (1). The ticket says Auth0 is the IdP, and the assignment says one IdP config is enough. (2) is a different shape: per-tenant metadata, issuer allow-lists, and a way to choose which IdP a login starts at. I would not discover that from a working demo of (1).

If a stakeholder says "customers" and means their IT department, stop and redesign before adding more flows to this app.

## Questions I would have asked

| Question | What I assumed |
| --- | --- |
| Is Auth0 the directory, or a broker in front of each customer's IdP? | Auth0 is the directory. One tenant. |
| Which claims does the product need? | Email and name for display. Auth0 `user_id` as the stable subject. |
| Do we have to support IdP-initiated, or is "start at Auth0" just a bookmark to our login page? | Real IdP-initiated SAML: no `AuthnRequest`, unsolicited response to the ACS. A button that hits `/api/saml/login` would be SP-initiated either way, so the UI link goes to `https://{domain}/samlp/{clientId}`. |
| Where does this run? | A reviewer's laptop. HTTP on localhost. No hosting. |
| Is logout in scope? | The original ticket does not mention it. I implemented a pragmatic version and wrote the SAML SLO limits below, because the assignment asks for one or the other. |
| How long is a session, and what ends it? | Eight hours, or an explicit logout. The assertion is only an authentication event. It is not the session. |
| Who is allowed in? | Anyone Auth0 will authenticate for this application. No role check. The assignment says authentication only. |

## What I think is wrong or incomplete in the ask

- **"Should be straightforward."** The two login directions are not a flag on one button. SP-initiated must send `AuthnRequest` and later require `InResponseTo`. IdP-initiated must accept a response that has no `InResponseTo`, and then something else has to stop replay. Getting those to share one ACS without weakening the SP path is the actual work.
- **Auth0's own docs push the other role.** The Enterprise SAML connection screen makes Auth0 the service provider. Following the most prominent SAML doc would fail the assignment. Setup steps in the README point at the application addon on purpose.
- **No statement of the subject identifier.** Email is the obvious display value and a bad primary key. I split them.
- **No operational bounds.** Clock skew, assertion lifetime, and what happens when the API process restarts are product behavior. I picked demo-sized values and recorded them below rather than leaving the library defaults (`InResponseTo` validation off, SHA-1 when signing).
- **Logout was added later as a stretch.** I did not let it eat the login work. The logout that is wired to the UI is deliberately not full Single Logout.

## Validation

`@node-saml/node-saml` verifies signatures. I did not write XML signature code. The options that matter are in `buildSamlOptions`:

- `wantAssertionsSigned: true` and `wantAuthnResponseSigned: false`. Auth0 signs the assertion by default. `signResponse: true` in the addon signs the response *instead of* the assertion, so the README tells the reviewer not to flip it.
- `audience` is our entity id, `urn:platform:sp`. The library rejects a different `AudienceRestriction`. This has to be configured on Auth0's side for IdP-initiated login, because there is no request to copy it from.
- `validateInResponseTo: "ifPresent"`. `"always"` is stricter and also rejects every IdP-initiated login, so it cannot be the setting for this ticket. `"ifPresent"` still stores our `AuthnRequest` id and deletes it when a matching response is accepted, so an SP-initiated response cannot be posted twice and an unsolicited response cannot arrive carrying one of our ids. `"never"` would leave the SP path replayable.
- `maxAssertionAgeMs` is 10 minutes from `IssueInstant`. `acceptedClockSkewMs` is 2 minutes. A reviewer can sit on the Auth0 form as long as they like; the clock starts when Auth0 issues the assertion.

The library does not compare `SubjectConfirmationData/@Recipient` to the ACS URL. I checked. `acceptAssertion` does that comparison against the ACS URL from configuration, not from the request Host header. A signed assertion aimed at some other ACS is rejected even if the audience were somehow right.

Replay of the assertion itself is a separate cache of the assertion `ID`, kept until `NotOnOrAfter` plus the clock skew. That covers IdP-initiated responses, which have no `InResponseTo`. The cache check-and-set is synchronous so two copies of the same POST in one process cannot both pass. The id is recorded even when a later issuer or recipient check fails, so a bad assertion cannot be retried after a config tweak inside its validity window.

The IdP signing cert is taken from Auth0's metadata document at process start. It is not refreshed per request. Restart the process to pick up a rotated cert. That is acceptable for a demo and not acceptable for production; see "Another day".

`idpIssuer` in node-saml applies to logout messages, not to login assertions. Login issuer is compared in `acceptAssertion` to the `entityID` from that same metadata document.

RelayState is ignored as a redirect target. After a successful ACS the browser always goes to `/home`. The flow label is `sp-initiated` when the verified profile has `InResponseTo`, and `idp-initiated` when it does not.

## Session and how a user would be keyed

The cookie holds a random id, HMAC-signed, `HttpOnly`, `SameSite=Lax`, and not readable to script. The record lives in a `Map` on the API process. No database, as the assignment allows. Restarting the API logs everyone out. That is the right failure mode for a demo, and it is also why this store is not the production one.

I did not put a JWT in the cookie. Logout, including logout initiated at Auth0, has to revoke a session the browser still has. A signed JWT would stay valid until expiry unless I kept a denylist, which is a session store with extra steps.

The UI and the API share `http://localhost:5173` because Vite proxies `/api`. Auth0 posts the assertion to that origin. One origin keeps the cookie, the ACS URL, and the allowed-callback list as the same string. Splitting the UI and the API across ports works on paper (`SameSite` is not port-specific) and wastes review time when it does not.

Production would move the `Map` to Redis (or similar) with the same TTL, shared by every API process, and the node-saml `InResponseTo` cache would move with it. The library's memory cache is per process. Two nodes without a shared cache will reject a legitimate SP-initiated response that lands on the node that did not create the request, or, worse, accept a replay the other node already consumed if we only kept assertion ids locally.

**JIT provisioning, if we had a user table.** Upsert on `NameID`, which we configure to be the Auth0 `user_id`. Store email and name as mutable attributes. Do not key the row on email. Do not key it on assertion id or session index; those change every login. On each accepted assertion, update the profile columns and the last-login time, then issue our session. A deleted Auth0 user stops being able to mint assertions; they do not automatically lose a session they already have, until we add the logout path below or an admin revoke.

I would not create the row before the assertion is fully accepted. A failed signature must not write.

## Why the UI is two cards

A reviewer who only has the UI should be able to see which flow they are about to start, and which one created the session they are looking at. The IdP card shows the Auth0 URL so it is obvious it does not go through `/api/saml/login`. The signed-in page reads `loginFlow` from `/api/me`. Adding `?flow=` on the redirect would let anyone relabel a session by editing the address bar.

## Logout

Wired to the buttons:

- **SP-initiated.** `POST /api/saml/logout` deletes the local session, then redirects to Auth0 `GET /v2/logout` with `returnTo` set to `/logged-out/sp`. `client_id` is required by Auth0 whenever `returnTo` is set. Both return URLs are on the Allowed Logout URLs list.
- **IdP-initiated.** The button is a link to the same Auth0 logout endpoint with `returnTo` set to `/api/saml/logout/callback`. The app is not contacted until Auth0 sends the browser back. That GET deletes the local session and shows `/logged-out/idp`. It is a top-level navigation, so the `SameSite=Lax` cookie is sent. The page then calls `/api/me` and shows that the session is gone.

What this does not do:

- It does not send a signed SAML `LogoutRequest`, and it does not require a signed `LogoutResponse` on the path the buttons use.
- `slo_enabled` is false in the addon settings so Auth0's SAML logout does not race the `returnTo` redirect. The JSON still contains the callback URL.
- If someone logs out in the Auth0 dashboard and never hits our callback, our session remains. Our store is the source of truth for "can call `/api/me`". Auth0 is the source of truth for "can mint a new assertion without a password". Those can diverge. The bad case is a stolen `platform.sid` cookie that keeps working after the user thinks Auth0 logout covered every app.
- The IdP return URL is a GET. Another site can navigate the browser there and clear the local session. That is logout CSRF, not a way to sign in. I would not ship that GET without a one-time `state` value in a real product.
- Other applications in the same Auth0 tenant are unaffected unless the logout is tenant-wide. `/v2/logout` with `client_id` ends the Auth0 session, which is what we want for "ask for the password again".

There is a second endpoint, `POST /api/saml/slo`, that is not used by the buttons. If a signed SAML `LogoutRequest` arrives, node-saml checks the signature and we delete every local session for that `NameID`, then redirect a `LogoutResponse` back to Auth0. A failed signature does not delete anything. The NameID index exists because a cross-site POST from Auth0 will not include a `SameSite=Lax` cookie, so the cookie alone cannot find the session.

Given another few hours of logout work, in this order:

1. Generate an SP signing key, publish the cert in our metadata, and register it with the addon so Auth0 will accept a signed `LogoutRequest`.
2. Change **Log out** to `getLogoutUrlAsync` with `nameID`, `nameIDFormat`, and `sessionIndex` from the session, then destroy the local session only after a valid `LogoutResponse` — and still destroy it if the browser never comes back, via a short timer, so a dropped redirect cannot leave us logged in forever. Today we destroy first so a failed Auth0 round-trip cannot leave the app session alive. That favors the stolen-cookie case over "Auth0 logout failed, keep me signed in". I would keep that bias.
3. Turn `slo_enabled` on and point `logout.callback` at `/api/saml/slo`. Confirm in the Auth0 logs that a dashboard logout delivers a signed `LogoutRequest`, and that our NameID index clears the session without the cookie.
4. Add the one-time `state` on any browser return URL that clears a session.

I would not block the login submission on that work. SAML SLO between Auth0 and a custom SP is easy to wire and annoying to prove, and a half-working SLO that deletes sessions on an unsigned message would be worse than `/v2/logout`.

## What I left out on purpose

Production cert rotation, multi-tenant SAML, RBAC, SCIM, a user database, polished UI, deployment, and refresh of IdP metadata while the process is up. The assignment lists those as out of scope. A persistent user table would be the first thing I add if the product decision in the first section is confirmed, and it would still be a key-value row keyed by `NameID`, not a role system.

`disableRequestedAuthnContext` is on because Auth0 database authentication often does not satisfy `PasswordProtectedTransport` exactly, and the user then sees a failure after a correct password. We accept the class Auth0 sends. The signature and audience checks do not depend on that class.

## Another day

1. Confirm with the stakeholder that Auth0-as-directory is the product, and write down the JIT row shape above in the schema if it is.
2. Shared session and replay stores, so more than one API process is safe.
3. Fetch IdP metadata on a timer, pin the previous cert until the new one has been seen, and alert if `entityID` changes.
4. Signed `AuthnRequest` and the SLO steps above.
5. An integration test that stands up a tiny local IdP and posts a real signed assertion through the ACS. The current tests stub node-saml at the HTTP boundary and use the real `SAML` class only to confirm metadata and options. They do not prove a forged signature fails. That proof is the library's job, and I would still want one end-to-end fixture before this left a demo.

## AI tools

I used Cursor (Grok) to scaffold this repository from the assignment, to check the current `@node-saml/node-saml` options (`validateInResponseTo`, what `signResponse` does on Auth0, and that Recipient is not checked by the library), and to draft the UI and tests. I would walk a reviewer through `buildSamlOptions`, `acceptAssertion`, and the logout section above without the tool. The choices that need defending are the ones in this file: Auth0 as the directory rather than a broker, `ifPresent` plus an assertion-ID cache, `user_id` as `NameID`, an in-memory revocable session, and `/v2/logout` instead of an unfinished Single Logout.
