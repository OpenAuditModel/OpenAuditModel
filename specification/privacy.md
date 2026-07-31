# Privacy

**Specification version: 0.1 · Status: Experimental · This document: Normative**

Audit data concentrates the most sensitive relationship in a system: who did what to whom, and when.
It is frequently retained longer than production data, replicated to more systems, and read by more
people. This document defines what MUST NOT be recorded, and how the personal-data character of an
event is described.

None of this constitutes legal advice or a compliance guarantee. See §9.

## 1. Values that MUST NEVER be recorded

The following MUST NOT appear in any field of an OpenAuditModel event — not in `metadata`, not in
`extensions`, not in `attributes`, not in `before` or `after`, not in an error message, not in a
summary, and not inside a reference:

1. Passwords, in any form, including password hashes and password history.
2. Access tokens.
3. Refresh tokens.
4. API keys.
5. Connection strings.
6. Private keys and other secret key material.
7. Authorization headers.
8. Session cookies and any other value that grants a session by possession.

This list is absolute. There is no audit purpose that requires the value of a credential; the audit
purpose is served by recording the **fact** of its creation, use, rotation or revocation.

Where a system's session identifier is itself a bearer credential, producers MUST record a derived,
non-reversible correlation value or omit the field. See
[authentication.md](authentication.md).

## 2. Data that MUST NOT be captured automatically

The following MUST NOT be captured automatically — that is, without an explicit, per-field decision
by the producer:

1. Full request bodies.
2. Full response bodies.
3. Message broker payloads.
4. Database query parameters.
5. Query strings. The canonical schema enforces this for `request.route`.
6. Complete database records in `change.before` or `change.after`.
7. Raw forwarding and client headers copied verbatim.

A producer MAY record a **selected, named subset** of any of these where the audit purpose requires
it and the values have been reviewed. The prohibition is on capturing them wholesale because they
happened to be available.

## 3. The allowlist model

Audit event fields MUST follow an **allowlist** model.

A producer decides, per field, what it records. It MUST NOT populate audit fields by serializing
whatever object was at hand and removing known-bad keys afterwards. Denylists fail silently: the
first time a new field appears in an upstream model, it is captured, and nobody finds out until it is
in seven years of retained records.

Practically:

- Map application data to audit fields explicitly, field by field.
- Prefer `changedFields` over `before`/`after` when the field names alone answer the question.
- Prefer identifiers over values, and stable identifiers over personal identifiers.
- Prefer references over content.
- Prefer route templates over resolved paths.
- Treat every new audit field as a change that needs review, in the same way a new database column
  containing personal data would.

## 4. Data minimization

Audit data MUST be minimized to what the audit purpose requires.

- A field that no reviewer, control or investigation would use SHOULD NOT be recorded.
- An optional object SHOULD be omitted when the producer has no specific need for it. Completeness is
  not a goal; see [design-principles.md](design-principles.md).
- `actor.displayName`, `resource.name` and `request.ipAddress` are the fields most often recorded out
  of habit. Each is personal data in common circumstances, and each SHOULD be justified rather than
  defaulted.
- Minimization applies to retention as well as capture. The model provides `privacy.retentionClass`
  so that events can be governed differently; enforcing it is the operator's responsibility.

## 5. The privacy object

`privacy` is OPTIONAL and describes how this event relates to personal data.

| Field                  | Meaning                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `containsPersonalData` | Whether the event as serialized contains personal data.       |
| `dataCategories`       | Categories of personal data present. Open vocabulary.         |
| `processing`           | How personal data was handled when the event was produced.    |
| `minimized`            | Whether the producer applied data minimization to this event. |
| `retentionClass`       | Producer-defined retention class governing this event.        |
| `purpose`              | Purpose for which the event is recorded.                      |

### 5.1 Data categories

RECOMMENDED values:

```text
identifier   contact    network      financial   health
biometric    location   employment   behavioral  special-category
other
```

`special-category` marks data that the operator's own policy treats as requiring heightened
protection. The specification deliberately does not define which categories are special, because that
determination is jurisdictional.

Producers SHOULD populate `dataCategories` whenever `containsPersonalData` is `true`. The schema does
not enforce this, because a producer may know that personal data is present before it has classified
it.

### 5.2 Processing

`processing` MUST be one of:

| Value       | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `include`   | Personal data is present in the event as recorded.             |
| `mask`      | Personal data was partially obscured before recording.         |
| `hash`      | Personal data was replaced with a digest.                      |
| `drop`      | Personal data was removed entirely.                            |
| `encrypt`   | Personal data was encrypted before recording.                  |
| `reference` | Personal data was replaced with a reference to another system. |

A single value describes the treatment applied to the event as a whole. Per-field processing
descriptions are an open question for v0.2.

Note that `hash` is not anonymization. Hashing a low-entropy identifier such as an email address or a
national identification number is reversible by enumeration and MUST NOT be presented as removing the
personal-data character of the field.

### 5.3 Regulation neutrality

The privacy object MUST NOT be extended with regulation-specific fields: no lawful basis
enumerations, no article references, no jurisdiction-specific consent flags, no framework identifiers.

Those are interpretations of audit data, produced by mapping artifacts maintained outside this
specification. Encoding one framework's vocabulary into the core model would make the model wrong
everywhere else, and stale as soon as the framework is revised.

## 6. Validation cannot detect secrets

Schema validation alone **cannot** detect a leaked secret.

A password placed in `metadata.oldValue` is a valid string in a valid free-form object. The event will
pass every conformance test in this repository. This is a limitation of machine validation, not a gap
that a future schema version will close.

Implementations SHOULD therefore:

- Run secret scanning over audit events before they leave the producer, and again in the pipeline.
- Review audit instrumentation in code review with the same seriousness as data model changes.
- Fail closed: when a producer cannot determine whether a value is safe, it SHOULD omit the value.
- Treat the audit store as a system holding personal data, with corresponding access control,
  retention and disclosure controls.

`auditmodel lint-privacy` makes **part** of this checkable. The rest of this section describes what
that part is, and — more importantly — what it is not.

### 6.1 Four kinds of rule

The requirements in this document fall into four groups. Conflating them is how a linter comes to be
trusted for things it cannot do.

| Kind                        | Enforced by                  | Examples                                                  |
| --------------------------- | ---------------------------- | --------------------------------------------------------- |
| **Normative requirement**   | This specification. Binding. | §1 "passwords MUST NEVER be recorded"                     |
| **Deterministic lint rule** | Exact matching. No guessing. | A property named `password`; a PEM private key marker     |
| **Heuristic lint rule**     | Measurement. Guesses.        | High character entropy; an oversized object               |
| **Not automatable**         | Review. Nothing else.        | Whether a value is personal data; whether §3 was followed |

A deterministic rule can still be wrong about **meaning**: a property named `password` might hold a
policy description. It is deterministic because the same input always produces the same finding, not
because the finding is always correct.

### 6.2 What the linter checks

`auditmodel lint-privacy` is deterministic local static analysis. It reads events, reports
suspicions, and does nothing else. It MUST NOT send event content anywhere, resolve or fetch any
reference, open any file an event names, modify or redact an event, or consult any remote service or
model.

Deterministic rules:

| Rule                             | Detects                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `OAM-PRIV-001`                   | A populated property whose name is a credential name after normalization              |
| `OAM-PRIV-002`                   | A value shaped as `Bearer`, `Basic`, `Digest`, `ApiKey` or `Token` plus a credential  |
| `OAM-PRIV-003`                   | A PEM marker introducing private key material                                         |
| `OAM-PRIV-010`                   | A structurally valid JSON Web Token                                                   |
| `OAM-PRIV-011`                   | A published access key identifier shape                                               |
| `OAM-PRIV-012` to `OAM-PRIV-016` | Published credential prefixes for source forge, messaging, payment and cloud API keys |
| `OAM-PRIV-030`                   | A URL with embedded user information                                                  |
| `OAM-PRIV-031`                   | An evidence reference carrying a query string or fragment                             |
| `OAM-PRIV-040`                   | A connection string carrying a password                                               |
| `OAM-PRIV-041`                   | A connection string without a credential, which still discloses infrastructure        |
| `OAM-PRIV-061`                   | A populated property whose name denotes a raw request, response or message body       |

Heuristic rules:

| Rule           | Measures                                |
| -------------- | --------------------------------------- |
| `OAM-PRIV-050` | Character entropy, as a token candidate |
| `OAM-PRIV-060` | Value size, as a minimization signal    |

Recognising a published credential prefix is a property of the **tooling**, not of the model. The
specification, the canonical schema and the semantic conventions name no vendor, and no lint rule
introduces a field, vocabulary or concept into the model.

### 6.3 What the linter does not check

It does not, and largely cannot, determine:

- Whether a value **is** personal data. `privacy.dataCategories` is a producer declaration; nothing
  verifies it.
- Whether `privacy.minimized` is truthful.
- Whether the audit purpose required a field to be recorded at all.
- Whether a hash of a low-entropy identifier is reversible by enumeration.
- Whether `actor.displayName`, `resource.name` or `request.ipAddress` were justified.
- Whether §3's allowlist model was followed. That is a property of the producer's **code**; an event
  built by copying a request object and one built field by field can be byte-identical.
- Whether the audit store has access control or retention (§7).
- Anything about regulatory classification (§9).
- Whether a detected credential is real, current, revoked or usable. No rule validates a signature,
  decodes a token for its claims, or contacts an issuer.

### 6.4 A finding is a suspicion; a clean result is not a clearance

A finding means a value **matched a rule**. It does not establish a data breach, a regulatory
violation, a confirmed credential or confirmed personal data. Tooling and documentation MUST NOT
present findings in those terms.

**A clean result does not mean an event is safe or compliant.** A password that happens to be a
dictionary word, stored under a field named `note`, matches nothing here. Neither does a national
identification number, a home address or a medical detail: the linter looks for values shaped like
secrets, and most personal data is not shaped like anything.

### 6.5 Findings never contain the offending value

No finding — in any output format — contains the value that produced it, any part of it, a preview, a
prefix, a suffix, or a decoded claim. A finding carries a rule identifier, a severity, a confidence,
a JSON Pointer, a message and a recommendation.

The reason is direct: linter output goes into CI logs, pull request comments and issue trackers,
which are usually less protected than the audit store. A tool that echoed what it found would move
secrets from a controlled system into an uncontrolled one, and would do it precisely when a secret
was present.

### 6.6 Inspected locations

Values are inspected under:

```text
/metadata                        /change/before
/extensions                      /change/after
/actor/attributes                /event/error/message
/subject/attributes              /event/summary
/resource/attributes             /reason/text
/relatedResources/*/attributes   /reason/reference
/evidence/*/reference            /request/route
/authorization/reason            /delegation/reason
```

Property **names** are inspected recursively within `metadata`, `extensions`, every `attributes`
object, `change.before` and `change.after`. Extension keys are also tested on their final
dot-separated segment, because a reverse-domain key names its field there.

Everything else is excluded, including `integrity` digests and signatures, `request.traceId` and
`request.spanId`, and the event `id`. Those fields hold high-entropy values by design; scanning them
would produce a finding on every well-formed event.

### 6.7 Known-safe exclusions from the entropy heuristic

The entropy rule — and **only** the entropy rule — ignores values recognised as: UUIDs, ULIDs, W3C
Trace Context trace and span identifiers, lower-case hexadecimal digests of SHA-256, SHA-384 and
SHA-512 length, RFC 3339 timestamps, purely numeric identifiers, lower-case separated identifiers and
reference paths, anything containing `://`, and redaction placeholders.

A value under a property named `password` is reported whatever it looks like. A value matching a
published credential format is reported even if it also looks like an identifier.

### 6.8 Fixed thresholds

Version 0.1 hard-codes these. They are not configurable; see
[ADR 0007](../decisions/0007-deterministic-privacy-linting.md).

| Threshold                       | Value                                |
| ------------------------------- | ------------------------------------ |
| Minimum length for entropy      | 24 characters                        |
| Maximum length for entropy      | 4096 characters                      |
| Entropy threshold               | 4.0 bits per character               |
| Minimum character classes       | 3 of 4 (lower, upper, digit, symbol) |
| Oversized: serialized size      | 4096 bytes                           |
| Oversized: property count       | 50                                   |
| Oversized: nesting depth        | 6                                    |
| Oversized: array length         | 100                                  |
| Oversized: single string length | 2048 characters                      |
| Maximum traversal depth         | 64                                   |

### 6.9 False positives and false negatives

Both are expected, and the design prefers false negatives in the heuristic rules and false positives
in nothing.

**False positives** are most likely from `OAM-PRIV-050` on legitimate opaque identifiers, from
`OAM-PRIV-060` on genuinely detailed metadata, and from `OAM-PRIV-001` where a credential-named field
holds something else. `OAM-PRIV-050` reports at low confidence for exactly this reason.

**False negatives** are certain. A secret in an unpublished format, under a harmless name, below the
entropy threshold, or in all lower case with a separator, is invisible. So is any personal data that
is not shaped like a secret. A recognised redaction placeholder under a credential name is
deliberately not reported, because a tool that flags `"password": "[REDACTED]"` teaches people to
ignore it.

`OAM-PRIV-001` reports a credential-named property when it holds a **scalar**. A **container** under
such a name is treated as a descriptor and is not itself reported; its members are inspected
individually. `credential: { "type": "api-key" }` describes a credential without carrying one, and is
the shape the identity-and-access-management profile requires for credential rotation events —
flagging it would fire on every conforming rotation event, which is how a linter earns the reputation
that gets it switched off. The accepted cost is a secret stored under a harmless member name inside
such a container.

### 6.10 Schema validation is not secret scanning

These are different questions and neither substitutes for the other.

Schema validation asks whether an event is **well formed**. It passes an event containing a password
in `metadata`, because a password is a valid string. Privacy linting asks whether an event **looks
like it contains something it should not**. It passes an event that is structurally broken, which is
why the linter validates first and refuses to deep-lint an invalid event: traversing an arbitrary
structure yields findings whose paths mean nothing.

### 6.11 Exit codes

```text
0  no findings
1  one or more privacy findings, or a schema-invalid event
2  usage error, or a file could not be read or parsed
```

A schema-invalid event is reported and **not** deep linted, and exits non-zero: a clean privacy
result for an event that was never linted would be misleading.

### 6.12 Using it

```bash
auditmodel lint-privacy examples/privacy/clean/minimal-clean-event.json
auditmodel lint-privacy examples/privacy/findings/access-token-field.json
auditmodel lint-privacy examples/privacy --format json
```

Producers SHOULD run it in CI over fixture events and over samples of real output, and SHOULD treat
it as one control among several. It is not a substitute for reviewing audit instrumentation, and
running it does not make an event safe.

## 7. Access to audit data

Audit data MUST be access-controlled. It describes individuals' behaviour, and in many systems it is
readable by more people than the data it describes.

The specification defines no access control model. It notes only that an audit trail readable by
everyone in an organization is a privacy exposure that no amount of field-level minimization
compensates for.

## 8. Example

```json
{
  "privacy": {
    "containsPersonalData": true,
    "dataCategories": ["identifier", "contact", "behavioral"],
    "processing": "reference",
    "minimized": true,
    "retentionClass": "standard",
    "purpose": "operational-audit"
  }
}
```

## 9. No legal or compliance guarantee

This document describes engineering practice for reducing the risk that audit data creates. It is not
legal advice, it does not establish a lawful basis for processing, and conformance to it does not
constitute compliance with any law, regulation, standard or contract.
