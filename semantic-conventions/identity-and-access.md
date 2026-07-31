# Identity and Access Events

**Specification version: 0.1 · Status: Experimental**

Category: `identity`

## 1. Recommended event names

### Accounts

| Name                    | Operation                         |
| ----------------------- | --------------------------------- |
| `identity.user.create`  | An account was created            |
| `identity.user.update`  | Account attributes changed        |
| `identity.user.disable` | An account was disabled           |
| `identity.user.enable`  | A disabled account was re-enabled |
| `identity.user.delete`  | An account was deleted            |

### Roles and permissions

| Name                           | Operation                           |
| ------------------------------ | ----------------------------------- |
| `identity.role.create`         | A role was defined                  |
| `identity.role.update`         | A role definition changed           |
| `identity.role.delete`         | A role was removed                  |
| `identity.role.assign`         | A role was granted to a principal   |
| `identity.role.revoke`         | A role was removed from a principal |
| `identity.permission.grant`    | A permission was granted directly   |
| `identity.permission.revoke`   | A permission was removed            |
| `identity.group.member-add`    | A principal joined a group          |
| `identity.group.member-remove` | A principal left a group            |

### Machine identities and sessions

| Name                               | Operation                              |
| ---------------------------------- | -------------------------------------- |
| `identity.service-account.create`  | A machine identity was created         |
| `identity.service-account.disable` | A machine identity was disabled        |
| `identity.credential.rotate`       | A machine credential was replaced      |
| `identity.session.impersonate`     | A principal began acting as another    |
| `identity.delegation.grant`        | Authority was delegated to a principal |
| `identity.delegation.revoke`       | A delegation was withdrawn             |

## 2. Which principal goes where

This is the most error-prone area in the whole model.

| Operation                                  | `actor`           | `resource`             | `subject` |
| ------------------------------------------ | ----------------- | ---------------------- | --------- |
| Administrator assigns a role to a user     | the administrator | the **user**           | absent    |
| User accepts an invitation                 | the user          | the user's own account | absent    |
| Service provisions an account from HR data | the service       | the new account        | absent    |
| Administrator impersonates a user          | the administrator | the session            | the user  |
| Delegated administrator acts for an owner  | the delegate      | the affected resource  | the owner |

The target of an identity operation is a `resource`, not a `subject`. `subject` appears only when
someone's authority was borrowed. See [actor-model.md](../specification/actor-model.md).

The role or permission being granted is a **related resource** or `metadata`, not the primary
resource — the primary resource is what changed, and what changed is the principal's access.

## 3. Context to populate

| Field               | Guidance                                                                |
| ------------------- | ----------------------------------------------------------------------- |
| `relatedResources`  | The role, permission, group or scope involved                           |
| `change`            | `changedFields`, and before/after where the values are safe to record   |
| `authorization`     | The decision that permitted the change                                  |
| `approval`          | Where access requires approval, including `not-required` when evaluated |
| `reason`            | The access request or ticket that justifies the grant                   |
| `metadata`          | `assignedRole`, `assignmentScope`, `effectiveFrom`, `expiresAt`         |
| `controlCategories` | `privileged-access`, `separation-of-duties`, `change-approval`          |

## 4. Privileged grants

An event that grants administrative access SHOULD:

- Set `event.severity` to `high` or `critical`.
- Include `privileged-access` in `controlCategories`.
- Populate `approval` where the operator requires approval for privileged grants.
- Record `metadata.expiresAt` for time-bound grants, so that a reviewer can distinguish standing
  privilege from just-in-time access.

## 5. Effective time

Access changes are often scheduled. `time` is when the **change was recorded**, not when it takes
effect. Where they differ, record the effective window in `metadata`:

```json
{
  "metadata": {
    "assignedRole": "support-agent",
    "effectiveFrom": "2026-03-16T00:00:00Z",
    "expiresAt": "2026-06-16T00:00:00Z"
  }
}
```

A separate event SHOULD be emitted when a time-bound grant actually expires, so that the trail shows
the access ending rather than only the intention that it would.

## 6. Bulk changes

Access changes are frequently bulk operations. Producers SHOULD emit one event per affected principal
where the principals are individually significant — which, for access, they usually are. Where a bulk
operation is recorded as one event, the count and scope MUST be recorded in `metadata`, and the
producer MUST document the choice. See [resource-model.md](../specification/resource-model.md) §6.

## 7. Example

See [examples/valid/user-role-assignment.json](../examples/valid/user-role-assignment.json) for a
complete role assignment with authorization, approval, reason and change context.
