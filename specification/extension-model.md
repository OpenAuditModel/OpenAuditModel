# Extension Model

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. Four places data can go

| Mechanism        | For                                                    | Key form                     | Collision risk  |
| ---------------- | ------------------------------------------------------ | ---------------------------- | --------------- |
| **Core fields**  | Concepts universal to all business applications        | Defined by the specification | None            |
| **`attributes`** | Producer detail about a specific principal or resource | Plain names                  | Local only      |
| **`metadata`**   | Domain-specific audit interpretation data              | Plain names                  | Within a domain |
| **`extensions`** | Vendor or product specific data                        | Reverse-domain namespaced    | None            |

Choosing correctly matters, because these have different stability expectations and different
audiences. A field in `metadata` is expected to be read by anyone working in that domain; a field in
`extensions` is expected to be read by whoever owns the namespace.

## 2. Core objects are closed

Every core object rejects unknown properties, and domain-specific data MUST NOT be added as a new
top-level property.

This is a deliberate trade-off. A closed model means a producer that adds `documentClassification`
at the top level gets a validation error instead of silently emitting a field no consumer will read.

## 3. Metadata

`metadata` carries domain-specific audit interpretation data that has no core representation: the
role that was assigned, the partition that was reset, the export format that was produced.

### 3.1 Rules

1. `metadata` MUST be a JSON object. Values MAY be any JSON value.
2. Metadata keys do NOT need a reverse-domain namespace. They are plain names.
3. Metadata MUST NOT contain any value prohibited by [privacy.md](privacy.md).
4. Metadata SHOULD contain small, structured values. It is not a place for payloads, documents,
   serialized objects or blobs.
5. A metadata field's meaning MUST be stable once used, in the same way an event name is stable. A
   key that means one thing in one release and something else in the next silently corrupts
   historical analysis.
6. Metadata MUST NOT duplicate core fields. Recording `metadata.userId` when `actor.id` exists creates
   two sources of truth that will eventually disagree.
7. Metadata SHOULD NOT be used to work around a core constraint. A producer that puts an approval
   status in `metadata` because it did not want to populate `approval` has made its data
   uncomparable for no benefit.

### 3.2 Profiles and metadata

Profiles MAY define expected metadata fields for their domain, and MAY require them for specific
event classes. When a profile defines a metadata field, producers implementing that profile SHOULD
use the profile's name and meaning rather than inventing their own. See [profiles/](../profiles/).

No profile defines metadata fields normatively in v0.1.

### 3.3 Example

```json
{
  "metadata": {
    "assignedRole": "support-agent",
    "assignmentScope": "tenant",
    "effectiveFrom": "2026-03-16T00:00:00Z",
    "expiresAt": "2026-06-16T00:00:00Z"
  }
}
```

## 4. Extensions

`extensions` carries vendor-specific or domain-specific data whose meaning is owned by an
identifiable party.

### 4.1 Key form

Every extension key MUST be a reverse-domain namespaced name of **at least three** dot-separated,
lower-case segments. Each segment starts with a letter and may contain digits and hyphenated words.

Valid:

```json
{
  "extensions": {
    "com.example.identity.directory.id": "directory-1",
    "io.vendor.product.feature.enabled": true,
    "org.example.workflow.stage": "legal-review"
  }
}
```

Invalid:

```json
{
  "extensions": {
    "clusterId": "production",
    "customValue": true
  }
}
```

The canonical schema rejects keys that do not follow the convention. Three segments is the minimum
because a reverse domain needs at least two labels — `com.example` — plus at least one segment naming
the field.

The namespace SHOULD be a domain the extension's author controls. This is a convention for avoiding
collisions, not an ownership claim the specification can verify: nothing prevents a producer from
using a namespace it does not own, and consumers MUST NOT treat a namespace as an authenticity
signal.

### 4.2 Rules

1. Extension keys MUST use a reverse-domain namespace as defined above.
2. Extension values MAY be any JSON value, including nested objects and arrays.
3. Extensions MUST NOT weaken required core fields. An extension cannot make a required field
   optional, relax a constraint, or substitute for a core field that should have been populated.
4. Extensions MUST NOT change the meaning of existing core fields. If an extension says
   `com.example.audit.actor-is-really-the-subject`, the model has been misused.
5. Extensions MUST NOT contain any value prohibited by [privacy.md](privacy.md).
6. A consumer MUST NOT reject an event because it carries extensions the consumer does not
   understand. Ignoring unknown extensions is the required behaviour.
7. A consumer MUST NOT derive core semantics from an extension it does not own.

### 4.3 Enrichment by pipeline components

Collectors and forwarders MAY add extensions under their own namespace, subject to the rules in
[delivery.md](delivery.md) — in particular, they MUST NOT modify an event carrying integrity
material, and MUST NOT alter fields that describe what the producer observed.

## 5. Metadata or extension?

Ask who owns the meaning of the field.

| Question                                                            | Use                  |
| ------------------------------------------------------------------- | -------------------- |
| Would every application in this domain use this field the same way? | `metadata`           |
| Is the meaning defined by one vendor, product or internal platform? | `extensions`         |
| Does the field describe one principal or one resource specifically? | `attributes`         |
| Is the concept universal across all business applications?          | Propose a core field |

When genuinely unsure, prefer `extensions`. A namespaced key can be promoted to `metadata` or to a
core field later; a plain key that turns out to mean different things in different products cannot be
untangled.

## 6. Promoting an extension

An extension that proves general may be proposed as a semantic convention, a profile field, or a core
field. The process is described in [CONTRIBUTING.md](../CONTRIBUTING.md).

Promotion requires evidence of independent use across unrelated applications. A field used by one
product is a product field, however well designed.

## 7. Free-form values

`metadata`, `extensions` and `attributes` all accept the full JSON value space: strings, numbers,
integers, booleans, null, arrays and objects, nested to any depth. The canonical schema defines this
recursively, and recursion is exercised by the conformance test suite.

Producers SHOULD nonetheless keep these values shallow and small. Deep structures in audit data are
hard to review, hard to index and hard to redact.
