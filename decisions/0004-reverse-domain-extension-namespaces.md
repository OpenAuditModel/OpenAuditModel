# 0004 — Reverse-domain extension namespaces

## Status

Accepted — 2026-07-30. Applies to specification version 0.1.

## Context

A core model that stays small requires a place to put everything it excludes. Without a sanctioned
extension point, adopters add fields anyway — at the top level, with names chosen locally.

The predictable outcome is collision. Two products both add `clusterId` and mean different things.
A collector adds `source`, which a producer already used. A field that means "tenant" in one system
means "customer account" in another, and any consumer reading across systems is silently wrong.

The model already has `metadata` for domain-specific audit interpretation data, with plain keys.
That works within a domain, where the vocabulary is shared. It does not work for vendor-specific data,
where the whole point is that the meaning belongs to one party.

Options for making extension keys collision-resistant were: reverse-domain namespaces, a UUID or
random prefix, a central registry, or a required nesting level per vendor.

## Decision

Extension keys MUST use a **reverse-domain namespace** of at least three dot-separated, lower-case
segments. The canonical schema enforces this with `propertyNames`.

```json
{
  "extensions": {
    "com.example.identity.directory.id": "directory-1",
    "io.vendor.product.feature.enabled": true,
    "org.example.workflow.stage": "legal-review"
  }
}
```

```json
{
  "extensions": {
    "clusterId": "production",
    "customValue": true
  }
}
```

The second example is rejected by the validator.

Three segments is the minimum because a reverse domain needs at least two labels — `com.example` —
plus at least one segment naming the field.

Additional rules:

1. Extensions MUST NOT weaken required core fields.
2. Extensions MUST NOT change the meaning of existing core fields.
3. Consumers MUST ignore extensions they do not understand, and MUST NOT reject an event because of
   them.
4. The namespace SHOULD be a domain the author controls. This is a collision-avoidance convention,
   not an ownership claim the specification can verify, and consumers MUST NOT treat a namespace as an
   authenticity signal.
5. `metadata` keeps plain keys. The distinction between the two is documented in
   [extension-model.md](../specification/extension-model.md).

## Consequences

**Positive**

- Collisions become structurally unlikely without any registry, coordination or central authority.
- The owner of a field is visible in its name, which matters when a consumer encounters a field years
  after the producing system was retired.
- The convention is familiar: Java packages, Android permissions, macOS bundle identifiers,
  CloudEvents type recommendations and OpenTelemetry attribute namespaces all use it.
- The rule is machine-checkable, so violations are caught at validation rather than at integration.
- Extensions can be promoted to conventions or core fields later, because their provenance is clear.

**Negative**

- Keys are verbose. `com.example.workflow.stage` is 26 characters to say `stage`.
- The convention is unenforceable in substance. Nothing prevents a producer using a namespace it does
  not own, and the schema cannot tell.
- Organizations without a domain name, or working entirely internally, must still pick one. Using a
  reserved documentation domain is acceptable for internal use.
- Three segments is a judgement call. A two-label namespace plus a field name is the minimum sensible
  form, but a producer wanting `com.example` as a whole-namespace key cannot have it.

**Neutral**

- Extension values may be any JSON value, including nested structures. The namespace rule constrains
  keys, not values.

## Alternatives considered

**Allow any key in `extensions`.** Rejected: identical to having no convention, and guarantees the
collisions this decision exists to prevent.

**Require exactly two segments (`com.example`) with nested objects underneath.** Rejected: it makes
flat key-value extension awkward, and it makes partial updates and flattening for export harder.

**Use a UUID or random prefix.** Rejected: collision-free, and unreadable. A field name that tells a
future reader nothing about who defined it defeats the purpose.

**Maintain a central registry of extension namespaces.** Rejected for v0.1: it requires governance
that does not yet exist, and it makes adding a private extension a request rather than a decision. May
be reconsidered for extensions that become widely used.

**Put vendor data in `metadata` with a prefix convention.** Rejected: it blurs the distinction between
domain data that a whole industry reads and vendor data that one party defines, and a prefix
convention inside a free-form object cannot be validated.
