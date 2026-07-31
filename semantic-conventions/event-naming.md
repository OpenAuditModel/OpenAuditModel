# Event Naming

**Specification version: 0.1 · Status: Experimental**

The normative naming rules are in [event-model.md](../specification/event-model.md) §7. This document
gives the recommended vocabularies and the reasoning behind them.

## 1. The shape

```text
domain.resource.action
```

| Segment    | Answers                   | Examples                                 |
| ---------- | ------------------------- | ---------------------------------------- |
| `domain`   | Which area of the system? | `authentication`, `identity`, `document` |
| `resource` | Which kind of thing?      | `role`, `share`, `case`, `setting`       |
| `action`   | What was done to it?      | `assign`, `create`, `close`, `update`    |

Two segments are permitted where a resource segment would be artificial:

```text
authentication.login
authentication.logout
```

Action segments may be hyphenated where the action is genuinely two words:

```text
queue.consumer.offset-reset
identity.credential.self-service-reset
```

## 2. Recommended categories

`event.category` groups names for filtering and routing. It is an open vocabulary; these values cover
the domains this model targets:

| Category               | Covers                                                   |
| ---------------------- | -------------------------------------------------------- |
| `authentication`       | Proving identity, sessions, factors, credentials         |
| `identity`             | Accounts, roles, permissions, service accounts           |
| `data-access`          | Reading, exporting, sharing, downloading                 |
| `data-modification`    | Creating, updating, deleting business data               |
| `configuration`        | Application and platform settings, secrets               |
| `deployment`           | Releases, rollouts, rollbacks                            |
| `workflow`             | Requests, approvals, case and incident lifecycle         |
| `privileged-operation` | Administrative and break-glass operations                |
| `data-infrastructure`  | Brokers, topics, queues, caches, database administration |
| `security`             | Security-relevant events that fit no other category      |
| `resource-lifecycle`   | Provisioning and decommissioning of resources            |

A category is a coarse label. When an event fits two, choose the one a reviewer would filter on.

## 3. Recommended activity types

`event.type` is an OPTIONAL, domain-independent classifier. It exists so that a consumer can ask
"show me every deletion" without knowing every domain's vocabulary.

```text
create   read     update   delete    execute
approve  reject   share    grant     revoke
login    logout   export   import    rotate
```

`event.type` never replaces `event.name`. `identity.role.revoke` and `document.permission.revoke` are
different operations that share `type: revoke`.

## 4. Rules, restated

1. **Stable.** A published name keeps its meaning. If the meaning changes, the name changes.
2. **No product names.** `document.share.create`, not `sharepointish.share.create`.
3. **No company names.** The audit trail outlives the vendor relationship.
4. **No jurisdiction names.** `data.export.create`, not `data.export.create-eu`.
5. **Describe the operation, not the mechanism.** `identity.role.assign` is right whether the role was
   assigned through a console, an API, a sync job or a script. Names that encode the mechanism
   fragment the trail and break when the mechanism changes.
6. **Same name for success and failure.** Use `outcome`, not a different name.

## 5. The failure-name anti-pattern

This is the most common naming mistake, and it is worth stating twice:

```text
authentication.login          outcome: success     ← RECOMMENDED
authentication.login          outcome: failure     ← RECOMMENDED

authentication.login-success                        ← NOT RECOMMENDED
authentication.login-failed                         ← NOT RECOMMENDED
```

Encoding the outcome in the name doubles the vocabulary, makes "how often does this operation fail?"
a string-matching problem, and guarantees that some operations get a failure name and others do not.

## 6. Granularity

Prefer the granularity a reviewer would ask about.

| Too coarse            | Too fine                                        | Recommended                    |
| --------------------- | ----------------------------------------------- | ------------------------------ |
| `document.update`     | `document.metadata.title.update`                | `document.version.create`      |
| `identity.change`     | `identity.role.assign.via-bulk-import`          | `identity.role.assign`         |
| `configuration.write` | `configuration.setting.session-lifetime.update` | `configuration.setting.update` |

Detail that varies per operation belongs in `resource`, `change.changedFields` and `metadata`, not in
the name. A name is a category; a category with one member is not a category.

## 7. Naming new events

1. Find the closest existing convention document and follow its pattern.
2. Use the resource type you already use in `resource.type` as the resource segment where possible.
3. Use a verb in the imperative for the action: `assign`, not `assigned` or `assignment`.
4. Check the name does not encode outcome, mechanism, product, company or jurisdiction.
5. Check that a reviewer who has never seen your system can guess what it means.
