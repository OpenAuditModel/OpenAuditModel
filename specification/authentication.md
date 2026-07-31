# Authentication Context

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. Purpose

`authentication` records **how the actor proved its identity** for the session behind this operation.
It is OPTIONAL.

It answers questions such as: was this a password sign-in or a certificate? Was multi-factor
authentication satisfied? Which identity provider asserted the identity? How old is the session?

## 2. Structure

All fields are OPTIONAL. When the object is present it MUST contain at least one of them.

| Field             | Meaning                                                             |
| ----------------- | ------------------------------------------------------------------- |
| `method`          | Authentication method used. Closed vocabulary, see §3.              |
| `provider`        | Identity provider that performed authentication.                    |
| `mfa`             | Whether multi-factor authentication was satisfied for this session. |
| `assuranceLevel`  | Producer-defined assurance level.                                   |
| `sessionId`       | Session correlation identifier.                                     |
| `authenticatedAt` | When the session behind this operation was authenticated.           |

## 3. Methods

`method`, when present, MUST be one of:

```text
password   mfa       oidc      saml       certificate
api-key    service-account     session    anonymous
other      unknown
```

Notes:

- `mfa` as a _method_ means the producer knows only that a multi-factor flow was used and cannot
  identify the primary factor. Where the primary factor is known, producers SHOULD record it in
  `method` and set the `mfa` boolean to `true`. The two are not redundant: `method` is _what_ was
  used, `mfa` is _whether a second factor was satisfied_.
- `session` means the operation reused an established session rather than performing a fresh
  authentication.
- `other` and `unknown` are escape values. `unknown` MUST NOT be used to avoid deciding.

## 4. Absence is not anonymity

This is the most important rule in this document.

**An absent `authentication` object and `method: anonymous` mean different things.**

| Situation                                                 | Correct representation                 |
| --------------------------------------------------------- | -------------------------------------- |
| No authentication context is available or applicable      | Omit `authentication` entirely         |
| The principal was deliberately unauthenticated            | `authentication.method` is `anonymous` |
| The producer knows a session existed but not how it began | `authentication.method` is `unknown`   |

A consumer MUST NOT treat a missing `authentication` object as evidence that the operation was
unauthenticated, and MUST NOT treat it as an error.

The model MUST allow authentication context to be absent for:

- System-generated operations.
- Background jobs and scheduled processes.
- Non-interactive service-to-service operations.
- Events imported from legacy systems that never recorded it.

## 5. Assurance level

`assuranceLevel` is a producer-defined token describing how strongly the identity was established,
for example `low`, `substantial` or `high`.

The core specification deliberately does NOT define an assurance scale and does NOT map to any
external assurance framework. Assurance frameworks are jurisdiction-specific and revised on their own
schedules; binding the core model to one would violate
[design principle 9](design-principles.md#9-regulation-neutral-industry-neutral-jurisdiction-neutral).
Producers that need a framework mapping SHOULD publish it alongside their own value definitions.

## 6. Session identifiers

`sessionId` is a **correlation identifier**, not a credential.

`sessionId` MUST NOT be a usable session token, bearer token, cookie value or anything else that
would allow a reader of the audit event to assume the session. Where the underlying session
identifier is itself the credential, producers MUST record a derived, non-reversible correlation
value instead — for example a keyed hash — or omit the field.

See [privacy.md](privacy.md) for the complete list of values that MUST NOT be recorded.

## 7. Relationship to authorization and approval

Authentication, authorization and approval are three different questions and MUST NOT be conflated:

| Question                                             | Field            |
| ---------------------------------------------------- | ---------------- |
| Who is this principal, and how do we know?           | `authentication` |
| Is this principal permitted to do this?              | `authorization`  |
| Did someone decide this should be allowed to happen? | `approval`       |

See [authorization.md](authorization.md) and
[approval-and-delegation.md](approval-and-delegation.md).

## 8. Example

```json
{
  "authentication": {
    "method": "oidc",
    "provider": "corporate-idp",
    "mfa": true,
    "assuranceLevel": "high",
    "sessionId": "session-b71f",
    "authenticatedAt": "2026-03-14T09:58:02Z"
  }
}
```
