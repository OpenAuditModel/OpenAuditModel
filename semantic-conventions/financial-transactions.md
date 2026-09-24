# Financial Transaction Events

**Specification version: 1.0 · Status: Stable**

## 1. Recommended event names

This domain spans several categories, because moving money, reading a statement and changing a limit
are different kinds of operation:

| Family                               | `event.category`    |
| ------------------------------------ | ------------------- |
| Movements of money                   | `data-modification` |
| Reading a transaction or a statement | `data-access`       |
| Limits and thresholds                | `configuration`     |
| An operation awaiting a decision     | `workflow`          |

### Families

Most of this vocabulary is **open by family**. The profile selects by prefix, so any action under a
family name is governed, and the actions below are the ones the published fixtures carry rather than
a closed list.

| Prefix                      | Covers                                                 |
| --------------------------- | ------------------------------------------------------ |
| `financial.transfer.`       | Movement between two accounts                          |
| `financial.payment.`        | Payment to a payee                                     |
| `financial.payout.`         | Disbursement to a beneficiary                          |
| `financial.deposit.`        | Money received into an account                         |
| `financial.withdrawal.`     | Money taken out of an account                          |
| `financial.refund.`         | Return of a previously captured amount                 |
| `financial.chargeback.`     | A disputed payment reversed by the scheme              |
| `financial.reversal.`       | An operation undone by the producer                    |
| `financial.settlement.`     | Net position settled between parties                   |
| `financial.reconciliation.` | Recorded position corrected against an external record |

### Actions the fixtures carry

| Name                              | Operation                                 |
| --------------------------------- | ----------------------------------------- |
| `financial.transfer.execute`      | A transfer was carried out                |
| `financial.transfer.cancel`       | A transfer was cancelled before execution |
| `financial.payment.capture`       | An authorized payment was captured        |
| `financial.payment.reject`        | A payment was refused                     |
| `financial.payment.cancel`        | A payment was cancelled                   |
| `financial.payout.execute`        | A payout was carried out                  |
| `financial.payout.cancel`         | A payout was cancelled                    |
| `financial.withdrawal.execute`    | A withdrawal was carried out              |
| `financial.withdrawal.reject`     | A withdrawal was refused                  |
| `financial.refund.create`         | A refund was raised                       |
| `financial.chargeback.open`       | A chargeback was opened                   |
| `financial.reversal.execute`      | An operation was reversed                 |
| `financial.settlement.execute`    | A settlement run completed                |
| `financial.settlement.cancel`     | A settlement run was cancelled            |
| `financial.reconciliation.adjust` | A recorded position was corrected         |

### Limits

| Name                     | Operation           |
| ------------------------ | ------------------- |
| `financial.limit.create` | A limit was defined |
| `financial.limit.update` | A limit was changed |
| `financial.limit.delete` | A limit was removed |

## 2. The audit event is not the payment record

This is the distinction the domain most often loses. An audit event records that an operation was
performed and that it was permitted. The payment itself — the instruction, the parties, the
reference data — lives in the system that made it.

[README.md](../README.md) makes the point with the profile's own requirements: the financial profile
asks for an amount, a currency, a direction and a status, and asks for **no account number, no
counterparty name and no payment instruction**. That is not an oversight. A profile requires the
fields that make an operation reviewable, not the business record itself.

A reviewer needs to answer: who moved money, how much, in which direction, under what authorization,
and did anyone approve it. None of those questions needs the payee's address.

## 3. What must never be recorded

- **Primary account numbers**, in full or truncated to a length that narrows the search.
- **IBANs, sort codes and account numbers** wherever an internal identifier would serve. Where a
  counterparty account genuinely must be identifiable, a producer SHOULD record a reference the
  system of record can resolve, not the number itself.
- **Counterparty personal data** — names, addresses, dates of birth.
- **Anything that would let a reader reconstruct the payment instruction**, including a free-text
  remittance field copied verbatim.
- **Authentication and authorization material**: card verification values, one-time codes, tokens.

An audit trail is retained for years and read by people who were not party to the transaction. It is
the wrong place for the data a payment scheme already protects.

## 4. Which principal goes where

| Operation                                        | `actor`      | `resource`       | `subject`    |
| ------------------------------------------------ | ------------ | ---------------- | ------------ |
| A customer initiates a transfer                  | the customer | the **transfer** | absent       |
| A payments service executes a scheduled transfer | the service  | the **transfer** | absent       |
| An operator reverses a payment                   | the operator | the **reversal** | absent       |
| An agent acts on a customer's instruction        | the agent    | the **payment**  | the customer |

The account is a **related resource**, not the primary one: what changed is the movement of money,
and the movement is what the event is about. The last row is the only place `subject` belongs —
someone's authority was borrowed. See [actor-model.md](../specification/actor-model.md) §5.

## 5. Manual intervention

An operation performed by hand rather than by the normal path is what an auditor looks for first: a
manual correction, an override of a limit, a reconciliation adjustment. Where the producer
distinguishes such operations, the distinction SHOULD appear in `metadata` and the justification in
`reason`. Where a second principal approved it, the decision belongs in `approval`.

## 6. Context to populate

| Field                   | Guidance                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| `authorization`         | The decision that permitted the movement                             |
| `approval`              | Where a second principal decided, including when not required        |
| `request.correlationId` | The transaction reference, shared by every event about one movement  |
| `relatedResources`      | The accounts involved, by internal identifier                        |
| `reason`                | Why a manual correction, reversal or adjustment was made             |
| `metadata.financial`    | Amount, currency, direction, status and the producer's own reference |

## 7. Example

See
[examples/profiles/financial-transaction-management/valid/transfer-execute.json](../examples/profiles/financial-transaction-management/valid/transfer-execute.json)
for a completed transfer with the authorization decision, the correlation reference, the amount and
currency, and no account or counterparty detail.
