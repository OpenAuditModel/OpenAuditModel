# Authentication Events

**Specification version: 0.1 · Status: Experimental**

Category: `authentication`

## 1. Recommended event names

| Name                               | Operation                                                   |
| ---------------------------------- | ----------------------------------------------------------- |
| `authentication.login`             | A principal established an authenticated session            |
| `authentication.logout`            | A principal ended a session deliberately                    |
| `authentication.session.expire`    | A session ended by policy rather than by request            |
| `authentication.session.revoke`    | A session was terminated by an administrator or by policy   |
| `authentication.factor.enroll`     | A principal registered an additional authentication factor  |
| `authentication.factor.remove`     | A factor was removed                                        |
| `authentication.factor.challenge`  | An additional factor was requested and answered             |
| `authentication.credential.create` | A credential was issued                                     |
| `authentication.credential.rotate` | A credential was replaced                                   |
| `authentication.credential.revoke` | A credential was invalidated                                |
| `authentication.password.change`   | A principal changed its own password                        |
| `authentication.password.reset`    | A password was reset, typically by an administrator or flow |
| `authentication.lockout.apply`     | An account was locked after repeated failures               |
| `authentication.lockout.release`   | A lock was lifted                                           |

Failed sign-ins use `authentication.login` with `outcome: failure`, never a separate name.

## 2. Context to populate

| Field                            | Guidance                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `actor`                          | The principal that authenticated. For a failed attempt where identity is unproven, see §4. |
| `resource`                       | The session, credential or account that the operation concerned                            |
| `authentication.method`          | The primary factor used                                                                    |
| `authentication.mfa`             | Whether a second factor was satisfied                                                      |
| `authentication.provider`        | The identity provider that asserted the identity                                           |
| `authentication.sessionId`       | A correlation identifier, never a usable token                                             |
| `request.ipAddress`, `userAgent` | Only where the audit purpose requires it; both are personal data in context                |
| `controlCategories`              | `authentication-logging`                                                                   |

## 3. Outcomes and errors

A failed authentication MUST carry `event.error`. Recommended codes:

```text
invalid-credentials     unknown-principal      account-locked
account-disabled        factor-required        factor-invalid
session-expired         provider-unavailable   policy-denied
```

`event.error.message` MUST NOT disclose which part of a credential was wrong, whether an account
exists, or any value the principal submitted. `invalid-credentials` is the correct code for both a
wrong password and an unknown user, unless the operator has decided otherwise for their threat model.

## 4. Identifying the actor on a failed sign-in

A failed sign-in has no proven identity. Recommended handling:

- Where the submitted identifier resolves to a known principal, record that principal with the
  identifier the system already uses. Do not record the submitted string.
- Where it does not resolve, record `actor` as `{"type": "unknown", "id": "..."}` with a producer-chosen
  non-personal placeholder, such as a hash of the attempt or an attempt identifier.
- Never record the submitted username verbatim when it may be an email address, and never record the
  submitted password in any form. See [privacy.md](../specification/privacy.md).

## 5. Credentials

Credential events record the **fact** of a credential operation. They MUST NOT record the credential.

```json
{
  "event": {
    "name": "authentication.credential.rotate",
    "category": "authentication",
    "outcome": "success"
  },
  "actor": { "type": "service", "id": "service-account-rotation-worker" },
  "resource": { "type": "api-key", "id": "api-key-4471" },
  "change": { "type": "update", "changedFields": ["secret"], "ticketId": "change-8812" },
  "controlCategories": ["authentication-logging", "privileged-access"]
}
```

## 6. Absence of authentication context

Background jobs, system operations and imported events legitimately have no `authentication` object.
Omitting it is correct; `method: anonymous` means something different. See
[authentication.md](../specification/authentication.md) §4.

## 7. Example

```json
{
  "specVersion": "0.1",
  "id": "018f1c40-1111-7222-8333-444455556666",
  "time": "2026-03-20T08:12:04Z",
  "event": {
    "name": "authentication.login",
    "category": "authentication",
    "type": "login",
    "outcome": "failure",
    "severity": "medium",
    "error": { "code": "factor-required", "type": "authentication", "retryable": true }
  },
  "actor": { "type": "user", "id": "user-2211" },
  "resource": { "type": "session", "id": "session-attempt-88f1" },
  "application": { "name": "identity-service", "environment": "production" },
  "authentication": { "method": "password", "provider": "corporate-idp", "mfa": false },
  "controlCategories": ["authentication-logging"]
}
```
