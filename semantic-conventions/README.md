# Semantic Conventions

**Specification version: 0.1 · Status: Experimental**

Semantic conventions are the layer between the schema and a useful audit trail. The schema says
`event.name` must be a lower-case dotted name; the conventions say that a sign-in is
`authentication.login` everywhere, so that two applications written by two teams produce data that
can be read together.

## Status of these documents

Conventions are **SHOULD-level guidance** unless a section explicitly states otherwise.

A producer that uses a name outside these conventions is still conforming. It is simply not
comparable with other producers, which is the entire benefit on offer. Where an application's domain
is not covered here, producers SHOULD follow the naming rule in
[event-naming.md](event-naming.md) and propose a convention.

The vocabularies here are **open**. The core schema constrains their form, not their membership. See
[design-principles.md](../specification/design-principles.md).

## Documents

| Document                                                   | Covers                                            |
| ---------------------------------------------------------- | ------------------------------------------------- |
| [event-naming.md](event-naming.md)                         | The naming rule, categories, activity types       |
| [authentication.md](authentication.md)                     | Sign-in, sign-out, sessions, credentials, factors |
| [identity-and-access.md](identity-and-access.md)           | Users, roles, permissions, service accounts       |
| [data-access.md](data-access.md)                           | Reading, exporting, sharing and modifying data    |
| [configuration-and-change.md](configuration-and-change.md) | Settings, secrets, deployments, releases          |
| [workflow-and-approval.md](workflow-and-approval.md)       | Requests, approvals, workflow state, incidents    |
| [privileged-operations.md](privileged-operations.md)       | Administrative and break-glass operations         |
| [correlation-and-tracing.md](correlation-and-tracing.md)   | Request, trace, span and correlation identifiers  |

## Relationship to profiles

Conventions are horizontal: they describe how to name and categorise the operations that appear in
almost every application. [Profiles](../profiles/) are vertical: they add stricter requirements for a
specific domain, and may require fields the core model leaves optional.

A convention never adds a requirement. A profile may.

## Proposing a convention

Open a specification change issue describing:

1. The operations the convention covers.
2. The proposed names, and why they follow the naming rule.
3. At least two independent applications that would emit them.
4. What breaks if the convention is not adopted.

See [CONTRIBUTING.md](../CONTRIBUTING.md).
