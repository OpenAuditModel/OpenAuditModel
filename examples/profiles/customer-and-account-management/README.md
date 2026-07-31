# Customer and account management profile fixtures

**Status: Informative.** These fixtures illustrate and regression-test the
[customer-and-account-management profile](../../../profiles/customer-and-account-management/). The
rules themselves are in
[profile.json](../../../profiles/customer-and-account-management/profile.json).

```bash
auditmodel check-profile examples/profiles/customer-and-account-management/valid \
  --profile customer-and-account-management
```

Every fixture here — valid, invalid and not-applicable alike — is a **core-conforming**,
**privacy-clean** event. The ones under `invalid/` fail the profile, not the core schema. That
separation is the point: a profile adds requirements to events the core already accepts.

## The guarantee these fixtures carry

Each file under `valid/` must satisfy all three commands, and a test enforces it:

```bash
auditmodel validate      examples/profiles/customer-and-account-management/valid
auditmodel lint-privacy  examples/profiles/customer-and-account-management/valid
auditmodel check-profile examples/profiles/customer-and-account-management/valid \
  --profile customer-and-account-management
```

A profile that accepted an event the core rejects would break the core invariant. A profile whose own
examples carried a customer's name, address or account number would be worse than no profile.

## Valid fixtures

All twelve conform with **zero** warnings: each one records the recommended `/reason`,
`/request/correlationId` and `/resource/classification` as well as everything its rules require.

| File                            | Event                    | Demonstrates                                                         |
| ------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| `customer-create.json`          | `customer.create`        | Onboarding: the party type alone is what this event must add         |
| `customer-update.json`          | `customer.update`        | A record change carrying field names instead of values               |
| `customer-merge.json`           | `customer.merge`         | A merge naming the retired record on both sides                      |
| `customer-close.json`           | `customer.close`         | A closure recorded as a state transition                             |
| `customer-restrict.json`        | `customer.restrict`      | A restriction stating what it prevents, with the review behind it    |
| `customer-delete.json`          | `customer.delete`        | Erasure of personal data with the transactional record retained      |
| `account-open.json`             | `account.open`           | An account naming the customer it belongs to                         |
| `account-update-override.json`  | `account.update`         | A manual override, which needs a justification an update does not    |
| `account-freeze.json`           | `account.freeze`         | A freeze: restriction scope, resulting status and transition         |
| `account-close-approved.json`   | `account.close`          | A closure the producer declared needed approval                      |
| `account-limit-increase.json`   | `account.limit.increase` | A limit change recorded as a before-and-after pair                   |
| `account-status-on-behalf.json` | `account.status.update`  | The alternative status-event shape, performed for the account holder |

Two pairs are deliberately near-identical so that the conditional rules are visible:

- `account-close-approved.json` sets `approvalRequired: true` and therefore must carry
  `/approval/status`; `customer-close.json` does not set it and carries an approval anyway.
- `account-status-on-behalf.json` sets `onBehalfOf: true` and therefore must name a `/subject`;
  every other fixture omits both.
- `account-update-override.json` sets `manualOverride: true` and therefore must carry an
  authorization decision and a justification, which no rule requires of a plain `account.update`.

`account-status-on-behalf.json` records a `/subject` **without** a `/delegation` object, because many
systems record acting-for relationships without modelling delegation. Where delegation _is_ modelled,
the core already requires a subject.

## Invalid fixtures

Each is its valid counterpart with exactly one profile-required value removed, so it fails for one
documented reason. A test asserts the rule, the pointer, and that **exactly one** error is produced.

| File                                            | Derived from                    | Violates                | At                                    |
| ----------------------------------------------- | ------------------------------- | ----------------------- | ------------------------------------- |
| `customer-create-missing-customer-type.json`    | `customer-create.json`          | `CUSTOMER-CORE-001`     | `/metadata/customer/customerType`     |
| `account-open-missing-owner.json`               | `account-open.json`             | `CUSTOMER-ACCOUNT-001`  | `/resource/ownerId`                   |
| `customer-close-missing-authorization.json`     | `customer-close.json`           | `CUSTOMER-CONTROL-001`  | `/authorization`                      |
| `customer-update-missing-change.json`           | `customer-update.json`          | `CUSTOMER-UPDATE-001`   | `/change`                             |
| `account-freeze-missing-status.json`            | `account-freeze.json`           | `CUSTOMER-STATE-001`    | `/metadata/customer/status`           |
| `account-freeze-missing-restriction-scope.json` | `account-freeze.json`           | `CUSTOMER-RESTRICT-001` | `/metadata/customer/restrictionScope` |
| `account-limit-missing-before.json`             | `account-limit-increase.json`   | `CUSTOMER-LIMIT-001`    | `/change/before`                      |
| `customer-merge-missing-source.json`            | `customer-merge.json`           | `CUSTOMER-MERGE-001`    | `/metadata/customer/mergedFromId`     |
| `customer-delete-missing-scope.json`            | `customer-delete.json`          | `CUSTOMER-DELETE-001`   | `/metadata/customer/deletionScope`    |
| `account-close-missing-approval.json`           | `account-close-approved.json`   | `CUSTOMER-APPROVAL-001` | `/approval/status`                    |
| `account-status-missing-subject.json`           | `account-status-on-behalf.json` | `CUSTOMER-SUBJECT-001`  | `/subject`                            |
| `account-update-missing-override-reason.json`   | `account-update-override.json`  | `CUSTOMER-OVERRIDE-001` | `/reason`                             |

Every enforceable rule in the profile has a fixture here. Three of these fixtures also produce a
**warning** — a missing recommended `/approval`, `/change/changedFields` or `/reason` — which is
correct: a recommendation never fails conformance, and the negative test counts errors only.

Each fixture keeps the `id` of the valid event it was derived from, so a reader can diff the two files
and see the single removed field.

## Not-applicable fixtures

| File                         | Event                   | Why it is out of scope                         |
| ---------------------------- | ----------------------- | ---------------------------------------------- |
| `customer-profile-view.json` | `customer.profile.view` | An ordinary read of a customer record          |
| `customer-search.json`       | `customer.search`       | A directory search from a service desk console |
| `account-balance-view.json`  | `account.balance.view`  | A routine balance lookup                       |

These are perfectly good audit events that this profile deliberately does not govern.
`check-profile` reports each as not applicable with exit code 3.

They exist to hold the exclusion in place. No selector in the profile uses a bare `customer.` or
`account.` prefix; the lifecycle families are named event-by-event and only `account.limit.` and
`account.status.` are matched by prefix. If a future edit widened a selector to `customer.` or
`account.`, these three fixtures would start conforming instead of being skipped and the test would
fail — which is the point, because that edit would silently impose a party type, an owning customer
and a justification on every profile view, search and balance lookup in a customer platform.

Not applicable is **not** conformance. It is reported as out of scope, never as satisfied.

## Vendor neutrality

No fixture names a real product, company, bank, regulator, jurisdiction or regulation. Customer types,
account types, statuses, restriction scopes, limit types and policy names are illustrative strings,
not any organization's scheme, and no rule constrains their values.

## Privacy

No fixture contains a personal name, an email address, a telephone number, a postal address, a date of
birth, a national identifier, an account number, a card number or an IBAN — and none contains a
credential, token or secret of any kind. Parties and accounts are referred to only by opaque
identifiers such as `customer-42`, `account-ref-781` and `review-2026-044`, and `resource.name` is
left unused throughout because for a customer record it would usually be a person's or a company's
name.

The only values that appear inside `change.before` and `change.after` are a status token and a numeric
limit — exactly the minimum needed to make each transition reviewable.
