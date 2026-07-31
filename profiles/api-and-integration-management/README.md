# API and Integration Management Profile

**Status: Experimental. Implemented in v0.1, 13 rules, 11 of them enforceable.**

The enforceable rules are in [profile.json](profile.json).

```bash
auditmodel check-profile examples/profiles/api-and-integration-management/valid --profile api-and-integration-management
```

## Purpose

An integration is a standing hole in a trust boundary. Somebody opened it, somebody widened it, and
one day somebody will ask when. The events that answer that question — an API key issued, a webhook
pointed somewhere new, a connector authorized against a third party — are administrative events that
happen rarely and matter enormously, and they are routinely the thinnest events a platform emits,
because the engineering attention goes to the traffic rather than to the administration of it.

This profile states what those administrative events have to carry: who decided, how they were
authenticated, which integration point changed, which external party is on the other side, why a
withdrawal happened, and what changed in a reconfiguration. It states equally clearly what must never
appear in them — the key, the token, the client secret, the signing secret, the callback URL.

## Scope

Applications that issue and manage API credentials, that let an operator subscribe an external
destination to their events, or that connect to third-party systems: SaaS platforms, integration
platforms, developer portals, API gateways with a management plane, and any product with an
"Integrations" or "Developer" settings page.

The profile is vendor-neutral. It describes operations any integration surface performs. It assumes
no particular authorization protocol, no particular transport, no particular hosting model, and no
particular approval workflow. It does not require `/request/protocol`, `/request/traceId` or any
other field that presupposes a specific technology stack.

## Event families

| Family                   | Events                                                                      | Governed |
| ------------------------ | --------------------------------------------------------------------------- | -------- |
| API credential lifecycle | `api-key.create`, `.rotate`, `.revoke`, `.delete`                           | yes      |
| Webhook administration   | `webhook.create`, `.update`, `.enable`, `.disable`, `.delete`, `.test`      | yes      |
| Integration lifecycle    | `integration.connect`, `.disconnect`, `.enable`, `.disable`, `.reauthorize` | yes      |
| Integration settings     | `integration.configuration.*`                                               | yes      |
| Sync administration      | `integration.sync.start`, `integration.sync.cancel`                         | yes      |
| API traffic              | `api.request` and every other data-plane request                            | **no**   |
| Webhook delivery         | `webhook.delivery.*`                                                        | **no**   |
| Sync execution           | `integration.sync.progress` and other per-page or polling events            | **no**   |

## Explicit exclusions

**The data plane is not governed, and cannot be governed by accident.**

An API gateway emits one event per request. A webhook dispatcher emits one per delivery attempt, and
retries multiply it. A polling connector emits one per page for as long as it runs. Requiring an
authorization decision, an integration classification and a justification on each of those would put
the profile's cost squarely on the highest-volume events in the system, in exchange for almost no
review value — and the requirement would be switched off rather than met.

The exclusion is **structural**, not a matter of discipline. Every selector in this profile is either
an exact event name or the single narrow prefix `integration.configuration.`. **No selector uses a
bare `api.`, `api-key.`, `webhook.` or `integration.` prefix**, so `api.request`,
`webhook.delivery.attempt`, `integration.sync.progress` and `api-key.verify` match no rule at all and
`check-profile` reports them as not applicable. Three fixtures and a test hold that boundary in
place, because widening one prefix later would silently start governing every request, delivery and
poll in a deployment.

Excluded does not mean unaudited. A delivery attempt is still a conforming OpenAuditModel event;
[data-access.md](../../semantic-conventions/data-access.md) and
[correlation-and-tracing.md](../../semantic-conventions/correlation-and-tracing.md) cover recording
traffic. This profile simply makes no additional demands of it.

## Rules

| Rule                     | Applies to                                                              | Requires                                                                 |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `INTEGRATION-CORE-001`   | every governed event                                                    | `/authorization`, `/metadata/integration/type`                           |
| `INTEGRATION-CORE-002`   | every governed event                                                    | _recommends_ `/reason`, `/approval`, correlation ID, provider            |
| `INTEGRATION-CORE-003`   | every governed event where the producer declared approval was required  | `/approval`, `/approval/status`                                          |
| `INTEGRATION-AUTHN-001`  | credential and connection operations where `actor.type` is `user`       | `/authentication`                                                        |
| `INTEGRATION-AUTHN-002`  | the same operations where `actor.type` is `admin`                       | `/authentication`                                                        |
| `INTEGRATION-KEY-001`    | `api-key.create`, `.rotate`, `.revoke`, `.delete`                       | `/metadata/integration/credentialReference`                              |
| `INTEGRATION-KEY-002`    | `api-key.create`, `api-key.rotate`                                      | _recommends_ scope, expiry, `/resource/ownerId`                          |
| `INTEGRATION-REVOKE-001` | revocations, deletions, disablements, disconnections, sync cancellation | `/reason`                                                                |
| `INTEGRATION-HOOK-001`   | every webhook administration event                                      | `/metadata/integration/webhookId`, `/metadata/integration/endpointClass` |
| `INTEGRATION-CONFIG-001` | `webhook.update`, `integration.configuration.*`                         | `/change`; recommends `/change/changedFields`                            |
| `INTEGRATION-CONN-001`   | every `integration.*` governed event                                    | `/metadata/integration/connectionId`, `/metadata/integration/provider`   |
| `INTEGRATION-FLOW-001`   | `integration.connect`, `.reauthorize`, `sync.start`, `sync.cancel`      | `/request/correlationId`                                                 |
| `INTEGRATION-FAIL-001`   | every governed event whose outcome is `failure`                         | `/event/error/type`                                                      |

`INTEGRATION-CORE-002` and `INTEGRATION-KEY-002` are `warning` rules: they never fail conformance.
The other eleven are `error` rules. Each rule's full text and rationale is in
[profile.json](profile.json).

## Metadata namespace

Everything this profile requires under `metadata` lives at `/metadata/integration/`. Namespacing is
not decoration: an event can be governed by two profiles at once, and `type`, `provider` and
`expiresAt` mean different things to a secrets profile and to this one. A root key such as
`/metadata/type` would be a collision waiting to happen.

| Field                 | Type    | Meaning                                                                                                     |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `type`                | string  | Kind of integration point: `api-credential`, `outbound-webhook`, `service-connector`, `data-sync-connector` |
| `provider`            | string  | Stable logical name of the party on the other side. Never a URL, never a legal entity name                  |
| `connectionId`        | string  | Identifier of the connection instance                                                                       |
| `webhookId`           | string  | Identifier of the webhook subscription                                                                      |
| `credentialReference` | string  | Non-secret handle for the credential material. **Never the credential**                                     |
| `endpointClass`       | string  | Where a callback goes: `internal-service`, `partner-network`, `public-internet`, `unknown`                  |
| `approvalRequired`    | boolean | Producer's declaration that local policy required approval for this change                                  |
| `scope`               | string  | What a credential may do. Recommended at issuance                                                           |
| `expiresAt`           | string  | When a credential stops working. Recommended at issuance                                                    |

All vocabularies above are open. The profile requires that the field be present and be a string; it
never says which strings are legal, because an integration taxonomy is an operator's decision.

The table lists only the fields some rule requires or recommends. The namespace is not closed:
producers may add their own descriptive fields beside them, and the fixtures do — `eventSelection` on
a webhook, `syncMode` on a sync, `deliveryAttempt` and `pageNumber` on the ungoverned data-plane
examples. No rule constrains those, and none is needed for conformance.

## Conditional-policy fields

Four rules are conditional, and each fires on exactly one producer-set discriminator:

| Rule                    | Fires when                                         |
| ----------------------- | -------------------------------------------------- |
| `INTEGRATION-CORE-003`  | `/metadata/integration/approvalRequired` is `true` |
| `INTEGRATION-AUTHN-001` | `/actor/type` is `"user"`                          |
| `INTEGRATION-AUTHN-002` | `/actor/type` is `"admin"`                         |
| `INTEGRATION-FAIL-001`  | `/event/outcome` is `"failure"`                    |

When a condition's path is absent, the condition does not hold and the rule contributes nothing. That
is the engine's defined behaviour and it is the reason `approvalRequired` should be recorded as
`false` rather than omitted: `false` is an answer, absence is silence.

## Approval model

**Approval is never universally required.** Whether an outbound webhook needs two sign-offs or none
is an operator's policy, not this specification's, and a profile that demanded approval for every
integration change would describe one organization's process and be ignored everywhere else.

The profile therefore takes the producer's word for it. `INTEGRATION-CORE-002` recommends `/approval`
on every governed event, so its absence is visible as a warning. `INTEGRATION-CORE-003` requires
`/approval` and `/approval/status` **only** when the producer has set
`/metadata/integration/approvalRequired` to `true` — the same shape as the IAM profile's privileged
flag and the document profile's external-share flag.

Recording `approval: { "status": "not-required" }` is the recommended way to say that no approval was
needed. It answers the reviewer's question instead of leaving a hole where the answer would be. Most
of the valid fixtures do exactly that.

## Privacy considerations

This is the profile with the highest chance of a producer putting a live credential in an audit
event, because the events are _about_ credentials. The following MUST NOT appear anywhere in an
event, in `metadata`, `extensions`, `change.before`, `change.after`, `resource.attributes`,
`event.summary`, `event.error.message` or `reason.text`:

- API key values, at issuance or rotation
- OAuth access tokens, refresh tokens, authorization codes and client secrets
- Webhook signing secrets and HMAC keys
- `Authorization` header values of any kind
- Signed or tokenized callback URLs, and any URL carrying a query string

The profile is built so that a producer never needs to. `credentialReference` exists so there is a
non-sensitive place to put "which key"; `endpointClass` exists so there is a non-sensitive place to
put "where the data goes". Requiring the full callback URL would have been the obvious design, and it
would have turned every conforming audit trail into a credential store, because delivery URLs
routinely carry shared secrets in their path or query string.

`INTEGRATION-CONFIG-001` requires `/change` but neither requires nor recommends `/change/before` or
`/change/after`, for the same reason: integration configuration is full of endpoints and headers.
Changed field names are the recommended form of the answer.

Every fixture in this profile — valid, invalid and not-applicable alike — is required by test to
pass `auditmodel lint-privacy`, and CI runs the command over `valid/`. A profile that accepted an event
carrying a credential would be worse than no profile at all. See
[specification/privacy.md](../../specification/privacy.md).

## Known rule-language limitations

The v0.1 rule language checks presence, JSON type and strict scalar equality against a single
condition. These are the places this profile wanted more and did not get it:

- **No disjunction.** `INTEGRATION-AUTHN-001` and `INTEGRATION-AUTHN-002` are the same requirement
  written twice because `actor.type` cannot be compared against `"user"` **or** `"admin"` in one
  rule. A deployment that models operators under some other core principal type is not caught.
- **No cross-field comparison.** The profile cannot assert that `approval.receivedApprovals` reaches
  `approval.requiredApprovals`, nor that an event with `approvalRequired: true` does not carry
  `approval.status: "not-required"` — a contradiction the engine cannot see.
- **No numeric ranges.** `requiredMetadata` checks that a value is a `number` or an `integer`. It
  cannot require that an expiry is within a maximum lifetime, or that a retry count is bounded.
- **No string patterns.** The profile can require that `endpointClass` is a string. It cannot require
  that it comes from a vocabulary, and it cannot reject a full URL stored there. The privacy linter
  is the backstop for the second one, not the profile.
- **No array-content predicates.** `change.changedFields` cannot be required to contain a particular
  entry, and `approval.approvers` cannot be required to exclude the actor — which is exactly how a
  self-approval would be detected.
- **Absence and falsity are different, and only one is checkable.** A rule fires on
  `approvalRequired: true` and stays silent on both `false` and absent. Recording `false` explicitly
  is a documentation convention this profile recommends; it is not something the engine can compel.

Each of these is guidance in this README rather than a rule, deliberately. A profile that pretended
to enforce something it cannot check would be worse than one that says plainly where it stops.

## Cross-profile overlaps

**`secrets-and-key-management`.** The overlap is real and it is intentional. That profile governs the
**security lifecycle of secret and key material** — how material is generated, stored, rotated,
escrowed and destroyed. This profile governs the **lifecycle and configuration of APIs, webhooks and
external integrations** — which integration points exist, who opened them, where they point and why
they were closed.

An API key rotation sits in the intersection, and it may legitimately conform to either profile
depending on the producer's vocabulary and which control domain the producer intends the event to
serve. The two profiles deliberately do **not** use identical selectors, and neither claims the
event exclusively. If a producer wants the event to satisfy both, it can: both profiles only add
requirements, both namespace their metadata, and nothing in one contradicts the other. Check against
both and the event must satisfy the union.

**`identity-and-access-management`.** `identity.credential.rotate` is the IAM profile's view of a
credential belonging to a **principal**. `api-key.rotate` here is the view of a credential belonging
to an **integration**. Producers whose API keys are modelled as principal credentials should use the
IAM vocabulary; producers whose keys are modelled as integration configuration should use this one.

**`deployment-and-change-management`.** An integration configuration change made through a pipeline
is both a configuration change and a deployment. `/change/deploymentId` is the core field that links
them; this profile requires neither profile's fields of the other.

## Fixture matrix

[examples/profiles/api-and-integration-management/](../../examples/profiles/api-and-integration-management/)
— thirteen valid, twelve invalid, three not applicable.

| Kind              | Count | Guarantee                                                                       |
| ----------------- | ----- | ------------------------------------------------------------------------------- |
| `valid/`          | 13    | Core-valid, privacy-clean, conforming (exit 0)                                  |
| `invalid/`        | 12    | Core-valid, privacy-clean, failing **exactly one** rule at a documented pointer |
| `not-applicable/` | 3     | Core-valid, privacy-clean, governed by no rule (exit 3)                         |

Every one of the eleven enforceable rules has at least one negative fixture;
`INTEGRATION-CORE-001` has two, one for each field it requires.

## Not-applicable rationale

Three fixtures exist to prove an exclusion rather than to demonstrate a requirement:

- `api-request.json` — an ordinary authenticated API call. The busiest event in an API platform, and
  one this profile says nothing about.
- `webhook-delivery.json` — a successful delivery attempt. Governing this would mean requiring an
  authorization decision on every outbound HTTP call a dispatcher makes, including retries.
- `integration-sync-progress.json` — a per-page progress event from a polling connector. The sync
  that _started_ is governed; the pages it walks are not.

All three are perfectly good OpenAuditModel events. `check-profile` reports each as not applicable
with exit code 3, which is deliberately **not** conformance: an event no rule governs is out of
scope, never silently approved.

## Open questions

- Should `api-key.create` require an expiry rather than recommend one? The argument for is that a
  non-expiring credential is the finding; the argument against is that many products legitimately
  issue keys with no expiry and would fill the field with a sentinel.
- Is `endpointClass` the right abstraction, or should the profile require a destination host
  identifier that a producer resolves internally? A class answers the risk question; a host
  identifier answers the forensic one. There is no adoption evidence yet for either.
- Should `integration.sync.start` require the sync scope — full or incremental, and over what — as
  `INTEGRATION-CONN-001` requires the connection? The vocabulary differs enough between connectors
  that a required field would likely be filled inconsistently.
- Should a self-approval be expressible? Detecting one needs an array-content predicate the rule
  language does not have.
