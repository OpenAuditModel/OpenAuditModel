# Financial Transaction Management Profile

**Status: Experimental. Implemented in v0.1, 12 rules (11 enforceable, 1 advisory).**

The enforceable rules are in [profile.json](profile.json).

```bash
auditmodel check-profile examples/profiles/financial-transaction-management/valid --profile financial-transaction-management
```

## Purpose

An audit trail over money has to answer four questions long after everyone involved has moved on:
**who moved what, from where to where, on whose authority, and does it still reconcile.** The core
model carries the actor, the resource and the outcome. It has nowhere to put the amount, the currency,
the direction, the transaction reference or the business status of the movement, and no way to insist
that the operations which unwind value are justified. This profile adds exactly those requirements and
nothing else.

The profile is about **audit fields**, not about money. It defines no accounting model, mandates no
control thresholds, and takes no position on what any organization's approval limits should be.

## Scope

Material financial and monetary operations, in any application that performs them:

- **Payment platforms** — authorization, capture, refund, dispute.
- **Marketplaces** — seller balances, scheduled payouts, buyer refunds.
- **Brokerages** — client cash movement, withdrawal under dual control, limit administration.
- **Treasury and internal financial applications** — inter-account transfers, net settlement,
  reconciliation and adjustment.

Nothing here is specific to banking, to a payment scheme, to a card network, to a ledger technology or
to a jurisdiction. The profile never names a currency, a scheme, a message format or a regulation.

## Event families

| Event family                 | Governed | Requirement group             |
| ---------------------------- | -------- | ----------------------------- |
| `financial.transfer.*`       | yes      | movement, two-sided           |
| `financial.payment.*`        | yes      | movement                      |
| `financial.withdrawal.*`     | yes      | movement                      |
| `financial.deposit.*`        | yes      | movement                      |
| `financial.refund.*`         | yes      | movement, justified           |
| `financial.reversal.*`       | yes      | movement, justified, unwinds  |
| `financial.payout.*`         | yes      | movement                      |
| `financial.settlement.*`     | yes      | movement, two-sided           |
| `financial.chargeback.*`     | yes      | movement, justified, unwinds  |
| `financial.reconciliation.*` | yes      | reconciliation                |
| `financial.limit.*`          | yes      | preventive-control change     |
| `financial.balance.*`        | **no**   | not governed — see exclusions |
| `financial.quote.*`          | **no**   | not governed — see exclusions |
| `financial.report.*`         | **no**   | not governed — see exclusions |

The nine **movement** families are the ones where value actually changes hands. They carry the
transaction requirements (`FIN-TXN-001`, `FIN-TXN-002`). Reconciliation and limit events are governed
but are not movements, so they are not required to carry a direction or a transaction reference they
do not have.

## Explicit exclusions

**Non-mutating financial reads are deliberately ungoverned**: balance enquiries, price and rate quotes,
statement views and routine reporting. A retail application emits a balance-view event every time
anyone opens the app. Requiring an authorization decision, an amount, a direction and a correlation
identifier on each of them would put the profile's heaviest requirements on the highest-volume event in
the system, in exchange for almost no review value — and the requirement would be switched off rather
than met.

The exclusion is **structural, not a matter of discipline**: no selector in this profile uses a bare
`financial.` prefix, so `financial.balance.view`, `financial.quote.create` and
`financial.report.generate` match no rule at all and `check-profile` reports them as not applicable.
A test asserts it, because widening one prefix later would silently start governing every balance
lookup in a deployment.

Also out of scope, and deliberately so:

- **Order, trade and position events.** They are commercial events that may or may not result in money
  moving. Governing them would make this a trading profile.
- **Fee and interest calculation.** A computation is not a movement; the resulting posting is, and the
  posting is governed.
- **Ledger reads and exports.** Covered by
  [data-access.md](../../semantic-conventions/data-access.md).

Excluded does not mean unaudited. Every excluded event is still a conforming OpenAuditModel event.

## Rules

| Rule               | Applies to                                              | Requires                                                                     |
| ------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `FIN-CORE-001`     | every governed event                                    | `/authorization`                                                             |
| `FIN-CORE-002`     | every governed event                                    | _recommends_ `/reason`, `/authentication`, `/relatedResources`               |
| `FIN-TXN-001`      | the nine movement families                              | `/request/correlationId`, `transactionId`, `amount` (number), `currency`     |
| `FIN-TXN-002`      | the nine movement families                              | `direction`, `status`                                                        |
| `FIN-LINK-001`     | `financial.transfer.*`, `financial.settlement.*`        | `/relatedResources`                                                          |
| `FIN-REASON-001`   | reversals, chargebacks, refunds, rejections, cancels    | `/reason`                                                                    |
| `FIN-REVERSAL-001` | `financial.reversal.*`, `financial.chargeback.*`        | `originalTransactionId`; recommends `/approval`                              |
| `FIN-APPROVAL-001` | every governed event, when `approvalRequired` is `true` | `/approval/status`; recommends `/approval/workflowId`, `/approval/approvers` |
| `FIN-MANUAL-001`   | every governed event, when `manual` is `true`           | `/reason`, `/change`; recommends `/approval`                                 |
| `FIN-RECON-001`    | `financial.reconciliation.*`                            | `reconciliationId`; recommends `/request/correlationId`                      |
| `FIN-RECON-002`    | `financial.reconciliation.adjust`                       | `/change`, `/reason`, `amount` (number), `currency`; recommends `/approval`  |
| `FIN-LIMIT-001`    | `financial.limit.*`                                     | `/change`, `/reason`, `limitType`; recommends `/approval`                    |

Unqualified names in the "Requires" column are metadata fields under `/metadata/financial/`. Each
rule's full text and rationale is in [profile.json](profile.json).

The "Applies to" column is a summary; the selectors are exact. `FIN-REASON-001` in particular selects
the whole of `financial.reversal.*` and `financial.chargeback.*`, but only the named events
`financial.payment.reject`, `financial.payment.cancel`, `financial.transfer.cancel`,
`financial.payout.cancel`, `financial.settlement.cancel`, `financial.withdrawal.reject` and
`financial.refund.create` — **not** every event in the refund, payment or payout families. A refund
that is later settled or cancelled is governed by the movement rules, not by this one.

## Metadata namespace

Every metadata requirement in this profile lives under **`/metadata/financial/`**. Nothing is required
at the root of `metadata`: a key like `/metadata/amount` or `/metadata/status` would collide with any
other profile that governs the same event, and `status` in particular means something different to a
payment, an incident and a deployment.

| Field                   | Type    | Required for                   | Meaning                                                    |
| ----------------------- | ------- | ------------------------------ | ---------------------------------------------------------- |
| `transactionId`         | string  | movement families              | The transaction this event is one step of                  |
| `amount`                | number  | movement families, adjustments | Magnitude of the movement, in the unit the producer states |
| `currency`              | string  | movement families, adjustments | Unit `amount` is expressed in                              |
| `direction`             | string  | movement families              | Which way value moved relative to `/resource`              |
| `status`                | string  | movement families              | Business state of the transaction after this event         |
| `originalTransactionId` | string  | reversals, chargebacks         | The transaction this event acts against                    |
| `reconciliationId`      | string  | reconciliation                 | The reconciliation run this event belongs to               |
| `limitType`             | string  | limit changes                  | Which control changed                                      |
| `approvalRequired`      | boolean | never required                 | Producer's declaration that this operation needed approval |
| `manual`                | boolean | never required                 | Producer's declaration that this was a manual intervention |

**Vocabularies are open.** The profile requires `direction` and `status` to be present and to be
strings. It does not enumerate their values, because `debit`/`credit`, `inbound`/`outbound` and
`pending`/`settled`/`reversed` are all in honest use and a closed list would simply exclude a
conforming producer. The same applies to `currency`: the profile never enumerates currencies, so a
minor-unit ledger, a multi-currency book and a system that settles in something other than a national
currency are all expressible.

## Conditional-policy fields

Two fields are **declarations by the producer**, never requirements in themselves:

- **`approvalRequired`** — "this deployment's policy said this operation needed approval."
- **`manual`** — "this event came from the manual code path, not the automated one."

Both are used only as `when` conditions. Neither is required by any rule, and setting either to
`false` — or omitting it — is fully conforming. The reason is that only the producer knows which of
its code paths is the manual one, and only the operator knows what their approval policy is. The
profile does not guess; it enforces the consequence of whatever the producer declared.

This is the same shape as the IAM profile's `privileged` flag and the document profile's
`recipientType`, and it is the only conditional mechanism v0.1 offers: **one path compared for
equality against one scalar**. When the path is absent the condition does not hold and the rule
contributes nothing.

## Approval model

**Approval is never required by default, and that is a deliberate design decision.**

A marketplace releases thousands of seller payouts an hour with no human in the loop and is right to.
A low-value refund issued by a support agent under a standing policy needs no second signature. A
scheduled net settlement runs at a fixed time against a fixed instruction. A profile that demanded
`/approval` on every monetary operation would describe one treasury department's process, would be
false for most of the domain, and would be disabled rather than adopted.

What the profile requires instead is **consistency with the producer's own declaration**:

1. `/approval` is _recommended_ on the four operations where its absence is worth a question, and
   nowhere else: `FIN-REVERSAL-001` (reversals and chargebacks), `FIN-MANUAL-001` (manual
   interventions), `FIN-RECON-002` (reconciliation adjustments) and `FIN-LIMIT-001` (limit changes).
   `FIN-CORE-002` deliberately does not name it, so a routine capture, transfer or scheduled payout
   is never asked for an approval it does not have and produces no warning for lacking one.
2. When the producer sets `/metadata/financial/approvalRequired` to `true`, `FIN-APPROVAL-001`
   requires `/approval/status` — the decision, not merely the existence of a workflow.

`/approval/status` is required rather than `/approval` because an approval object that names only a
workflow records that a control exists without recording whether it was satisfied. Note that the
profile requires the status to be **present**, not to equal `approved`: an event recording a
`rejected` or `pending` approval is a legitimate and important audit event, and the rule language
cannot express "approved _when the outcome was success_" because it has no boolean combination.

## Privacy considerations

Financial events are the events most likely to carry material that must never enter an audit trail.
The core model already forbids it; this profile adds emphasis because the temptation here is specific
and strong.

**Never record**, in any field, under any name:

- Full account numbers, card numbers, IBANs or any other payment instrument identifier that could be
  used to initiate a movement.
- Card verification values, PINs, one-time codes, banking credentials or scheme API keys.
- Full payment instructions or remittance payloads copied wholesale into `metadata`, `change.before`
  or `change.after`.
- Counterparty personal data — names, addresses, dates of birth — that the audit purpose does not
  require.

**Record instead**: opaque, stable references issued by the producer, such as `account-ref-781`,
`counterparty-ref-44` or `txn-2026-0314-0091`. Every fixture in this profile uses them, and a
reviewer loses nothing: the reference resolves inside the producing system, under that system's own
access controls, for the people entitled to resolve it.

`amount` and `currency` are required because they are the audit facts. A **balance** is not, and no
rule in this profile asks for one: an amount describes the operation, a balance describes the
customer. Where a balance does appear — `reconciliation-adjust.json` records a ledger balance in
`change.before` and `change.after` — it is there because the operation moved that specific value and
`FIN-RECON-002` requires the transition to be recorded. `/change` is a requirement to record **what
this operation altered**, never a licence to snapshot an account.

`auditmodel lint-privacy` runs over every fixture in this profile and must report zero findings; a
test enforces it. Note that the linter checks values, not judgement — a profile-conforming event can
still disclose something it should not, and a clean lint is not a review.

## Known rule-language limitations

The v0.1 rule language checks presence, JSON type and scalar equality. These are the things this
profile would assert and cannot:

- **Amount is type-checked, never range-checked.** `FIN-TXN-001` requires `/metadata/financial/amount`
  to be a `number`. The engine cannot require it to be positive, non-zero, finite, within a limit, or
  consistent with `direction`. `integer` is a subset of `number`, so a minor-unit ledger recording
  `14850` and a decimal ledger recording `148.50` both satisfy the rule — which is intended, since
  the profile does not dictate the unit. **A conforming event may carry a nonsensical amount**, and a
  producer that wants a range check needs one outside the profile.
- **No cross-field comparison.** The profile cannot require that a reversal's amount equals its
  original's, that `direction` agrees with the sign of `amount`, that `status` agrees with
  `event.outcome`, or that `approval.receivedApprovals` reaches `requiredApprovals`.
- **No boolean combination.** "Approved _when_ the outcome was success" and "reason required _unless_
  the actor is a service" are both inexpressible. Every rule has at most one condition.
- **No array-content predicates.** `FIN-LINK-001` requires `/relatedResources` to be non-empty. It
  cannot require that one of the entries is an account, or that a transfer names exactly two sides.
- **No value vocabularies.** `direction`, `status` and `currency` are required to be strings and
  nothing more. A typo is conforming.
- **No numeric or temporal ordering.** The profile cannot require `approvedAt` to precede `time`, nor
  a limit's `after` value to be compared with its `before` value.
- **`when` cannot be negated.** There is no way to write "require X when `manual` is _not_ true".

Where a requirement could not be expressed, it is stated here as guidance and enforced nowhere. The
profile does not pretend otherwise.

## Cross-profile overlaps

- **Identity and access management.** Changing who may move money is an identity operation
  (`identity.role.*`, `identity.permission.*`) and is governed there, not here. This profile governs
  the movement, not the entitlement. An event is never governed by both, because the event families
  do not intersect.
- **Document management.** A settlement statement or a reconciliation report stored as a document is a
  `document.*` event. The financial event references it through `/relatedResources` or
  `/reason/reference`; it does not embed it.
- **Deployment and change management.** `/change` is used by several profiles. Here it always means
  _what this operation altered in the financial record_ — a limit, a posted amount, a ledger balance —
  never a code or configuration release. `change.deploymentId` remains available for correlation and
  is never required by this profile.
- **Incident management.** A financial break usually becomes an incident. The link belongs in
  `change.incidentId` or `reason.reference`; this profile requires neither, because a correction made
  before anyone raised an incident is still a correction.
- **Metadata namespacing** is what keeps these apart in practice. Every field this profile requires is
  under `/metadata/financial/`, so an event governed by two profiles never has two meanings for one
  key.

## Not required, and why

- **`/event/error` on failures.** The core schema already requires an error descriptor whenever
  `outcome` is `failure`, and `errorDescriptor` already requires a `code`. A profile rule restating
  that would add a second place for the requirement to drift.
- **Trace identifiers.** `/request/traceId` and `/request/spanId` are never required. Distributed
  tracing may not exist in a batch settlement runner or a mainframe-adjacent ledger, and an audit
  requirement that assumes an observability stack excludes conforming producers.
  `/request/correlationId` **is** required for movement families, because correlating the steps of one
  transaction is a business need that exists whether or not tracing does.
- **`/request/protocol`, `/request/ipAddress`, `/request/userAgent`.** A payout released by a
  scheduler has no protocol worth recording and no client at all.
- **`/authentication`.** Recommended by `FIN-CORE-002`, never required: batch and scheduled
  operations legitimately have no interactive authentication context. **`/authentication/mfa`** is
  neither required nor recommended by any rule, and no rule pins it to `true`. A deployment that
  wants step-up authentication on high-value movement can express it with `requiredValues` in a local
  profile once it has a producer-set discriminator to condition on.
- **A balance, before or after.** See privacy considerations.
- **A financial approval event family.** Approval is already modelled by `workflow.approval.*` in
  [workflow-and-approval.md](../../semantic-conventions/workflow-and-approval.md) and by the core
  `/approval` object.

## Fixture matrix

[examples/profiles/financial-transaction-management/](../../examples/profiles/financial-transaction-management/)
— twelve valid, twelve invalid, three not-applicable.

| Rule               | Valid fixture                    | Invalid fixture                                                              |
| ------------------ | -------------------------------- | ---------------------------------------------------------------------------- |
| `FIN-CORE-001`     | all twelve                       | `payment-capture-missing-authorization.json`                                 |
| `FIN-CORE-002`     | warns on payout and settlement   | none — a warning cannot fail                                                 |
| `FIN-TXN-001`      | `payment-capture.json`           | `payment-capture-missing-amount.json`, `withdrawal-missing-correlation.json` |
| `FIN-TXN-002`      | `payout-execute.json`            | `payout-missing-direction.json`                                              |
| `FIN-LINK-001`     | `transfer-execute.json`          | `transfer-missing-related-resources.json`                                    |
| `FIN-REASON-001`   | `refund-create.json`             | `refund-missing-reason.json`                                                 |
| `FIN-REVERSAL-001` | `reversal-execute.json`          | `reversal-missing-original-transaction.json`                                 |
| `FIN-APPROVAL-001` | `withdrawal-execute.json`        | `withdrawal-missing-approval-status.json`                                    |
| `FIN-MANUAL-001`   | `deposit-manual-correction.json` | `manual-deposit-missing-change.json`                                         |
| `FIN-RECON-001`    | `reconciliation-adjust.json`     | `reconciliation-missing-identifier.json`                                     |
| `FIN-RECON-002`    | `reconciliation-adjust.json`     | `reconciliation-adjust-missing-change.json`                                  |
| `FIN-LIMIT-001`    | `limit-update.json`              | `limit-update-missing-limit-type.json`                                       |

Every fixture — valid, invalid and not-applicable alike — is core-conforming and privacy-clean. Each
invalid fixture removes exactly one profile-required value from a valid one and fails exactly one rule
with exactly one error.

## Not-applicable rationale

Three fixtures exist to hold the exclusion in place:

| Fixture                | Event                       | Why it is ungoverned                                                    |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------- |
| `balance-view.json`    | `financial.balance.view`    | A read. No value moves and the event is emitted at page-view volume.    |
| `quote-create.json`    | `financial.quote.create`    | A price is computed and recorded. Nothing is owed, paid or transferred. |
| `report-generate.json` | `financial.report.generate` | Routine reporting over movements already audited individually.          |

`check-profile` reports all three as not applicable and exits `3`. **Not applicable is not
conformance** — the profile says nothing about these events rather than blessing them.

If a future edit widened a selector to a bare `financial.` prefix, these fixtures would start
conforming instead of being skipped and the test would fail, which is the point: that edit would
silently impose the profile's heaviest requirements on the highest-volume events in every financial
system that adopted it.

## Open questions

- Should `direction` have a recommended vocabulary in the semantic conventions, given that
  `debit`/`credit` and `inbound`/`outbound` describe the same fact from an accounting and an
  operational point of view? The profile currently requires only that one be recorded.
- Is a partial refund meaningfully different from a reversal for audit purposes? The profile treats
  them as separate families and requires an original transaction reference only from the reversal, on
  the grounds that a goodwill credit has no original.
- Should a settlement be required to name the reconciliation that will check it? It is recommended
  today, because in many deployments the reconciliation identifier is not known when the settlement
  is released.
- What would a producer-set discriminator for high-value movement be called, so that a rule could
  condition stronger evidence on it the way `FIN-APPROVAL-001` conditions on `approvalRequired`?
  There is no adoption evidence yet, and thresholds are not something this specification should set.
