# Customer and Account Events

**Specification version: 1.0 · Status: Stable**

## 1. Recommended event names

Several categories, because opening an account, restricting one and reading a customer record are
different kinds of operation:

| Family                                   | `event.category`     |
| ---------------------------------------- | -------------------- |
| Customer and account record changes      | `data-modification`  |
| Opening, closing and reopening           | `resource-lifecycle` |
| Restriction, freezing and status changes | `security`           |
| Reading a customer or account record     | `data-access`        |
| Limits and thresholds                    | `configuration`      |

### Customers

| Name                | Operation                                          |
| ------------------- | -------------------------------------------------- |
| `customer.create`   | A customer record was created                      |
| `customer.update`   | Customer attributes changed                        |
| `customer.merge`    | Two customer records were combined                 |
| `customer.restrict` | A restriction was placed on a customer             |
| `customer.close`    | A customer relationship was ended                  |
| `customer.delete`   | A customer record was removed                      |
| `customer.restore`  | A closed or deleted customer record was reinstated |

### Accounts

| Name               | Operation                              |
| ------------------ | -------------------------------------- |
| `account.open`     | An account was opened                  |
| `account.update`   | Account attributes changed             |
| `account.freeze`   | An account was frozen                  |
| `account.unfreeze` | A freeze was lifted                    |
| `account.restrict` | A restriction was placed on an account |
| `account.close`    | An account was closed                  |
| `account.reopen`   | A closed account was reopened          |

### Limits and status

Two families are selected by prefix, so any action under them is governed:

| Prefix            | Covers                                              |
| ----------------- | --------------------------------------------------- |
| `account.limit.`  | Changes to a limit or threshold on an account       |
| `account.status.` | Changes to an account's standing or lifecycle state |

## 2. This is not the identity vocabulary

**A customer is not a user, and an account is not a login.** This document governs business parties
and business accounts. A user, a role, a permission, a credential or a session belongs to
[identity-and-access.md](identity-and-access.md), and the two vocabularies never select the same
event — [profiles/customer-and-account-management/README.md](../profiles/customer-and-account-management/README.md)
states the boundary and the profile enforces it: `identity.` is not a prefix here, and neither
`customer.` nor `account.` is a prefix there.

This is the most likely misuse of this vocabulary. A person who signs in is an identity; the same
person as a party the business holds a relationship with is a customer. One human, two objects, two
vocabularies, and events about them answer different questions.

Where one operation genuinely touches both — closing a customer relationship and disabling the login
that belonged to it — that is two events, one from each vocabulary, joined by
`request.correlationId`.

## 3. What must never be recorded

**The customer record's contents.** Names, addresses, dates of birth, national identifiers, tax
numbers, contact details and anything else the record holds belong in the system of record. An audit
event says that a customer record changed, by whom, under what authorization, and **which fields
moved** — not what they moved to.

`change.changedFields` is the recommended shape for exactly this reason: it names the fields without
carrying the values. Where before and after values genuinely must be recorded — a status transition,
a limit amount — they SHOULD be recorded only for fields that are not personal data. See
[change-model.md](../specification/change-model.md) and
[privacy.md](../specification/privacy.md).

An audit trail is retained for years, is read by people with no business need for a customer's
address, and is frequently exported. It concentrates who-did-what-to-whom, which is what makes it
valuable and what makes it dangerous.

## 4. Which principal goes where

| Operation                                          | `actor`      | `resource`       | `subject`    |
| -------------------------------------------------- | ------------ | ---------------- | ------------ |
| An agent creates a customer record                 | the agent    | the **customer** | absent       |
| A customer updates their own details               | the customer | the **customer** | absent       |
| An agent updates a customer's details for them     | the agent    | the **customer** | the customer |
| An operator freezes an account                     | the operator | the **account**  | absent       |
| An onboarding service opens an account from a form | the service  | the **account**  | absent       |

The customer is the `resource` when the customer record is what changed, and the `subject` only when
the actor acted **on the customer's behalf** — the third row. A customer is not a `subject` merely
because the operation concerns them:
[actor-model.md](../specification/actor-model.md) §5.2 calls that the single most common modelling
mistake the section exists to prevent.

The account a customer owns is a **related resource** on a customer event, and the customer is a
related resource on an account event.

## 5. Restriction and manual override

Freezing an account, restricting a customer and overriding a limit are the operations a reviewer
looks for, because each changes what someone may do without changing the record they would look at
first.

Where the producer distinguishes a manual override from a rule-driven one, the distinction SHOULD
appear in `metadata` and the justification in `reason`. A restriction with no recorded reason is a
finding. Where the producer's policy requires a second principal to agree — closing an account,
lifting a freeze — the decision belongs in `approval`, including when approval was evaluated and
found not to be required.

## 6. Context to populate

| Field                   | Guidance                                                                |
| ----------------------- | ----------------------------------------------------------------------- |
| `authorization`         | The decision that permitted the change                                  |
| `change.changedFields`  | Which fields moved, in preference to before and after values            |
| `approval`              | Where the operation requires a second principal, including not-required |
| `reason`                | Why a restriction, freeze, override or early closure was applied        |
| `relatedResources`      | The accounts a customer holds, or the customer an account belongs to    |
| `metadata.customer`     | The producer's own identifiers, the record's status and its segment     |
| `request.correlationId` | Shared with the identity events that accompany a closure or an opening  |

## 7. Example

See
[examples/profiles/customer-and-account-management/valid/customer-update.json](../examples/profiles/customer-and-account-management/valid/customer-update.json)
for a customer record change with the authorization decision, the fields that moved, and none of the
values that moved into them.
