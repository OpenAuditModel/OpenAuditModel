# External Mappings

**Specification version: 0.1 · Status: Experimental · These documents: Informative**

OpenAuditModel is designed to complement existing standards rather than replace them. These documents
describe, informatively, how an OpenAuditModel event relates to standards that already exist.

## Status

Everything in this directory is **informative**. No mapping is normative, none is required for
conformance, and none is guaranteed to be complete. A producer that uses none of these standards is
fully conforming.

## Documents

| Document                             | Standard              | Relationship                                       |
| ------------------------------------ | --------------------- | -------------------------------------------------- |
| [cloudevents.md](cloudevents.md)     | CloudEvents           | OPTIONAL transport envelope                        |
| [opentelemetry.md](opentelemetry.md) | OpenTelemetry         | OPTIONAL telemetry transport and trace correlation |
| [ecs.md](ecs.md)                     | Elastic Common Schema | Export mapping                                     |
| [ocsf.md](ocsf.md)                   | OCSF                  | Security-event mapping                             |
| [cadf.md](cadf.md)                   | CADF                  | Prior art; a comparison, not a mapping             |

OSCAL may later be supported for control and assessment mappings. It is not addressed in v0.1.

## Why OpenAuditModel exists alongside these

Each of these standards solves a real problem, and none of them solves this one:

| Standard      | What it standardizes                                                 | What it leaves open                                                              |
| ------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| CloudEvents   | The envelope around an event                                         | Everything inside the envelope                                                   |
| OpenTelemetry | Telemetry transport, correlation and semantics for observability     | Business audit semantics: approval, delegation, justification                    |
| ECS           | A field vocabulary for search and analysis                           | Requirements: what a producer MUST record                                        |
| OCSF          | Security event classes and their attributes                          | Business operations that are not security telemetry                              |
| CADF          | A cloud audit event model, with taxonomies and federation interfaces | Business-application semantics, and conformance tooling that makes them testable |

OpenAuditModel standardizes **what a business application must record about an auditable operation**,
and makes that machine-verifiable. It defines no transport, so it can travel over any of these.

## Direction of mapping

All mappings in this directory are described **from** OpenAuditModel **to** the target standard.

Mapping in the other direction — deriving an OpenAuditModel event from an ECS document or an OCSF
class — is lossy in ways that matter. Approval, delegation, business justification and change context
have no source field to come from, and inventing them would produce audit data that asserts more than
was observed. Where an inbound mapping is needed, the missing fields MUST be omitted rather than
defaulted.

## Contributing a mapping

Mappings are welcome, including for standards not listed here. A useful mapping states what maps
cleanly, what maps approximately, and — most importantly — **what does not map at all**. A mapping
document that claims full fidelity is either wrong or is describing a standard that already contains
this model.

See [CONTRIBUTING.md](../CONTRIBUTING.md).
