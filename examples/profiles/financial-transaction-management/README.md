# Financial transaction management profile fixtures

**Status: Informative.** These fixtures illustrate and regression-test the
[financial-transaction-management profile](../../../profiles/financial-transaction-management/). The
rules themselves are in
[profile.json](../../../profiles/financial-transaction-management/profile.json).

```bash
auditmodel check-profile examples/profiles/financial-transaction-management/valid --profile financial-transaction-management
```

Every fixture here — valid, invalid and not-applicable alike — is a **core-conforming** event. The
ones under `invalid/` fail the profile, not the core schema. That separation is the point: a profile
adds requirements to events the core already accepts.

## The guarantee these fixtures carry

Each file under `valid/` must satisfy all three commands, and a test enforces it:

```bash
auditmodel validate      examples/profiles/financial-transaction-management/valid
auditmodel lint-privacy  examples/profiles/financial-transaction-management/valid
auditmodel check-profile examples/profiles/financial-transaction-management/valid --profile financial-transaction-management
```

A profile that accepted an event the core rejects would break the core invariant. A profile over money
that accepted an event carrying an account number or a scheme credential would be worse than no
profile at all.

## Valid fixtures

| File                             | Event                             | Demonstrates                                                        |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `payment-capture.json`           | `financial.payment.capture`       | The movement requirements alone: reference, amount, currency, state |
| `payment-reject.json`            | `financial.payment.reject`        | A refusal: `outcome: failure`, an error descriptor and a reason     |
| `transfer-execute.json`          | `financial.transfer.execute`      | A two-sided movement naming its counterparty account                |
| `withdrawal-execute.json`        | `financial.withdrawal.execute`    | Conditional approval: `approvalRequired` declared, decision carried |
| `deposit-manual-correction.json` | `financial.deposit.record`        | A manual intervention: `manual` declared, change and reason carried |
| `refund-create.json`             | `financial.refund.create`         | A refund justified against the payment it returns                   |
| `reversal-execute.json`          | `financial.reversal.execute`      | An unwind naming the transaction it acts against                    |
| `chargeback-open.json`           | `financial.chargeback.open`       | A dispute raised by an external counterparty                        |
| `payout-execute.json`            | `financial.payout.execute`        | An automated payout, legitimately with no approval and no reason    |
| `settlement-execute.json`        | `financial.settlement.execute`    | A scheduled net settlement linking both sides                       |
| `reconciliation-adjust.json`     | `financial.reconciliation.adjust` | A break corrected in the books, with the transition recorded        |
| `limit-update.json`              | `financial.limit.update`          | A preventive control raised, with its before and after state        |

Three of these produce **warnings** rather than errors, and that is intentional:

- `payout-execute.json` and `settlement-execute.json` omit `/reason`. A scheduled payout or settlement
  has no per-event business justification beyond the schedule, and `FIN-CORE-002` recommends rather
  than requires one.
- `chargeback-open.json` omits `/approval`. A chargeback is raised by a counterparty, not approved
  internally, so `FIN-REVERSAL-001` recommends approval rather than requiring it.

A warning never fails conformance. All twelve fixtures are reported as conforming.

Vendor spread is deliberate: the producing applications are a payment service, a ledger service, a
brokerage ledger, a marketplace payments service, a marketplace payout service, a treasury settlement
runner, a treasury reconciliation tool and a treasury controls console. The same rules apply to all of
them.

## Invalid fixtures

Each removes exactly one profile-required value from a valid fixture, so it fails for one documented
reason. A test asserts both the rule and the pointer, and that **exactly one** error is produced.

| File                                         | Violates           | At                                          |
| -------------------------------------------- | ------------------ | ------------------------------------------- |
| `payment-capture-missing-authorization.json` | `FIN-CORE-001`     | `/authorization`                            |
| `payment-capture-missing-amount.json`        | `FIN-TXN-001`      | `/metadata/financial/amount`                |
| `withdrawal-missing-correlation.json`        | `FIN-TXN-001`      | `/request/correlationId`                    |
| `payout-missing-direction.json`              | `FIN-TXN-002`      | `/metadata/financial/direction`             |
| `transfer-missing-related-resources.json`    | `FIN-LINK-001`     | `/relatedResources`                         |
| `refund-missing-reason.json`                 | `FIN-REASON-001`   | `/reason`                                   |
| `reversal-missing-original-transaction.json` | `FIN-REVERSAL-001` | `/metadata/financial/originalTransactionId` |
| `withdrawal-missing-approval-status.json`    | `FIN-APPROVAL-001` | `/approval/status`                          |
| `manual-deposit-missing-change.json`         | `FIN-MANUAL-001`   | `/change`                                   |
| `reconciliation-missing-identifier.json`     | `FIN-RECON-001`    | `/metadata/financial/reconciliationId`      |
| `reconciliation-adjust-missing-change.json`  | `FIN-RECON-002`    | `/change`                                   |
| `limit-update-missing-limit-type.json`       | `FIN-LIMIT-001`    | `/metadata/financial/limitType`             |

Every enforceable rule has at least one negative fixture. Two of them are worth reading closely:

- `withdrawal-missing-approval-status.json` keeps the `/approval` object and removes only its
  `status`. That is the failure the rule is really about: a record naming an approval workflow without
  saying whether anyone approved anything.
- `manual-deposit-missing-change.json` is a `financial.deposit.record` event, which no rule requires a
  `/change` on. It fails only because the producer declared `manual: true`, which is what makes
  `FIN-MANUAL-001` apply.

## Not-applicable fixtures

| File                   | Event                       | Why it is ungoverned                                                     |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `balance-view.json`    | `financial.balance.view`    | A read. No value moves, and it is emitted at page-view volume.           |
| `quote-create.json`    | `financial.quote.create`    | A price is computed. Nothing is owed, paid or transferred.               |
| `report-generate.json` | `financial.report.generate` | Routine reporting over movements that were already audited individually. |

All three are perfectly good audit events that this profile deliberately does not govern.
`check-profile` reports them as not applicable and exits with code 3.

They exist to hold the exclusion in place. If a future edit widened a selector to a bare `financial.`
prefix, these fixtures would start conforming instead of being skipped, and the test would fail —
which is the point, because that edit would silently impose an authorization decision, an amount, a
currency, a direction and a correlation identifier on every balance lookup in a retail application.

## Vendor neutrality

No fixture names a real product, company, bank, card scheme, jurisdiction or regulation. Policy names,
workflow names, currency codes and control categories are illustrative strings, not any
organization's scheme, and no rule in the profile depends on any of them.

## What the fixtures never contain

Account and instrument references are **opaque**: `account-ref-781`, `counterparty-ref-44`,
`payment-ref-4412`, `txn-2026-0314-0091`. Not one fixture carries a full account number, a card
number, an IBAN, a payment credential, a scheme API key, an authentication secret or a counterparty's
personal data — because a real audit trail must not carry them either, and a fixture is the first
thing an implementer copies.

Balances appear only inside `change.before` and `change.after` where the operation changed them, and
then only as the single value that moved. `auditmodel lint-privacy` reports zero findings across all
twenty-seven fixtures, and a test enforces that.
