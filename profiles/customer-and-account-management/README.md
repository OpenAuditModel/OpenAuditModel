# Customer and Account Management Profile

**Profile version: 0.1 · Core versions: 0.1 · Status: Experimental · Implemented, 13 rules (12
enforceable)**

Additional conformance requirements for material **customer** and **business account** lifecycle
audit events: creating, updating, merging, restricting, closing and deleting a customer record, and
opening, updating, re-limiting, freezing, restricting, reinstating and closing an account.

```bash
auditmodel check-profile examples/profiles/customer-and-account-management/valid \
  --profile customer-and-account-management
```

The rules live in [profile.json](profile.json) and are enforced by the declarative engine described in
[profiles/README.md](../README.md). Nothing in this profile is implemented in code.

## Purpose

Customer and account administration is where a business decides who it will deal with and on what
terms. Freezing an account, restricting a relationship, raising a transfer limit, merging two parties
or erasing a record are the operations a complaint, a dispute, a fraud investigation or a supervisory
question later turns on — and they are typically performed by a handful of operators through internal
consoles that log the least.

The core model already records who did what to which resource. What it cannot know is the small set
of domain facts that make these particular events reviewable: what kind of party the record describes,
which account it was, what a restriction actually prevented, what a limit was before and after, which
record a merge retired, and whether an operator was acting for someone else. This profile requires
those facts and nothing else.

## Scope

The profile is vendor-neutral. It describes operations that any system holding customers and accounts
performs — a bank, a telecommunications operator, an insurer, a utility, a marketplace, a SaaS
billing platform — and assumes no particular product, storage backend, workflow engine, account
numbering scheme, regulator or jurisdiction.

It governs **business parties and business accounts**. It is not an identity profile: see
[Cross-profile overlaps](#cross-profile-overlaps).

## Event families

| Family                     | Events                                                                                                      | Governed |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| Customer record lifecycle  | `customer.create`, `.update`, `.merge`, `.close`, `.delete`, `.restrict`, `.restore`                        | yes      |
| Account lifecycle          | `account.open`, `.update`, `.close`, `.reopen`, `.freeze`, `.unfreeze`, `.restrict`                         | yes      |
| Account status transitions | `account.status.` prefix (for producers that model transitions as one event rather than distinct verbs)     | yes      |
| Account limits             | `account.limit.` prefix                                                                                     | yes      |
| Reads and searches         | `customer.profile.view`, `customer.search`, `account.balance.view`, `account.statement.view`, and their kin | **no**   |

Both shapes of status change are accepted deliberately. Some systems emit `account.freeze`; others
emit a single `account.status.update` and carry the transition in `change`. The profile requires the
same facts from both rather than forcing a producer to rename its events, and the fixtures include
one of each.

`event.category` is left to the producer. A freeze is reasonably `security` in one system and
`resource-lifecycle` in another, and no rule here inspects the category.

### Explicit exclusions

Ordinary reads are **not governed**: profile views, customer searches, balance and statement lookups,
transaction listings, entitlement checks, and any other high-volume data-plane traffic. A customer
platform emits these constantly. Requiring a party type, an owning customer and a justification on
each of them would add cost to the highest-volume events in the system in exchange for very little
review value, and the requirement would be switched off rather than met.

The exclusion is **structural, not a matter of discipline**: no selector in this profile uses a bare
`customer.` or `account.` prefix. The lifecycle families are named event-by-event, and only
`account.limit.` and `account.status.` — sub-families in which every member is a material change —
are matched by prefix. `customer.profile.view` and `account.balance.view` therefore match no rule at
all and `check-profile` reports them as not applicable. A test asserts this, because widening one
prefix later would silently start governing every profile view in a deployment.

Excluded does not mean unaudited. A view of a customer record is still a conforming OpenAuditModel
event, and [data-access.md](../../semantic-conventions/data-access.md) covers recording reads —
including the case, called out there, where a read crosses a customer boundary and deserves more.

## Rules

Twelve rules are enforceable (`error`); `CUSTOMER-CORE-002` is a `warning` and never fails
conformance.

| Rule                    | Applies to                                                                        | Requires                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `CUSTOMER-CORE-001`     | every governed event                                                              | `/metadata/customer/customerType` string                                           |
| `CUSTOMER-CORE-002`     | every governed event                                                              | _recommends_ `/reason`, `/request/correlationId`, `/resource/classification`       |
| `CUSTOMER-ACCOUNT-001`  | every governed `account.*` event                                                  | `/resource/ownerId`, `/metadata/customer/accountType` string                       |
| `CUSTOMER-CONTROL-001`  | merge, close, delete, restrict, restore, reopen, freeze, unfreeze, limits, status | `/authorization`, `/reason`; _recommends_ `/approval`                              |
| `CUSTOMER-UPDATE-001`   | `customer.update`, `account.update`                                               | `/change`; _recommends_ `/change/changedFields`                                    |
| `CUSTOMER-STATE-001`    | status transitions and `account.status.`                                          | `/change`, `/metadata/customer/status` string                                      |
| `CUSTOMER-RESTRICT-001` | `customer.restrict`, `account.restrict`, `account.freeze`                         | `/metadata/customer/restrictionScope` string; _recommends_ `/approval`, `reviewId` |
| `CUSTOMER-LIMIT-001`    | `account.limit.`                                                                  | `/change/before`, `/change/after`, `/metadata/customer/limitType` string           |
| `CUSTOMER-MERGE-001`    | `customer.merge`                                                                  | `/relatedResources`, `/metadata/customer/mergedFromId` string                      |
| `CUSTOMER-DELETE-001`   | `customer.delete`                                                                 | `/metadata/customer/deletionScope` string; _recommends_ `/approval`, `/privacy`    |
| `CUSTOMER-APPROVAL-001` | every governed event, **when** `/metadata/customer/approvalRequired` is `true`    | `/approval/status`                                                                 |
| `CUSTOMER-SUBJECT-001`  | every governed event, **when** `/metadata/customer/onBehalfOf` is `true`          | `/subject`                                                                         |
| `CUSTOMER-OVERRIDE-001` | every governed event, **when** `/metadata/customer/manualOverride` is `true`      | `/authorization`, `/reason`                                                        |

Each rule's full text and rationale is in [profile.json](profile.json).

## Metadata namespace

Every metadata requirement lives under **`/metadata/customer/`**. Nothing is required at a metadata
root key: `/metadata/status` or `/metadata/type` would collide with any other profile that governs the
same event, and a reader would have no way to tell whose `status` it was.

| Field              | Type    | Required by                             | Example                             |
| ------------------ | ------- | --------------------------------------- | ----------------------------------- |
| `customerType`     | string  | `CUSTOMER-CORE-001` (every event)       | `business`, `individual`, `partner` |
| `accountType`      | string  | `CUSTOMER-ACCOUNT-001` (account events) | `settlement`, `subscription`        |
| `status`           | string  | `CUSTOMER-STATE-001` (transitions)      | `active`, `restricted`, `closed`    |
| `restrictionScope` | string  | `CUSTOMER-RESTRICT-001`                 | `outbound-payments`                 |
| `limitType`        | string  | `CUSTOMER-LIMIT-001`                    | `daily-transfer-limit`              |
| `mergedFromId`     | string  | `CUSTOMER-MERGE-001`                    | `customer-8420`                     |
| `deletionScope`    | string  | `CUSTOMER-DELETE-001`                   | `personal-data`, `full-record`      |
| `approvalRequired` | boolean | conditional discriminator               | `true`                              |
| `onBehalfOf`       | boolean | conditional discriminator               | `true`                              |
| `manualOverride`   | boolean | conditional discriminator               | `true`                              |
| `reviewId`         | string  | recommended by `CUSTOMER-RESTRICT-001`  | `review-2026-044`                   |

Every vocabulary above is **open**. The profile requires that a value be recorded and that it be a
string; it does not say what a customer type, an account type, a status or a restriction scope may be,
because those are product and organization decisions. A profile that enumerated them would be one
vendor's field list wearing a domain's name.

## Conditional-policy fields

Three requirements fire only on a discriminator the **producer** sets. This is the whole conditional
mechanism v0.1 offers — one path compared for equality against one scalar — and it is used here for
the same reason the IAM profile uses `privileged` and the document profile uses `recipientType`: the
profile cannot decide these questions for a deployment, but it can enforce the consequence of the
deployment's own answer.

| Discriminator                         | Consequence                                                     |
| ------------------------------------- | --------------------------------------------------------------- |
| `/metadata/customer/approvalRequired` | `CUSTOMER-APPROVAL-001` requires `/approval/status`             |
| `/metadata/customer/onBehalfOf`       | `CUSTOMER-SUBJECT-001` requires `/subject`                      |
| `/metadata/customer/manualOverride`   | `CUSTOMER-OVERRIDE-001` requires `/authorization` and `/reason` |

**When the discriminator is absent, the condition does not hold and the rule contributes nothing.**
That is deliberate and is documented in [profiles/README.md](../README.md): treating a missing flag as
possibly true would fail every event that never intended to declare one. If an organization wants the
flag itself to be mandatory, that is a local policy, and this profile does not impose it — an event
that simply never says `manualOverride` is conforming.

## Approval model

`/approval` is **never universally required**. Customer administration is performed by trained
operators making single-person decisions in every organization the authors are aware of, and a profile
that demanded a second approver on every freeze would describe one company's process and be ignored
everywhere else.

Instead:

- `CUSTOMER-CONTROL-001` **recommends** `/approval` on every restrictive, destructive or
  limit-changing operation, so its absence is visible as a warning.
- `CUSTOMER-RESTRICT-001` and `CUSTOMER-DELETE-001` repeat the recommendation for the two operations
  where a second pair of eyes matters most.
- `CUSTOMER-APPROVAL-001` **requires** `/approval/status` when, and only when, the producer has itself
  declared `approvalRequired: true`. An operation the system said needed approval, recorded with no
  approval state at all, is either an unapproved change or an unrecorded one — and the trail cannot
  tell which.

The rule requires `/approval/status` rather than `/approval`, so the finding points at the fact that is
missing rather than at its container. It does **not** require the status to equal `approved`: a
rejected or expired approval is a legitimate thing to record, and an event that failed for exactly
that reason must remain expressible.

## Privacy considerations

Customer records are the densest concentration of personal data most systems hold, so this profile is
deliberately built out of **categories and opaque identifiers**, never people.

- Nothing in the profile requires a name, an email address, a telephone number, a postal address, a
  date of birth, a national identifier, a payment instrument or an account number. The party is
  identified by `/resource/id` and `/resource/ownerId`, which are opaque references.
- `customerType` is a **category** — `business`, `individual`, `partner`. It is what makes an access
  review answerable and it identifies nobody.
- `CUSTOMER-UPDATE-001` requires `/change` and recommends `/change/changedFields` precisely so that a
  producer can record _which_ fields of a customer record changed without recording their values. The
  core accepts field names, sanitized state, hashes or references, and for this domain field names are
  usually the right answer.
- `CUSTOMER-DELETE-001` recommends `/privacy` on erasure, because an erasure event that itself carries
  the erased data is the worst possible outcome.
- Account numbers, card numbers and IBANs must never appear anywhere in an event — not in
  `resource.id`, not in `metadata`, not in `change`. Use an opaque account reference such as
  `account-ref-781`. `resource.name` is left unused by every fixture in this profile for the same
  reason: for a customer it is usually a person's or a company's name.

Profile conformance is not privacy compliance. Run `auditmodel lint-privacy` as well; every fixture
here is required by test to pass both.

## Known rule-language limitations

The v0.1 rule language checks presence, JSON type and strict scalar equality. It has no regular
expressions, no numeric comparison, no cross-field comparison, no boolean combination and no
array-content predicates. Consequences worth stating plainly:

- **`CUSTOMER-LIMIT-001` cannot check the direction or the size of a limit change.** It requires that
  `/change/before` and `/change/after` both be recorded and leaves the comparison — and any threshold
  above which a second approver is expected — to the reviewer or to a downstream policy engine. The
  profile can guarantee the evidence exists; it cannot evaluate it.
- **No rule can require that a status actually changed.** `CUSTOMER-STATE-001` requires `/change` and
  the resulting `status`, but it cannot assert that `/change/before/status` differs from
  `/change/after/status`, because that is a cross-field comparison.
- **No rule can require that `/relatedResources` contains a customer.** `CUSTOMER-MERGE-001` requires
  the array to be present and non-empty; array contents are never inspected. The retired record is
  therefore _also_ required in `/metadata/customer/mergedFromId`, where a scalar check works.
- **A rule cannot say "either A or B".** There is no disjunction, so where two shapes are both
  legitimate the profile requires whichever fact both shapes can carry.
- **Only one condition per rule.** "Required when the override is manual _and_ the account is frozen"
  is not expressible; such a requirement would have to be split or dropped. It was dropped.
- **`account.limit.` and `account.status.` are prefixes**, so a producer that emitted
  `account.limit.view` would find it governed. Reads should be named after what is read
  (`account.balance.view`), not placed under a mutation sub-family. This is guidance, not something
  the rule language can enforce.
- **Outcome and error are left entirely to the core.** The core schema already requires
  `/event/error` whenever `outcome` is `failure`, and `errorDescriptor` already requires `code`. A
  profile rule restating that would add nothing, so there is none.

## Cross-profile overlaps

### identity-and-access-management — the boundary that matters most

[identity-and-access-management](../identity-and-access-management/) governs **identities**: who can
sign in, what they may do, and with what credentials. It selects on the `identity.` prefix and covers
`identity.user.*`, `identity.role.*`, `identity.permission.*`, `identity.service-account.*` and
`identity.credential.rotate`.

This profile governs **business parties and business accounts**: who the organization deals with and
on what terms. The two never select the same event — `identity.` is not a prefix here, and neither
`customer.` nor `account.` is a prefix there — so no event is ever governed by both, and the
requirements can never conflict.

| Question                                 | Profile                         | Example event                |
| ---------------------------------------- | ------------------------------- | ---------------------------- |
| May this login reach that system?        | identity-and-access-management  | `identity.role.assign`       |
| Is this party allowed to trade with us?  | customer-and-account-management | `customer.restrict`          |
| Disable a person's ability to sign in    | identity-and-access-management  | `identity.user.disable`      |
| Freeze a business account's transactions | customer-and-account-management | `account.freeze`             |
| Rotate a credential                      | identity-and-access-management  | `identity.credential.rotate` |
| Close a commercial relationship          | customer-and-account-management | `customer.close`             |

**Do not reuse `identity.*` for business-account lifecycle.** A customer portal login account and the
settlement account it can operate are different objects with different owners, different lifecycles
and different reviewers; collapsing them makes "which accounts were frozen?" unanswerable. When a
single operation does both — offboarding closes the relationship _and_ disables the sign-in — emit two
events and correlate them with `/request/correlationId`. Each is then governed by exactly one profile
and both are complete.

Where the two profiles chose the same idea they chose the same shape, so that a reviewer moves between
them without relearning anything: a `type` category on the record (`/metadata/user/type` there,
`/metadata/customer/customerType` here), a producer-set boolean discriminator driving a conditional
rule, and namespaced metadata throughout.

### financial-transaction-management — the other place a limit appears

That profile governs the movement of value: `financial.transfer.*`, `financial.payment.*`,
`financial.reversal.*`, `financial.settlement.*` and, notably, `financial.limit.*`. This profile
governs the _account_ whose limit it is, under `account.limit.*`. The two prefixes are disjoint, so
again no event is governed by both, but the boundary deserves stating because both concern limits:

- **`account.limit.*` is an attribute of the account.** Raising the daily transfer ceiling on
  `account-ref-781` is an act of account administration performed by an operator. It belongs here.
- **`financial.limit.*` is a control on the payment flow.** A limit consumed, breached or waived while
  a transfer is being processed belongs there, with the transaction it constrained.

If in doubt: the event that names an **account** as its resource and changes what that account may do
from now on is this profile's; the event that names a **transaction** and explains why it was allowed,
blocked or reversed is the financial profile's.

### document-management

[document-management](../document-management/) may govern the contract or onboarding pack attached to
a customer. Those are `document.*` events and are not selected here. A customer file and a customer
record are different resources; keep them as different events.

### Other profiles

`incident-management`, `deployment-and-change-management`, `secrets-and-key-management`,
`backup-and-recovery`, `message-broker-management` and `api-and-integration-management` all select
disjoint namespaces (`incident.`, `problem.`, `corrective-action.`, `deployment.`, `change.request.`,
`configuration.`, `secret.`, `key.`, `certificate.`, `backup.`, `snapshot.`, `restore.`, `recovery.`,
`broker.`, `api-key.`, `webhook.`, `integration.`). A fraud incident may cause an account freeze and a
migration may re-limit accounts, but the events stay separate and are joined by
`/request/correlationId` or `/change/incidentId` rather than by one profile governing another's
events.

## Not required, and why

- **KYC, sanctions, credit and identity-verification outcomes.** Real and important, but they are
  regulatory and jurisdictional constructs. [profiles/README.md](../README.md) is explicit that a
  profile cites no regulation and encodes no jurisdiction. Producers should model these as their own
  events and put the detail in `metadata` or an extension.
- **Balances, amounts and currencies.** A balance is business data, not audit interpretation data,
  and requiring it would push monetary values into every audit event. `CUSTOMER-LIMIT-001` requires
  before-and-after values only for the limit that changed, because there the pair _is_ the audit fact.
- **`/authentication` or MFA on restrictive operations.** The IAM profile requires
  `/authentication/mfa` for privileged role changes because a role change is an access change. A
  customer freeze is performed by an already-authenticated operator in a back-office console, and the
  session's factors are a property of the console, not of the operation. It is recorded in the
  `account-freeze` fixture as good practice and required by no rule.
- **Trace identifiers.** `/request/traceId` and `/request/spanId` are never required or recommended:
  a conforming producer may have no tracing at all. `/request/correlationId` is recommended, because
  onboarding, review and offboarding are genuinely multi-event workflows.
- **`/request/protocol`.** These operations arrive over consoles, APIs, batch files and back-office
  terminals. Requiring a protocol would describe the mechanism rather than the operation.
- **A customer approval event family.** Approval is already modelled by `workflow.approval.*` in
  [workflow-and-approval.md](../../semantic-conventions/workflow-and-approval.md) and by the core
  `/approval` object.

## Fixtures

[examples/profiles/customer-and-account-management/](../../examples/profiles/customer-and-account-management/)
— twelve valid, twelve invalid, three not-applicable.

| Kind              | Count | Guarantee                                                              |
| ----------------- | ----- | ---------------------------------------------------------------------- |
| `valid/`          | 12    | core-valid, privacy-clean, conforming with **zero** warnings           |
| `invalid/`        | 12    | core-valid, privacy-clean, exactly one error at one documented pointer |
| `not-applicable/` | 3     | core-valid, privacy-clean, governed by no rule (exit 3)                |

Every enforceable rule has at least one invalid fixture. The mapping from fixture to rule and pointer
is in the [fixture README](../../examples/profiles/customer-and-account-management/README.md) and is
asserted by [conformance/tests/profile-customer-and-account-management.test.ts](../../conformance/tests/profile-customer-and-account-management.test.ts).

## Open questions

- Should `restrictionScope` be a single string or a list of blocked capabilities? A list is more
  honest for systems that restrict several capabilities at once, but the rule language cannot inspect
  array contents, so a required array would be a presence check on an unexaminable value. v0.1 takes
  the string.
- Is `deletionScope` the right discriminator for erasure, or should erasure be its own event name
  (`customer.erase`) distinct from record deletion? There is not yet adoption evidence either way.
- Should account reopening require the reason the original closure was reversed, separately from the
  reason for reopening? Two justifications on one event has no precedent in the core model.
- Is `onBehalfOf` redundant with `/delegation`? For producers that model delegation it is; for the
  many that record acting-for relationships informally it is the only signal available. The profile
  accepts the redundancy rather than lose the case.
