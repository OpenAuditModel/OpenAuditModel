# Authorization Context

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. Purpose

`authorization` records the **decision** that permitted or denied the operation. It is OPTIONAL.

The purpose is to make the decision reviewable after the fact: which policy applied, which version of
it, what it decided, and why. Without this, a reviewer looking at a denied operation cannot tell
whether the control worked or whether the request never reached it.

## 2. Structure

| Field           | Required | Meaning                                              |
| --------------- | -------- | ---------------------------------------------------- |
| `decision`      | Yes      | Outcome of the authorization evaluation.             |
| `engine`        | No       | Component that produced the decision.                |
| `policy`        | No       | Identifier of the policy that produced the decision. |
| `policyVersion` | No       | Version of that policy.                              |
| `reason`        | No       | Sanitized explanation of the decision.               |
| `permissions`   | No       | Permissions evaluated or required for the operation. |

When `authorization` is present, `decision` is REQUIRED. An authorization object that records a
policy but no decision is not useful and is rejected by the schema.

## 3. Decisions

`decision` MUST be one of:

| Value            | Meaning                                                    |
| ---------------- | ---------------------------------------------------------- |
| `allow`          | The operation was permitted.                               |
| `deny`           | The operation was refused by the authorization evaluation. |
| `not-applicable` | No authorization evaluation applied to this operation.     |
| `unknown`        | The producer cannot determine what the evaluation decided. |

A `deny` decision normally accompanies `event.outcome` of `failure`, and the event MUST then carry
`event.error`. Recording the denial as a successful operation misrepresents the control.

`not-applicable` is meaningful: it distinguishes "no policy governs this" from "we did not record
it". Producers SHOULD prefer omitting the object entirely when they simply have no information.

## 4. This is a record, not an engine

OpenAuditModel records authorization **results**. It MUST NOT become an authorization system.

Consequently:

1. The model defines no policy language, no rule syntax and no evaluation semantics.
2. The schema MUST NOT require any particular policy engine, and MUST NOT contain any engine's
   vocabulary. `engine` is a free identifier precisely so that no engine is privileged.
3. A consumer MUST NOT attempt to re-evaluate a policy from an audit event. Audit events describe
   what happened; they are not an input to access control.
4. Nothing in this specification should be read as requiring centralized policy evaluation. An
   application whose authorization is ordinary code in a service can populate `decision`, `reason`
   and `permissions` perfectly well.

## 5. Policy identification

`policy` and `policyVersion` exist so that a reviewer can reconstruct **which rule** produced the
decision. Recording a decision without identifying the rule that produced it makes historical review
unreliable, because policies change.

Producers that version their policies SHOULD populate `policyVersion`. A `policy` value SHOULD be
stable across releases in the same way an event name is.

## 6. Reason

`authorization.reason` is a sanitized, human-readable explanation of the decision, such as
"role does not grant the requested permission on this tenant".

It MUST NOT contain the full policy document, the complete attribute set that was evaluated,
credentials, or personal data beyond what the audit purpose requires. A consumer MUST NOT parse it.

This field is distinct from the top-level `reason` object, which records the **business
justification for performing the operation**. One explains the machine decision; the other explains
human intent. An event may carry both.

## 7. Permissions

`permissions` lists the permissions evaluated or required for the operation, using the producer's own
permission vocabulary. It SHOULD contain the permissions relevant to **this** operation, not the
principal's complete permission set.

## 8. Example

```json
{
  "authorization": {
    "decision": "allow",
    "engine": "policy-service",
    "policy": "privileged-configuration-change",
    "policyVersion": "23",
    "reason": "Actor holds the platform administrator role within an approved change window.",
    "permissions": ["configuration.setting.update"]
  }
}
```

A denial:

```json
{
  "event": {
    "name": "document.file.download",
    "category": "data-access",
    "outcome": "failure",
    "error": { "code": "permission-denied", "type": "authorization", "retryable": false }
  },
  "authorization": {
    "decision": "deny",
    "policy": "document-access",
    "reason": "Requested classification exceeds the actor's clearance."
  }
}
```
