# What the profiles require

**Generated — do not edit.** Produced by [`conformance/tools/generate-requirements.ts`](../conformance/tools/generate-requirements.ts)
from the ten profile documents, and checked by `npm run verify`. Edit a profile, not this file.

**Status: informative.** The normative statements are in the profile documents and in
[specification/](../specification/). This is those documents read from the other side: not "what does
this profile say" but "I record this operation — what does the model want from it?"

Nothing here is a compliance requirement. See [README.md](README.md) §What profiles are not.

10 profiles, 127 rules, 185 selectors.

## How to use this

1. Find the operation you record in §1. If no row matches, no profile governs it today —
   which is reported as `not-applicable`, and is not conformance. Check the event naming
   convention first: a name no profile selects is often a name shaped differently from the
   convention, not an operation no profile covers.
2. Read what its rules require in §2, under the profile that governs it.
3. Check yourself with the tooling rather than by reading:

```bash
npx @openauditmodel/cli validate events.ndjson
npx @openauditmodel/cli lint-privacy events.ndjson
npx @openauditmodel/cli check-profile events.ndjson --profile <name>
npx @openauditmodel/cli check-coverage events.ndjson --profile <name>
```

`check-coverage` answers the question this document answers statically, against your own events.

## 1. Every event name a profile selects

A name ending in `*` is a prefix: the rules listed govern every name beneath it.

| Event name | Profile | Rules |
| ---------- | ------- | ----- |
| `account.close` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-ACCOUNT-001, CUSTOMER-CONTROL-001, CUSTOMER-STATE-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `account.freeze` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-ACCOUNT-001, CUSTOMER-CONTROL-001, CUSTOMER-STATE-001, CUSTOMER-RESTRICT-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `account.limit.*` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-ACCOUNT-001, CUSTOMER-CONTROL-001, CUSTOMER-LIMIT-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `account.open` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-ACCOUNT-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `account.reopen` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-ACCOUNT-001, CUSTOMER-CONTROL-001, CUSTOMER-STATE-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `account.restrict` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-ACCOUNT-001, CUSTOMER-CONTROL-001, CUSTOMER-STATE-001, CUSTOMER-RESTRICT-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `account.status.*` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-ACCOUNT-001, CUSTOMER-CONTROL-001, CUSTOMER-STATE-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `account.unfreeze` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-ACCOUNT-001, CUSTOMER-CONTROL-001, CUSTOMER-STATE-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `account.update` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-ACCOUNT-001, CUSTOMER-UPDATE-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `api-key.create` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-AUTHN-001, INTEGRATION-AUTHN-002, INTEGRATION-KEY-001, INTEGRATION-KEY-002 (warning), INTEGRATION-FAIL-001 |
| `api-key.delete` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-AUTHN-001, INTEGRATION-AUTHN-002, INTEGRATION-KEY-001, INTEGRATION-REVOKE-001, INTEGRATION-FAIL-001 |
| `api-key.revoke` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-AUTHN-001, INTEGRATION-AUTHN-002, INTEGRATION-KEY-001, INTEGRATION-REVOKE-001, INTEGRATION-FAIL-001 |
| `api-key.rotate` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-AUTHN-001, INTEGRATION-AUTHN-002, INTEGRATION-KEY-001, INTEGRATION-KEY-002 (warning), INTEGRATION-FAIL-001 |
| `backup.complete` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-SET-001, BACKUP-SET-002 |
| `backup.create` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-SET-001 |
| `backup.delete` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-SET-001, BACKUP-DELETE-001, BACKUP-APPROVAL-001 |
| `backup.expire` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-SET-001, BACKUP-EXPIRE-001 |
| `backup.policy.*` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-POLICY-001 |
| `backup.verify` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-SET-001, BACKUP-VERIFY-001 |
| `broker.acl.grant` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001, BROKER-ACL-001 |
| `broker.acl.revoke` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001, BROKER-ACL-001 |
| `broker.cluster.create` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.cluster.delete` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.cluster.failover` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.cluster.scale` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.cluster.upgrade` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.configuration.update` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001 |
| `broker.consumer-group.create` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.consumer-group.delete` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.consumer-group.update` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001 |
| `broker.exchange.create` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-LIFECYCLE-001 |
| `broker.exchange.delete` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.exchange.update` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001 |
| `broker.message.replay` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-REPLAY-001 |
| `broker.offset.reset` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001, BROKER-OFFSET-001 |
| `broker.permission.grant` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001, BROKER-ACL-001 |
| `broker.permission.revoke` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001, BROKER-ACL-001 |
| `broker.queue.create` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-LIFECYCLE-001 |
| `broker.queue.delete` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.queue.purge` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.queue.update` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001 |
| `broker.quota.create` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001, BROKER-QUOTA-001 |
| `broker.quota.delete` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001, BROKER-QUOTA-001 |
| `broker.quota.update` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001, BROKER-QUOTA-001 |
| `broker.stream.create` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-LIFECYCLE-001 |
| `broker.stream.delete` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.stream.trim` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.stream.update` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001 |
| `broker.topic.create` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-LIFECYCLE-001 |
| `broker.topic.delete` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001 |
| `broker.topic.update` | message-broker-management | BROKER-CORE-001, BROKER-CORE-002 (warning), BROKER-RISK-001, BROKER-RISK-002, BROKER-RISK-003, BROKER-FAIL-001, BROKER-CHANGE-001 |
| `certificate.delete` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-DESTROY-001, SECRET-APPROVAL-001 |
| `certificate.issue` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-LIFECYCLE-001, SECRET-APPROVAL-001, SECRET-CERT-001 |
| `certificate.renew` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-ROTATE-001, SECRET-APPROVAL-001, SECRET-CERT-001 |
| `certificate.revoke` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-DESTROY-001, SECRET-APPROVAL-001 |
| `change.request.approve` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-APPROVAL-001, DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002 |
| `change.request.cancel` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002 |
| `change.request.close` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002 |
| `change.request.create` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002 |
| `change.request.reject` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-APPROVAL-001, DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002 |
| `configuration.feature.toggle` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-CONFIG-001, DEPLOY-APPROVAL-002, DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002, DEPLOY-AUTOMATION-001 (warning) |
| `configuration.policy.update` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-CONFIG-001, DEPLOY-APPROVAL-002, DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002, DEPLOY-AUTOMATION-001 (warning) |
| `configuration.retention.update` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-CONFIG-001, DEPLOY-APPROVAL-002, DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002, DEPLOY-AUTOMATION-001 (warning) |
| `configuration.secret.rotate` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-CONFIG-001, DEPLOY-APPROVAL-002, DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002, DEPLOY-AUTOMATION-001 (warning) |
| `configuration.setting.create` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-CONFIG-001, DEPLOY-APPROVAL-002, DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002, DEPLOY-AUTOMATION-001 (warning) |
| `configuration.setting.delete` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-CONFIG-001, DEPLOY-APPROVAL-002, DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002, DEPLOY-AUTOMATION-001 (warning) |
| `configuration.setting.update` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-CONFIG-001, DEPLOY-APPROVAL-002, DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002, DEPLOY-AUTOMATION-001 (warning) |
| `corrective-action.close` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-STATE-002, INC-CLOSE-001, INC-EVIDENCE-001 (warning) |
| `corrective-action.open` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-ASSIGN-001, INC-EVIDENCE-001 (warning) |
| `corrective-action.verify` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-CAPA-001, INC-EVIDENCE-001 (warning) |
| `customer.close` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-CONTROL-001, CUSTOMER-STATE-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `customer.create` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `customer.delete` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-CONTROL-001, CUSTOMER-DELETE-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `customer.merge` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-CONTROL-001, CUSTOMER-MERGE-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `customer.restore` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-CONTROL-001, CUSTOMER-STATE-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `customer.restrict` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-CONTROL-001, CUSTOMER-STATE-001, CUSTOMER-RESTRICT-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `customer.update` | customer-and-account-management | CUSTOMER-CORE-001, CUSTOMER-CORE-002 (warning), CUSTOMER-UPDATE-001, CUSTOMER-APPROVAL-001, CUSTOMER-SUBJECT-001, CUSTOMER-OVERRIDE-001 |
| `deployment.infrastructure.*` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-RELEASE-001, DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002 |
| `deployment.infrastructure.apply` | deployment-and-change-management | DEPLOY-RELEASE-002, DEPLOY-APPROVAL-002, DEPLOY-AUTOMATION-001 (warning) |
| `deployment.release.*` | deployment-and-change-management | DEPLOY-CORE-001, DEPLOY-CORE-002, DEPLOY-CORE-003 (warning), DEPLOY-RELEASE-001, DEPLOY-EMERGENCY-001, DEPLOY-FAILURE-001, DEPLOY-FAILURE-002 |
| `deployment.release.approve` | deployment-and-change-management | DEPLOY-APPROVAL-001 |
| `deployment.release.cancel` | deployment-and-change-management | DEPLOY-REVERT-001, DEPLOY-APPROVAL-002, DEPLOY-AUTOMATION-001 (warning) |
| `deployment.release.deploy` | deployment-and-change-management | DEPLOY-RELEASE-002, DEPLOY-APPROVAL-002, DEPLOY-AUTOMATION-001 (warning) |
| `deployment.release.promote` | deployment-and-change-management | DEPLOY-RELEASE-002, DEPLOY-APPROVAL-002, DEPLOY-AUTOMATION-001 (warning) |
| `deployment.release.rollback` | deployment-and-change-management | DEPLOY-RELEASE-002, DEPLOY-REVERT-001, DEPLOY-APPROVAL-002, DEPLOY-AUTOMATION-001 (warning) |
| `document.file.delete` | document-management | DOC-CORE-001, DOC-CORE-002 (warning), DOC-DELETE-001 |
| `document.file.download` | document-management | DOC-CORE-001, DOC-CORE-002 (warning) |
| `document.file.upload` | document-management | DOC-CORE-001, DOC-CORE-002 (warning) |
| `document.legal-hold.*` | document-management | DOC-CORE-001, DOC-CORE-002 (warning), DOC-HOLD-001 |
| `document.permission.*` | document-management | DOC-CORE-001, DOC-CORE-002 (warning), DOC-PERM-001 |
| `document.retention.*` | document-management | DOC-CORE-001, DOC-CORE-002 (warning), DOC-RETENTION-001 |
| `document.share.*` | document-management | DOC-CORE-001, DOC-CORE-002 (warning), DOC-SHARE-001 |
| `document.share.create` | document-management | DOC-SHARE-002, DOC-SHARE-003 |
| `document.version.*` | document-management | DOC-CORE-001, DOC-CORE-002 (warning), DOC-VERSION-001 |
| `document.version.rollback` | document-management | DOC-VERSION-002 |
| `financial.chargeback.*` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-TXN-001, FIN-TXN-002, FIN-REASON-001, FIN-REVERSAL-001, FIN-APPROVAL-001, FIN-MANUAL-001 |
| `financial.deposit.*` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-TXN-001, FIN-TXN-002, FIN-APPROVAL-001, FIN-MANUAL-001 |
| `financial.limit.create` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-APPROVAL-001, FIN-MANUAL-001, FIN-LIMIT-001 |
| `financial.limit.delete` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-APPROVAL-001, FIN-MANUAL-001, FIN-LIMIT-001 |
| `financial.limit.update` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-APPROVAL-001, FIN-MANUAL-001, FIN-LIMIT-001 |
| `financial.payment.*` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-TXN-001, FIN-TXN-002, FIN-APPROVAL-001, FIN-MANUAL-001 |
| `financial.payment.cancel` | financial-transaction-management | FIN-REASON-001 |
| `financial.payment.reject` | financial-transaction-management | FIN-REASON-001 |
| `financial.payout.*` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-TXN-001, FIN-TXN-002, FIN-APPROVAL-001, FIN-MANUAL-001 |
| `financial.payout.cancel` | financial-transaction-management | FIN-REASON-001 |
| `financial.reconciliation.*` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-APPROVAL-001, FIN-MANUAL-001, FIN-RECON-001 |
| `financial.reconciliation.adjust` | financial-transaction-management | FIN-RECON-002 |
| `financial.refund.*` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-TXN-001, FIN-TXN-002, FIN-APPROVAL-001, FIN-MANUAL-001 |
| `financial.refund.create` | financial-transaction-management | FIN-REASON-001 |
| `financial.reversal.*` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-TXN-001, FIN-TXN-002, FIN-REASON-001, FIN-REVERSAL-001, FIN-APPROVAL-001, FIN-MANUAL-001 |
| `financial.settlement.*` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-TXN-001, FIN-TXN-002, FIN-LINK-001, FIN-APPROVAL-001, FIN-MANUAL-001 |
| `financial.settlement.cancel` | financial-transaction-management | FIN-REASON-001 |
| `financial.transfer.*` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-TXN-001, FIN-TXN-002, FIN-LINK-001, FIN-APPROVAL-001, FIN-MANUAL-001 |
| `financial.transfer.cancel` | financial-transaction-management | FIN-REASON-001 |
| `financial.withdrawal.*` | financial-transaction-management | FIN-CORE-001, FIN-CORE-002 (warning), FIN-TXN-001, FIN-TXN-002, FIN-APPROVAL-001, FIN-MANUAL-001 |
| `financial.withdrawal.reject` | financial-transaction-management | FIN-REASON-001 |
| `identity.*` | identity-and-access-management | IAM-CORE-001, IAM-CORE-002 |
| `identity.credential.rotate` | identity-and-access-management | IAM-CRED-001 |
| `identity.permission.*` | identity-and-access-management | IAM-PERM-001, IAM-PERM-002 |
| `identity.role.assign` | identity-and-access-management | IAM-ROLE-001, IAM-ROLE-002 |
| `identity.role.revoke` | identity-and-access-management | IAM-ROLE-001, IAM-ROLE-002 |
| `identity.service-account.create` | identity-and-access-management | IAM-SVC-001, IAM-SVC-002 |
| `identity.service-account.disable` | identity-and-access-management | IAM-SVC-001 |
| `identity.user.create` | identity-and-access-management | IAM-USER-001 |
| `identity.user.delete` | identity-and-access-management | IAM-USER-001, IAM-USER-002 |
| `identity.user.disable` | identity-and-access-management | IAM-USER-001, IAM-USER-002 |
| `incident.assignment.change` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-ASSIGN-001 |
| `incident.cancel` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-STATE-002, INC-CLOSE-001 |
| `incident.case.cancel` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-STATE-002, INC-CLOSE-001 |
| `incident.case.close` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-STATE-002, INC-CLOSE-001 |
| `incident.case.create` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-CREATE-001 (warning), INC-PRIORITY-001 |
| `incident.case.reopen` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-REOPEN-001 |
| `incident.case.resolve` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-RESOLVE-001 |
| `incident.close` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-STATE-002, INC-CLOSE-001 |
| `incident.create` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-CREATE-001 (warning), INC-PRIORITY-001 |
| `incident.major.declare` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-STATE-002, INC-PRIORITY-001 |
| `incident.priority.change` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-STATE-002, INC-PRIORITY-001 |
| `incident.rca.approve` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-RCA-001, INC-RCA-002, INC-EVIDENCE-001 (warning) |
| `incident.rca.create` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-RCA-001, INC-EVIDENCE-001 (warning) |
| `incident.rca.update` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-RCA-001, INC-EVIDENCE-001 (warning) |
| `incident.reopen` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-REOPEN-001 |
| `incident.resolve` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-RESOLVE-001 |
| `incident.sla.breach` | incident-management | INC-CORE-002 (warning), INC-PRIORITY-001, INC-SLA-001 |
| `integration.configuration.*` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-CONFIG-001, INTEGRATION-CONN-001, INTEGRATION-FAIL-001 |
| `integration.connect` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-AUTHN-001, INTEGRATION-AUTHN-002, INTEGRATION-CONN-001, INTEGRATION-FLOW-001, INTEGRATION-FAIL-001 |
| `integration.disable` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-REVOKE-001, INTEGRATION-CONN-001, INTEGRATION-FAIL-001 |
| `integration.disconnect` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-AUTHN-001, INTEGRATION-AUTHN-002, INTEGRATION-REVOKE-001, INTEGRATION-CONN-001, INTEGRATION-FAIL-001 |
| `integration.enable` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-CONN-001, INTEGRATION-FAIL-001 |
| `integration.reauthorize` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-AUTHN-001, INTEGRATION-AUTHN-002, INTEGRATION-CONN-001, INTEGRATION-FLOW-001, INTEGRATION-FAIL-001 |
| `integration.sync.cancel` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-REVOKE-001, INTEGRATION-CONN-001, INTEGRATION-FLOW-001, INTEGRATION-FAIL-001 |
| `integration.sync.start` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-CONN-001, INTEGRATION-FLOW-001, INTEGRATION-FAIL-001 |
| `key.destroy` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-DESTROY-001, SECRET-APPROVAL-001 |
| `key.disable` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-DESTROY-001, SECRET-APPROVAL-001 |
| `key.enable` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-APPROVAL-001 |
| `key.export` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-ACCESS-001, SECRET-ACCESS-002, SECRET-EXPORT-001, SECRET-APPROVAL-001 |
| `key.generate` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-LIFECYCLE-001, SECRET-APPROVAL-001, SECRET-KEY-002 (warning) |
| `key.import` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-LIFECYCLE-001, SECRET-APPROVAL-001, SECRET-KEY-001, SECRET-KEY-002 (warning) |
| `key.policy.*` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-APPROVAL-001, SECRET-POLICY-001 |
| `key.rotate` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-ROTATE-001, SECRET-APPROVAL-001, SECRET-KEY-002 (warning) |
| `problem.case.close` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-STATE-002, INC-CLOSE-001 |
| `problem.case.create` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-CREATE-001 (warning), INC-PRIORITY-001 |
| `problem.close` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-STATE-001, INC-STATE-002, INC-CLOSE-001 |
| `problem.create` | incident-management | INC-CORE-001, INC-CORE-002 (warning), INC-CREATE-001 (warning), INC-PRIORITY-001 |
| `recovery.complete` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-RECOVERY-001 |
| `recovery.failback` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-RECOVERY-001, BACKUP-FAILOVER-001, BACKUP-APPROVAL-001 |
| `recovery.failover` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-RECOVERY-001, BACKUP-FAILOVER-001, BACKUP-APPROVAL-001 |
| `recovery.start` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-RECOVERY-001 |
| `restore.complete` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-RESTORE-001 |
| `restore.start` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-RESTORE-001, BACKUP-APPROVAL-001 |
| `secret.create` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-LIFECYCLE-001, SECRET-APPROVAL-001 |
| `secret.delete` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-DESTROY-001, SECRET-APPROVAL-001 |
| `secret.export` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-ACCESS-001, SECRET-ACCESS-002, SECRET-EXPORT-001, SECRET-APPROVAL-001 |
| `secret.policy.*` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-APPROVAL-001, SECRET-POLICY-001 |
| `secret.reveal` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-ACCESS-001, SECRET-ACCESS-002, SECRET-APPROVAL-001 |
| `secret.revoke` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-DESTROY-001, SECRET-APPROVAL-001 |
| `secret.rotate` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-ROTATE-001, SECRET-APPROVAL-001 |
| `secret.update` | secrets-and-key-management | SECRET-CORE-001, SECRET-CORE-002, SECRET-CORE-003 (warning), SECRET-APPROVAL-001 |
| `snapshot.create` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-SNAPSHOT-001 |
| `snapshot.delete` | backup-and-recovery | BACKUP-CORE-001, BACKUP-CORE-002 (warning), BACKUP-DELETE-001, BACKUP-SNAPSHOT-001, BACKUP-APPROVAL-001 |
| `webhook.create` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-HOOK-001, INTEGRATION-FAIL-001 |
| `webhook.delete` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-REVOKE-001, INTEGRATION-HOOK-001, INTEGRATION-FAIL-001 |
| `webhook.disable` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-REVOKE-001, INTEGRATION-HOOK-001, INTEGRATION-FAIL-001 |
| `webhook.enable` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-HOOK-001, INTEGRATION-FAIL-001 |
| `webhook.test` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-HOOK-001, INTEGRATION-FAIL-001 |
| `webhook.update` | api-and-integration-management | INTEGRATION-CORE-001, INTEGRATION-CORE-002 (warning), INTEGRATION-CORE-003, INTEGRATION-HOOK-001, INTEGRATION-CONFIG-001, INTEGRATION-FAIL-001 |

## 2. What each rule requires

### api-and-integration-management 0.2

Additional conformance requirements for the administration of API credentials, webhook subscriptions and third-party integrations: issuing and revoking API keys, creating and reconfiguring webhooks, connecting, reauthorizing and disconnecting external systems, and starting or cancelling integration syncs. Every requirement adds to the OpenAuditModel Core Specification; none relaxes it. Data-plane traffic is deliberately not governed: ordinary API requests, webhook deliveries and routine integration polling match no rule in this profile.

| Rule | Applies to | Requires | Recommends |
| ---- | ---------- | -------- | ---------- |
| INTEGRATION-CORE-001 | `api-key.create`, `api-key.rotate`, `api-key.revoke`, `api-key.delete`, `webhook.create`, `webhook.update`, `webhook.enable`, `webhook.disable`, `webhook.delete`, `webhook.test`, `integration.connect`, `integration.disconnect`, `integration.enable`, `integration.disable`, `integration.reauthorize`, `integration.sync.start`, `integration.sync.cancel`, `integration.configuration.*` | `/authorization`, `/metadata/integration/type (string)` | — |
| INTEGRATION-CORE-002 (warning) | `api-key.create`, `api-key.rotate`, `api-key.revoke`, `api-key.delete`, `webhook.create`, `webhook.update`, `webhook.enable`, `webhook.disable`, `webhook.delete`, `webhook.test`, `integration.connect`, `integration.disconnect`, `integration.enable`, `integration.disable`, `integration.reauthorize`, `integration.sync.start`, `integration.sync.cancel`, `integration.configuration.*` | — | `/reason`, `/approval`, `/request/correlationId`, `/metadata/integration/provider` |
| INTEGRATION-CORE-003 | `api-key.create`, `api-key.rotate`, `api-key.revoke`, `api-key.delete`, `webhook.create`, `webhook.update`, `webhook.enable`, `webhook.disable`, `webhook.delete`, `webhook.test`, `integration.connect`, `integration.disconnect`, `integration.enable`, `integration.disable`, `integration.reauthorize`, `integration.sync.start`, `integration.sync.cancel`, `integration.configuration.*`<br>only when /metadata/integration/approvalRequired = true | `/approval`, `/approval/status` | — |
| INTEGRATION-AUTHN-001 | `api-key.create`, `api-key.rotate`, `api-key.revoke`, `api-key.delete`, `integration.connect`, `integration.reauthorize`, `integration.disconnect`<br>only when /actor/type = "user" | `/authentication` | — |
| INTEGRATION-AUTHN-002 | `api-key.create`, `api-key.rotate`, `api-key.revoke`, `api-key.delete`, `integration.connect`, `integration.reauthorize`, `integration.disconnect`<br>only when /actor/type = "admin" | `/authentication` | — |
| INTEGRATION-KEY-001 | `api-key.create`, `api-key.rotate`, `api-key.revoke`, `api-key.delete` | `/metadata/integration/credentialReference (string)` | — |
| INTEGRATION-KEY-002 (warning) | `api-key.create`, `api-key.rotate` | — | `/metadata/integration/scope`, `/metadata/integration/expiresAt`, `/resource/ownerId` |
| INTEGRATION-REVOKE-001 | `api-key.revoke`, `api-key.delete`, `webhook.disable`, `webhook.delete`, `integration.disconnect`, `integration.disable`, `integration.sync.cancel` | `/reason` | — |
| INTEGRATION-HOOK-001 | `webhook.create`, `webhook.update`, `webhook.enable`, `webhook.disable`, `webhook.delete`, `webhook.test` | `/metadata/integration/webhookId (string)`, `/metadata/integration/endpointClass (string)` | — |
| INTEGRATION-CONFIG-001 | `webhook.update`, `integration.configuration.*` | `/change` | `/change/changedFields` |
| INTEGRATION-CONN-001 | `integration.connect`, `integration.disconnect`, `integration.enable`, `integration.disable`, `integration.reauthorize`, `integration.sync.start`, `integration.sync.cancel`, `integration.configuration.*` | `/metadata/integration/connectionId (string)`, `/metadata/integration/provider (string)` | — |
| INTEGRATION-FLOW-001 | `integration.connect`, `integration.reauthorize`, `integration.sync.start`, `integration.sync.cancel` | `/request/correlationId` | — |
| INTEGRATION-FAIL-001 | `api-key.create`, `api-key.rotate`, `api-key.revoke`, `api-key.delete`, `webhook.create`, `webhook.update`, `webhook.enable`, `webhook.disable`, `webhook.delete`, `webhook.test`, `integration.connect`, `integration.disconnect`, `integration.enable`, `integration.disable`, `integration.reauthorize`, `integration.sync.start`, `integration.sync.cancel`, `integration.configuration.*`<br>only when /event/outcome = "failure" | `/event/error/type` | — |

### backup-and-recovery 0.2

Additional conformance requirements for backup, snapshot, restore, recovery and failover audit events: creating and verifying recovery points, deleting and expiring them, restoring data, moving service between sites, and changing the policy that decides what is protected. Every requirement adds to the OpenAuditModel Core Specification; none relaxes it. Data-plane events such as chunk writes, progress reports and replication heartbeats are deliberately not governed.

| Rule | Applies to | Requires | Recommends |
| ---- | ---------- | -------- | ---------- |
| BACKUP-CORE-001 | `backup.create`, `backup.complete`, `backup.verify`, `backup.delete`, `backup.expire`, `snapshot.create`, `snapshot.delete`, `restore.start`, `restore.complete`, `recovery.start`, `recovery.complete`, `recovery.failover`, `recovery.failback`, `backup.policy.*` | `/authorization` | — |
| BACKUP-CORE-002 (warning) | `backup.create`, `backup.complete`, `backup.verify`, `backup.delete`, `backup.expire`, `snapshot.create`, `snapshot.delete`, `restore.start`, `restore.complete`, `recovery.start`, `recovery.complete`, `recovery.failover`, `recovery.failback`, `backup.policy.*` | — | `/reason`, `/request/correlationId` |
| BACKUP-SET-001 | `backup.create`, `backup.complete`, `backup.verify`, `backup.delete`, `backup.expire` | `/metadata/backup/backupId (string)`, `/metadata/backup/backupType (string)` | `/metadata/backup/retentionClass` |
| BACKUP-SET-002 | `backup.complete`<br>only when /event/outcome = "success" | `/metadata/backup/recoveryPoint (string)` | `/metadata/backup/retentionClass` |
| BACKUP-VERIFY-001 | `backup.verify` | `/metadata/backup/verificationStatus (string)` | `/evidence`, `/metadata/backup/recoveryPoint` |
| BACKUP-DELETE-001 | `backup.delete`, `snapshot.delete` | `/reason` | `/approval`, `/metadata/backup/retentionClass` |
| BACKUP-EXPIRE-001 | `backup.expire` | `/metadata/backup/retentionClass (string)` | — |
| BACKUP-SNAPSHOT-001 | `snapshot.create`, `snapshot.delete` | `/metadata/backup/snapshotId (string)` | `/metadata/backup/recoveryPoint`, `/metadata/backup/retentionClass` |
| BACKUP-RESTORE-001 | `restore.start`, `restore.complete` | `/reason`, `/metadata/backup/restoreId (string)`, `/metadata/backup/sourceId (string)`, `/metadata/backup/recoveryPoint (string)` | `/approval`, `/request/correlationId` |
| BACKUP-RECOVERY-001 | `recovery.start`, `recovery.complete`, `recovery.failover`, `recovery.failback` | `/metadata/backup/recoveryId (string)` | `/request/correlationId`, `/metadata/backup/recoveryPoint` |
| BACKUP-FAILOVER-001 | `recovery.failover`, `recovery.failback` | `/reason`, `/metadata/backup/targetScope (string)` | `/approval`, `/request/correlationId` |
| BACKUP-APPROVAL-001 | `backup.delete`, `snapshot.delete`, `restore.start`, `recovery.failover`, `recovery.failback`<br>only when /metadata/backup/approvalRequired = true | `/approval` | — |
| BACKUP-POLICY-001 | `backup.policy.*` | `/change`, `/reason`, `/metadata/backup/policyId (string)` | `/approval`, `/metadata/backup/retentionClass` |

### customer-and-account-management 0.2

Additional conformance requirements for material customer and business-account lifecycle audit events: customer record creation, update, merge, restriction, closure and deletion, and account opening, update, status transition, limit change, freeze, restriction and closure. Every requirement adds to the OpenAuditModel Core Specification; none relaxes it. This profile governs business parties and business accounts; identities, authentication and access rights are governed by the identity-and-access-management profile. High-volume read events such as customer.profile.view, customer.search and account.balance.view are deliberately not governed.

| Rule | Applies to | Requires | Recommends |
| ---- | ---------- | -------- | ---------- |
| CUSTOMER-CORE-001 | `customer.create`, `customer.update`, `customer.merge`, `customer.close`, `customer.delete`, `customer.restrict`, `customer.restore`, `account.open`, `account.update`, `account.close`, `account.reopen`, `account.freeze`, `account.unfreeze`, `account.restrict`, `account.limit.*`, `account.status.*` | `/metadata/customer/customerType (string)` | — |
| CUSTOMER-CORE-002 (warning) | `customer.create`, `customer.update`, `customer.merge`, `customer.close`, `customer.delete`, `customer.restrict`, `customer.restore`, `account.open`, `account.update`, `account.close`, `account.reopen`, `account.freeze`, `account.unfreeze`, `account.restrict`, `account.limit.*`, `account.status.*` | — | `/reason`, `/request/correlationId`, `/resource/classification` |
| CUSTOMER-ACCOUNT-001 | `account.open`, `account.update`, `account.close`, `account.reopen`, `account.freeze`, `account.unfreeze`, `account.restrict`, `account.limit.*`, `account.status.*` | `/resource/ownerId`, `/metadata/customer/accountType (string)` | — |
| CUSTOMER-CONTROL-001 | `customer.merge`, `customer.close`, `customer.delete`, `customer.restrict`, `customer.restore`, `account.close`, `account.reopen`, `account.freeze`, `account.unfreeze`, `account.restrict`, `account.limit.*`, `account.status.*` | `/authorization`, `/reason` | `/approval` |
| CUSTOMER-UPDATE-001 | `customer.update`, `account.update` | `/change` | `/change/changedFields` |
| CUSTOMER-STATE-001 | `customer.close`, `customer.restrict`, `customer.restore`, `account.close`, `account.reopen`, `account.freeze`, `account.unfreeze`, `account.restrict`, `account.status.*` | `/change`, `/metadata/customer/status (string)` | — |
| CUSTOMER-RESTRICT-001 | `customer.restrict`, `account.restrict`, `account.freeze` | `/metadata/customer/restrictionScope (string)` | `/approval`, `/metadata/customer/reviewId` |
| CUSTOMER-LIMIT-001 | `account.limit.*` | `/change/before`, `/change/after`, `/metadata/customer/limitType (string)` | — |
| CUSTOMER-MERGE-001 | `customer.merge` | `/relatedResources`, `/metadata/customer/mergedFromId (string)` | — |
| CUSTOMER-DELETE-001 | `customer.delete` | `/metadata/customer/deletionScope (string)` | `/approval`, `/privacy` |
| CUSTOMER-APPROVAL-001 | `customer.create`, `customer.update`, `customer.merge`, `customer.close`, `customer.delete`, `customer.restrict`, `customer.restore`, `account.open`, `account.update`, `account.close`, `account.reopen`, `account.freeze`, `account.unfreeze`, `account.restrict`, `account.limit.*`, `account.status.*`<br>only when /metadata/customer/approvalRequired = true | `/approval/status` | — |
| CUSTOMER-SUBJECT-001 | `customer.create`, `customer.update`, `customer.merge`, `customer.close`, `customer.delete`, `customer.restrict`, `customer.restore`, `account.open`, `account.update`, `account.close`, `account.reopen`, `account.freeze`, `account.unfreeze`, `account.restrict`, `account.limit.*`, `account.status.*`<br>only when /metadata/customer/onBehalfOf = true | `/subject` | — |
| CUSTOMER-OVERRIDE-001 | `customer.create`, `customer.update`, `customer.merge`, `customer.close`, `customer.delete`, `customer.restrict`, `customer.restore`, `account.open`, `account.update`, `account.close`, `account.reopen`, `account.freeze`, `account.unfreeze`, `account.restrict`, `account.limit.*`, `account.status.*`<br>only when /metadata/customer/manualOverride = true | `/authorization`, `/reason` | — |

### deployment-and-change-management 0.2

Additional conformance requirements for audit events that describe material change to a running system: releases, deployments, promotions, rollbacks, cancellations, infrastructure application, configuration and secret changes, and change requests. Every requirement adds to the OpenAuditModel Core Specification; none relaxes it. The profile supports fully automated continuous delivery as well as human-gated release: it never decides which change needs approval, it requires the producer to record whether one was required. Routine pipeline telemetry such as polling, build log output and secret reads is deliberately not governed.

| Rule | Applies to | Requires | Recommends |
| ---- | ---------- | -------- | ---------- |
| DEPLOY-CORE-001 | `change.request.approve`, `change.request.cancel`, `change.request.close`, `change.request.create`, `change.request.reject`, `configuration.feature.toggle`, `configuration.policy.update`, `configuration.retention.update`, `configuration.secret.rotate`, `configuration.setting.create`, `configuration.setting.delete`, `configuration.setting.update`, `deployment.release.*`, `deployment.infrastructure.*` | `/metadata/deployment/id (string)`, `/metadata/deployment/environment (string)` | — |
| DEPLOY-CORE-002 | `change.request.approve`, `change.request.cancel`, `change.request.close`, `change.request.create`, `change.request.reject`, `configuration.feature.toggle`, `configuration.policy.update`, `configuration.retention.update`, `configuration.secret.rotate`, `configuration.setting.create`, `configuration.setting.delete`, `configuration.setting.update`, `deployment.release.*`, `deployment.infrastructure.*` | `/metadata/deployment/approvalRequired (boolean)` | — |
| DEPLOY-CORE-003 (warning) | `change.request.approve`, `change.request.cancel`, `change.request.close`, `change.request.create`, `change.request.reject`, `configuration.feature.toggle`, `configuration.policy.update`, `configuration.retention.update`, `configuration.secret.rotate`, `configuration.setting.create`, `configuration.setting.delete`, `configuration.setting.update`, `deployment.release.*`, `deployment.infrastructure.*` | — | `/reason`, `/request/correlationId`, `/metadata/deployment/pipelineId` |
| DEPLOY-RELEASE-001 | `deployment.release.*`, `deployment.infrastructure.*` | `/metadata/deployment/version (string)` | `/relatedResources`, `/change/deploymentId` |
| DEPLOY-RELEASE-002 | `deployment.release.deploy`, `deployment.release.promote`, `deployment.release.rollback`, `deployment.infrastructure.apply` | `/metadata/deployment/previousVersion (string)` | — |
| DEPLOY-REVERT-001 | `deployment.release.rollback`, `deployment.release.cancel` | `/authorization`, `/reason` | `/approval` |
| DEPLOY-CONFIG-001 | `configuration.setting.create`, `configuration.setting.update`, `configuration.setting.delete`, `configuration.secret.rotate`, `configuration.feature.toggle`, `configuration.policy.update`, `configuration.retention.update` | `/authorization`, `/change/changedFields` | — |
| DEPLOY-APPROVAL-001 | `deployment.release.approve`, `change.request.approve`, `change.request.reject` | `/approval/status` | `/approval/workflowId`, `/approval/approvers` |
| DEPLOY-APPROVAL-002 | `deployment.release.deploy`, `deployment.release.promote`, `deployment.release.rollback`, `deployment.release.cancel`, `deployment.infrastructure.apply`, `configuration.setting.create`, `configuration.setting.update`, `configuration.setting.delete`, `configuration.secret.rotate`, `configuration.feature.toggle`, `configuration.policy.update`, `configuration.retention.update`<br>only when /metadata/deployment/approvalRequired = true | `/approval/status` | `/change/ticketId` |
| DEPLOY-EMERGENCY-001 | `change.request.approve`, `change.request.cancel`, `change.request.close`, `change.request.create`, `change.request.reject`, `configuration.feature.toggle`, `configuration.policy.update`, `configuration.retention.update`, `configuration.secret.rotate`, `configuration.setting.create`, `configuration.setting.delete`, `configuration.setting.update`, `deployment.release.*`, `deployment.infrastructure.*`<br>only when /metadata/deployment/emergency = true | `/reason` | `/approval`, `/change/incidentId` |
| DEPLOY-FAILURE-001 | `change.request.approve`, `change.request.cancel`, `change.request.close`, `change.request.create`, `change.request.reject`, `configuration.feature.toggle`, `configuration.policy.update`, `configuration.retention.update`, `configuration.secret.rotate`, `configuration.setting.create`, `configuration.setting.delete`, `configuration.setting.update`, `deployment.release.*`, `deployment.infrastructure.*`<br>only when /event/outcome = "failure" | `/metadata/deployment/resultingState (string)` | `/event/error/message` |
| DEPLOY-FAILURE-002 | `change.request.approve`, `change.request.cancel`, `change.request.close`, `change.request.create`, `change.request.reject`, `configuration.feature.toggle`, `configuration.policy.update`, `configuration.retention.update`, `configuration.secret.rotate`, `configuration.setting.create`, `configuration.setting.delete`, `configuration.setting.update`, `deployment.release.*`, `deployment.infrastructure.*`<br>only when /event/outcome = "partial" | `/metadata/deployment/resultingState (string)` | — |
| DEPLOY-AUTOMATION-001 (warning) | `deployment.release.deploy`, `deployment.release.promote`, `deployment.release.rollback`, `deployment.release.cancel`, `deployment.infrastructure.apply`, `configuration.setting.create`, `configuration.setting.update`, `configuration.setting.delete`, `configuration.secret.rotate`, `configuration.feature.toggle`, `configuration.policy.update`, `configuration.retention.update`<br>only when /actor/type = "service" | — | `/subject`, `/delegation` |

### document-management 0.2

Additional conformance requirements for document management audit events: creation, deletion, download, versioning, sharing, access policy, retention and legal hold. Every requirement adds to the OpenAuditModel Core Specification; none relaxes it. High-volume read events such as document.file.view are deliberately not governed.

| Rule | Applies to | Requires | Recommends |
| ---- | ---------- | -------- | ---------- |
| DOC-CORE-001 | `document.file.upload`, `document.file.delete`, `document.file.download`, `document.share.*`, `document.permission.*`, `document.version.*`, `document.retention.*`, `document.legal-hold.*` | `/authorization`, `/resource/classification` | — |
| DOC-CORE-002 (warning) | `document.file.upload`, `document.file.delete`, `document.file.download`, `document.share.*`, `document.permission.*`, `document.version.*`, `document.retention.*`, `document.legal-hold.*` | — | `/reason`, `/resource/parentId`, `/request/correlationId` |
| DOC-SHARE-001 | `document.share.*` | `/metadata/share/recipientType (string)` | — |
| DOC-SHARE-002 | `document.share.create` | `/metadata/share/permission (string)` | `/metadata/share/expiresAt` |
| DOC-SHARE-003 | `document.share.create`<br>only when /metadata/share/recipientType = "external" | `/reason`, `/metadata/share/expiresAt (string)` | — |
| DOC-PERM-001 | `document.permission.*` | `/metadata/permission/id (string)`, `/metadata/permission/granteeId (string)` | `/reason` |
| DOC-VERSION-001 | `document.version.*` | `/metadata/version/id (string)` | — |
| DOC-VERSION-002 | `document.version.rollback` | `/reason`, `/metadata/version/previousId (string)` | — |
| DOC-DELETE-001 | `document.file.delete` | `/reason` | `/approval` |
| DOC-RETENTION-001 | `document.retention.*` | `/change`, `/reason`, `/metadata/retention/class (string)` | `/approval` |
| DOC-HOLD-001 | `document.legal-hold.*` | `/reason`, `/metadata/legalHold/active (boolean)` | `/approval` |

### financial-transaction-management 0.2

Additional conformance requirements for audit events that record material financial operations: transfers, payments, withdrawals, deposits, refunds, reversals, payouts, settlements, chargebacks, reconciliation adjustments and transaction limit changes. Every requirement adds to the OpenAuditModel Core Specification; none relaxes it. Non-mutating financial reads such as balance enquiries, price quotes and routine reporting are deliberately not governed.

| Rule | Applies to | Requires | Recommends |
| ---- | ---------- | -------- | ---------- |
| FIN-CORE-001 | `financial.limit.create`, `financial.limit.delete`, `financial.limit.update`, `financial.transfer.*`, `financial.payment.*`, `financial.withdrawal.*`, `financial.deposit.*`, `financial.refund.*`, `financial.reversal.*`, `financial.payout.*`, `financial.settlement.*`, `financial.chargeback.*`, `financial.reconciliation.*` | `/authorization` | — |
| FIN-CORE-002 (warning) | `financial.limit.create`, `financial.limit.delete`, `financial.limit.update`, `financial.transfer.*`, `financial.payment.*`, `financial.withdrawal.*`, `financial.deposit.*`, `financial.refund.*`, `financial.reversal.*`, `financial.payout.*`, `financial.settlement.*`, `financial.chargeback.*`, `financial.reconciliation.*` | — | `/reason`, `/authentication`, `/relatedResources` |
| FIN-TXN-001 | `financial.transfer.*`, `financial.payment.*`, `financial.withdrawal.*`, `financial.deposit.*`, `financial.refund.*`, `financial.reversal.*`, `financial.payout.*`, `financial.settlement.*`, `financial.chargeback.*` | `/request/correlationId`, `/metadata/financial/transactionId (string)`, `/metadata/financial/amount (number)`, `/metadata/financial/currency (string)` | — |
| FIN-TXN-002 | `financial.transfer.*`, `financial.payment.*`, `financial.withdrawal.*`, `financial.deposit.*`, `financial.refund.*`, `financial.reversal.*`, `financial.payout.*`, `financial.settlement.*`, `financial.chargeback.*` | `/metadata/financial/direction (string)`, `/metadata/financial/status (string)` | — |
| FIN-LINK-001 | `financial.transfer.*`, `financial.settlement.*` | `/relatedResources` | — |
| FIN-REASON-001 | `financial.payment.reject`, `financial.payment.cancel`, `financial.transfer.cancel`, `financial.payout.cancel`, `financial.settlement.cancel`, `financial.withdrawal.reject`, `financial.refund.create`, `financial.reversal.*`, `financial.chargeback.*` | `/reason` | — |
| FIN-REVERSAL-001 | `financial.reversal.*`, `financial.chargeback.*` | `/metadata/financial/originalTransactionId (string)` | `/approval` |
| FIN-APPROVAL-001 | `financial.limit.create`, `financial.limit.delete`, `financial.limit.update`, `financial.transfer.*`, `financial.payment.*`, `financial.withdrawal.*`, `financial.deposit.*`, `financial.refund.*`, `financial.reversal.*`, `financial.payout.*`, `financial.settlement.*`, `financial.chargeback.*`, `financial.reconciliation.*`<br>only when /metadata/financial/approvalRequired = true | `/approval/status` | `/approval/workflowId`, `/approval/approvers` |
| FIN-MANUAL-001 | `financial.limit.create`, `financial.limit.delete`, `financial.limit.update`, `financial.transfer.*`, `financial.payment.*`, `financial.withdrawal.*`, `financial.deposit.*`, `financial.refund.*`, `financial.reversal.*`, `financial.payout.*`, `financial.settlement.*`, `financial.chargeback.*`, `financial.reconciliation.*`<br>only when /metadata/financial/manual = true | `/reason`, `/change` | `/approval` |
| FIN-RECON-001 | `financial.reconciliation.*` | `/metadata/financial/reconciliationId (string)` | `/request/correlationId` |
| FIN-RECON-002 | `financial.reconciliation.adjust` | `/change`, `/reason`, `/metadata/financial/amount (number)`, `/metadata/financial/currency (string)` | `/approval` |
| FIN-LIMIT-001 | `financial.limit.create`, `financial.limit.update`, `financial.limit.delete` | `/change`, `/reason`, `/metadata/financial/limitType (string)` | `/approval` |

### identity-and-access-management 0.2

Additional conformance requirements for identity and access management audit events. Every requirement adds to the OpenAuditModel Core Specification; none relaxes it.

| Rule | Applies to | Requires | Recommends |
| ---- | ---------- | -------- | ---------- |
| IAM-CORE-001 | `identity.*` | `/authorization` | — |
| IAM-CORE-002 | `identity.*` | — | `/reason`, `/request/correlationId` |
| IAM-ROLE-001 | `identity.role.assign`, `identity.role.revoke` | `/authorization`, `/reason`, `/metadata/role/id (string)`, `/metadata/role/privileged (boolean)` | `/approval`, `/request/correlationId` |
| IAM-ROLE-002 | `identity.role.assign`, `identity.role.revoke`<br>only when /metadata/role/privileged = true | `/approval`, `/authentication`, `/authentication/mfa = true` | — |
| IAM-PERM-001 | `identity.permission.*` | `/authorization`, `/reason`, `/metadata/permission/id (string)`, `/metadata/permission/scope (string)`, `/metadata/permission/privileged (boolean)` | `/approval`, `/request/correlationId` |
| IAM-PERM-002 | `identity.permission.*`<br>only when /metadata/permission/privileged = true | `/approval`, `/authentication`, `/authentication/mfa = true` | — |
| IAM-USER-001 | `identity.user.create`, `identity.user.disable`, `identity.user.delete` | `/metadata/user/type (string)` | — |
| IAM-USER-002 | `identity.user.disable`, `identity.user.delete` | `/reason` | `/approval` |
| IAM-SVC-001 | `identity.service-account.create`, `identity.service-account.disable` | `/metadata/serviceAccount/purpose (string)`, `/metadata/serviceAccount/ownerId (string)` | — |
| IAM-SVC-002 | `identity.service-account.create` | — | `/metadata/serviceAccount/expiresAt` |
| IAM-CRED-001 | `identity.credential.rotate` | `/authorization`, `/reason`, `/metadata/credential/type (string)` | `/request/correlationId` |

### incident-management 0.3

Additional conformance requirements for the lifecycle of incidents, problems and corrective actions: raising, reprioritising, assigning, escalating, resolving, closing, cancelling and reopening a case, recording a root cause analysis, and opening and verifying a corrective action. Every requirement adds to the OpenAuditModel Core Specification; none relaxes it. High-volume monitoring, timeline and read events such as monitoring.alert.raise, incident.note.create and incident.case.view are deliberately not governed.

| Rule | Applies to | Requires | Recommends |
| ---- | ---------- | -------- | ---------- |
| INC-CORE-001 | `corrective-action.close`, `corrective-action.open`, `corrective-action.verify`, `incident.assignment.change`, `incident.case.cancel`, `incident.cancel`, `incident.case.close`, `incident.close`, `incident.case.create`, `incident.create`, `incident.case.reopen`, `incident.reopen`, `incident.case.resolve`, `incident.resolve`, `incident.major.declare`, `incident.priority.change`, `incident.rca.approve`, `incident.rca.create`, `incident.rca.update`, `problem.case.close`, `problem.close`, `problem.case.create`, `problem.create` | `/authorization`, `/metadata/incident/status (string)` | — |
| INC-CORE-002 (warning) | `corrective-action.close`, `corrective-action.open`, `corrective-action.verify`, `incident.assignment.change`, `incident.case.cancel`, `incident.cancel`, `incident.case.close`, `incident.close`, `incident.case.create`, `incident.create`, `incident.case.reopen`, `incident.reopen`, `incident.case.resolve`, `incident.resolve`, `incident.major.declare`, `incident.priority.change`, `incident.rca.approve`, `incident.rca.create`, `incident.rca.update`, `incident.sla.breach`, `problem.case.close`, `problem.close`, `problem.case.create`, `problem.create` | — | `/request/correlationId`, `/relatedResources` |
| INC-CREATE-001 (warning) | `incident.case.create`, `incident.create`, `problem.case.create`, `problem.create` | — | `/reason`, `/metadata/incident/detectedAt`, `/metadata/incident/impact`, `/metadata/incident/urgency` |
| INC-STATE-001 | `incident.priority.change`, `incident.assignment.change`, `incident.major.declare`, `incident.case.resolve`, `incident.resolve`, `incident.case.close`, `incident.close`, `incident.case.cancel`, `incident.cancel`, `problem.case.close`, `problem.close`, `corrective-action.close` | `/change` | — |
| INC-STATE-002 | `incident.priority.change`, `incident.major.declare`, `incident.case.close`, `incident.close`, `incident.case.cancel`, `incident.cancel`, `problem.case.close`, `problem.close`, `corrective-action.close` | `/reason` | — |
| INC-PRIORITY-001 | `incident.case.create`, `incident.create`, `problem.case.create`, `problem.create`, `incident.priority.change`, `incident.major.declare`, `incident.sla.breach` | `/metadata/incident/priority (string)` | — |
| INC-ASSIGN-001 | `incident.assignment.change`, `corrective-action.open` | `/metadata/incident/assigneeId (string)` | `/reason` |
| INC-RESOLVE-001 | `incident.case.resolve`, `incident.resolve` | `/metadata/incident/resolutionType (string)` | `/reason`, `/metadata/incident/resolvedAt`, `/metadata/incident/correctiveAction/id` |
| INC-CLOSE-001 | `incident.case.close`, `incident.close`, `incident.case.cancel`, `incident.cancel`, `problem.case.close`, `problem.close`, `corrective-action.close`<br>only when /metadata/incident/approvalRequired = true | `/approval/status` | `/approval/approvers`, `/approval/approvedAt` |
| INC-REOPEN-001 | `incident.case.reopen`, `incident.reopen` | `/change`, `/reason` | `/evidence` |
| INC-RCA-001 | `incident.rca.approve`, `incident.rca.create`, `incident.rca.update` | `/metadata/incident/rca/method (string)` | — |
| INC-RCA-002 | `incident.rca.approve` | `/approval/status` | `/approval/approvers`, `/approval/approvedAt` |
| INC-CAPA-001 | `corrective-action.verify` | `/metadata/incident/correctiveAction/verificationMethod (string)` | `/metadata/incident/correctiveAction/verifiedAt` |
| INC-SLA-001 | `incident.sla.breach` | `/metadata/incident/sla/target (string)` | `/metadata/incident/sla/breachedAt` |
| INC-EVIDENCE-001 (warning) | `corrective-action.close`, `corrective-action.open`, `corrective-action.verify`, `incident.rca.approve`, `incident.rca.create`, `incident.rca.update` | — | `/evidence` |

### message-broker-management 0.2

Additional conformance requirements for message broker control-plane audit events: cluster, topic, queue, exchange, stream and consumer-group administration, access control lists, quotas, broker configuration, offset resets and message replay. Every requirement adds to the OpenAuditModel Core Specification; none relaxes it. Data-plane traffic — publishing, consuming, acknowledging and automatic rebalancing — is deliberately not governed, and message payloads are never recorded.

| Rule | Applies to | Requires | Recommends |
| ---- | ---------- | -------- | ---------- |
| BROKER-CORE-001 | `broker.acl.grant`, `broker.acl.revoke`, `broker.cluster.create`, `broker.cluster.delete`, `broker.cluster.failover`, `broker.cluster.scale`, `broker.cluster.upgrade`, `broker.configuration.update`, `broker.consumer-group.create`, `broker.consumer-group.delete`, `broker.consumer-group.update`, `broker.exchange.create`, `broker.exchange.delete`, `broker.exchange.update`, `broker.message.replay`, `broker.offset.reset`, `broker.permission.grant`, `broker.permission.revoke`, `broker.queue.create`, `broker.queue.delete`, `broker.queue.purge`, `broker.queue.update`, `broker.quota.create`, `broker.quota.delete`, `broker.quota.update`, `broker.stream.create`, `broker.stream.delete`, `broker.stream.trim`, `broker.stream.update`, `broker.topic.create`, `broker.topic.delete`, `broker.topic.update` | `/authorization`, `/metadata/broker/system (string)`, `/metadata/broker/clusterId (string)` | — |
| BROKER-CORE-002 (warning) | `broker.acl.grant`, `broker.acl.revoke`, `broker.cluster.create`, `broker.cluster.delete`, `broker.cluster.failover`, `broker.cluster.scale`, `broker.cluster.upgrade`, `broker.configuration.update`, `broker.consumer-group.create`, `broker.consumer-group.delete`, `broker.consumer-group.update`, `broker.exchange.create`, `broker.exchange.delete`, `broker.exchange.update`, `broker.message.replay`, `broker.offset.reset`, `broker.permission.grant`, `broker.permission.revoke`, `broker.queue.create`, `broker.queue.delete`, `broker.queue.purge`, `broker.queue.update`, `broker.quota.create`, `broker.quota.delete`, `broker.quota.update`, `broker.stream.create`, `broker.stream.delete`, `broker.stream.trim`, `broker.stream.update`, `broker.topic.create`, `broker.topic.delete`, `broker.topic.update` | — | `/reason`, `/authentication`, `/resource/parentId`, `/request/correlationId` |
| BROKER-RISK-001 | `broker.acl.grant`, `broker.acl.revoke`, `broker.cluster.create`, `broker.cluster.delete`, `broker.cluster.failover`, `broker.cluster.scale`, `broker.cluster.upgrade`, `broker.configuration.update`, `broker.consumer-group.create`, `broker.consumer-group.delete`, `broker.consumer-group.update`, `broker.exchange.create`, `broker.exchange.delete`, `broker.exchange.update`, `broker.message.replay`, `broker.offset.reset`, `broker.permission.grant`, `broker.permission.revoke`, `broker.queue.create`, `broker.queue.delete`, `broker.queue.purge`, `broker.queue.update`, `broker.quota.create`, `broker.quota.delete`, `broker.quota.update`, `broker.stream.create`, `broker.stream.delete`, `broker.stream.trim`, `broker.stream.update`, `broker.topic.create`, `broker.topic.delete`, `broker.topic.update` | `/metadata/broker/operation/destructive (boolean)` | — |
| BROKER-RISK-002 | `broker.acl.grant`, `broker.acl.revoke`, `broker.cluster.create`, `broker.cluster.delete`, `broker.cluster.failover`, `broker.cluster.scale`, `broker.cluster.upgrade`, `broker.configuration.update`, `broker.consumer-group.create`, `broker.consumer-group.delete`, `broker.consumer-group.update`, `broker.exchange.create`, `broker.exchange.delete`, `broker.exchange.update`, `broker.message.replay`, `broker.offset.reset`, `broker.permission.grant`, `broker.permission.revoke`, `broker.queue.create`, `broker.queue.delete`, `broker.queue.purge`, `broker.queue.update`, `broker.quota.create`, `broker.quota.delete`, `broker.quota.update`, `broker.stream.create`, `broker.stream.delete`, `broker.stream.trim`, `broker.stream.update`, `broker.topic.create`, `broker.topic.delete`, `broker.topic.update`<br>only when /metadata/broker/operation/destructive = true | `/reason` | `/approval` |
| BROKER-RISK-003 | `broker.acl.grant`, `broker.acl.revoke`, `broker.cluster.create`, `broker.cluster.delete`, `broker.cluster.failover`, `broker.cluster.scale`, `broker.cluster.upgrade`, `broker.configuration.update`, `broker.consumer-group.create`, `broker.consumer-group.delete`, `broker.consumer-group.update`, `broker.exchange.create`, `broker.exchange.delete`, `broker.exchange.update`, `broker.message.replay`, `broker.offset.reset`, `broker.permission.grant`, `broker.permission.revoke`, `broker.queue.create`, `broker.queue.delete`, `broker.queue.purge`, `broker.queue.update`, `broker.quota.create`, `broker.quota.delete`, `broker.quota.update`, `broker.stream.create`, `broker.stream.delete`, `broker.stream.trim`, `broker.stream.update`, `broker.topic.create`, `broker.topic.delete`, `broker.topic.update`<br>only when /metadata/broker/approvalRequired = true | `/approval` | — |
| BROKER-FAIL-001 | `broker.acl.grant`, `broker.acl.revoke`, `broker.cluster.create`, `broker.cluster.delete`, `broker.cluster.failover`, `broker.cluster.scale`, `broker.cluster.upgrade`, `broker.configuration.update`, `broker.consumer-group.create`, `broker.consumer-group.delete`, `broker.consumer-group.update`, `broker.exchange.create`, `broker.exchange.delete`, `broker.exchange.update`, `broker.message.replay`, `broker.offset.reset`, `broker.permission.grant`, `broker.permission.revoke`, `broker.queue.create`, `broker.queue.delete`, `broker.queue.purge`, `broker.queue.update`, `broker.quota.create`, `broker.quota.delete`, `broker.quota.update`, `broker.stream.create`, `broker.stream.delete`, `broker.stream.trim`, `broker.stream.update`, `broker.topic.create`, `broker.topic.delete`, `broker.topic.update`<br>only when /event/outcome = "failure" | `/event/error/type` | `/event/error/retryable` |
| BROKER-LIFECYCLE-001 | `broker.topic.create`, `broker.queue.create`, `broker.stream.create`, `broker.exchange.create` | `/resource/classification` | `/resource/ownerId` |
| BROKER-CHANGE-001 | `broker.acl.grant`, `broker.acl.revoke`, `broker.configuration.update`, `broker.consumer-group.update`, `broker.exchange.update`, `broker.offset.reset`, `broker.permission.grant`, `broker.permission.revoke`, `broker.queue.update`, `broker.quota.create`, `broker.quota.delete`, `broker.quota.update`, `broker.stream.update`, `broker.topic.update` | `/change` | `/change/changedFields` |
| BROKER-ACL-001 | `broker.acl.grant`, `broker.acl.revoke`, `broker.permission.grant`, `broker.permission.revoke` | `/metadata/broker/acl/permission (string)`, `/metadata/broker/acl/principalId (string)` | `/metadata/broker/acl/effect` |
| BROKER-QUOTA-001 | `broker.quota.create`, `broker.quota.delete`, `broker.quota.update` | `/metadata/broker/quota/dimension (string)` | — |
| BROKER-OFFSET-001 | `broker.offset.reset` | `/reason`, `/metadata/broker/offset/previous (string)`, `/metadata/broker/offset/target (string)` | `/metadata/broker/offset/strategy` |
| BROKER-REPLAY-001 | `broker.message.replay` | `/reason`, `/metadata/broker/replay/scope (string)` | `/metadata/broker/replay/messageCount` |

### secrets-and-key-management 0.2

Additional conformance requirements for the custody of secrets, cryptographic keys and certificates: creation, rotation, revocation, destruction, policy change, and the privileged reveal and export operations that turn protected material into copied material. Every requirement adds to the OpenAuditModel Core Specification; none relaxes it. Routine automated retrieval of a secret and ordinary cryptographic operations against a key are deliberately not governed. An audit event records that a secret operation occurred; it never records the secret.

| Rule | Applies to | Requires | Recommends |
| ---- | ---------- | -------- | ---------- |
| SECRET-CORE-001 | `secret.create`, `secret.update`, `secret.rotate`, `secret.revoke`, `secret.delete`, `secret.reveal`, `secret.export`, `key.generate`, `key.import`, `key.rotate`, `key.enable`, `key.disable`, `key.destroy`, `key.export`, `certificate.issue`, `certificate.renew`, `certificate.revoke`, `certificate.delete`, `secret.policy.*`, `key.policy.*` | `/authorization`, `/resource/classification` | — |
| SECRET-CORE-002 | `secret.create`, `secret.update`, `secret.rotate`, `secret.revoke`, `secret.delete`, `secret.reveal`, `secret.export`, `key.generate`, `key.import`, `key.rotate`, `key.enable`, `key.disable`, `key.destroy`, `key.export`, `certificate.issue`, `certificate.renew`, `certificate.revoke`, `certificate.delete`, `secret.policy.*`, `key.policy.*` | `/metadata/secret/type (string)` | — |
| SECRET-CORE-003 (warning) | `secret.create`, `secret.update`, `secret.rotate`, `secret.revoke`, `secret.delete`, `secret.reveal`, `secret.export`, `key.generate`, `key.import`, `key.rotate`, `key.enable`, `key.disable`, `key.destroy`, `key.export`, `certificate.issue`, `certificate.renew`, `certificate.revoke`, `certificate.delete`, `secret.policy.*`, `key.policy.*` | — | `/reason`, `/request/correlationId`, `/metadata/secret/provider` |
| SECRET-LIFECYCLE-001 | `secret.create`, `key.generate`, `key.import`, `certificate.issue` | `/resource/ownerId` | — |
| SECRET-ROTATE-001 | `secret.rotate`, `key.rotate`, `certificate.renew` | `/change` | `/change/changedFields` |
| SECRET-ACCESS-001 | `secret.reveal`, `secret.export`, `key.export` | `/authentication`, `/reason` | `/approval` |
| SECRET-ACCESS-002 | `secret.reveal`, `secret.export`, `key.export`<br>only when /metadata/secret/emergencyAccess = true | `/approval`, `/authentication/mfa = true` | — |
| SECRET-EXPORT-001 | `secret.export`, `key.export` | `/metadata/secret/destinationType (string)` | — |
| SECRET-DESTROY-001 | `secret.revoke`, `secret.delete`, `key.disable`, `key.destroy`, `certificate.revoke`, `certificate.delete` | `/reason` | `/approval` |
| SECRET-APPROVAL-001 | `secret.create`, `secret.update`, `secret.rotate`, `secret.revoke`, `secret.delete`, `secret.reveal`, `secret.export`, `key.generate`, `key.import`, `key.rotate`, `key.enable`, `key.disable`, `key.destroy`, `key.export`, `certificate.issue`, `certificate.renew`, `certificate.revoke`, `certificate.delete`, `secret.policy.*`, `key.policy.*`<br>only when /metadata/secret/approvalRequired = true | `/approval` | — |
| SECRET-POLICY-001 | `secret.policy.*`, `key.policy.*` | `/change`, `/reason` | `/approval` |
| SECRET-CERT-001 | `certificate.issue`, `certificate.renew` | `/metadata/secret/expiresAt (string)` | `/metadata/secret/algorithm` |
| SECRET-KEY-001 | `key.import` | `/reason` | `/approval` |
| SECRET-KEY-002 (warning) | `key.generate`, `key.import`, `key.rotate` | — | `/metadata/secret/algorithm`, `/metadata/secret/expiresAt` |

## 3. The fields most often required

Across every rule in every profile. A producer whose event type cannot express the top of
this list cannot satisfy most profiles, whatever its event names are — which is a question
about the type that produces the events, not about the names it gives them.

| Pointer | Rules requiring it |
| ------- | ------------------ |
| `/reason` | 31 |
| `/authorization` | 15 |
| `/change` | 13 |
| `/approval` | 7 |
| `/approval/status` | 7 |
| `/authentication` | 5 |
| `/authentication/mfa` | 3 |
| `/resource/classification` | 3 |
| `/event/error/type` | 2 |
| `/metadata/backup/recoveryPoint` | 2 |
| `/metadata/deployment/resultingState` | 2 |
| `/metadata/financial/amount` | 2 |
| `/metadata/financial/currency` | 2 |
| `/metadata/permission/id` | 2 |
| `/relatedResources` | 2 |
| `/request/correlationId` | 2 |
| `/resource/ownerId` | 2 |
| `/change/after` | 1 |
| `/change/before` | 1 |
| `/change/changedFields` | 1 |
| `/metadata/backup/backupId` | 1 |
| `/metadata/backup/backupType` | 1 |
| `/metadata/backup/policyId` | 1 |
| `/metadata/backup/recoveryId` | 1 |
| `/metadata/backup/restoreId` | 1 |
| `/metadata/backup/retentionClass` | 1 |
| `/metadata/backup/snapshotId` | 1 |
| `/metadata/backup/sourceId` | 1 |
| `/metadata/backup/targetScope` | 1 |
| `/metadata/backup/verificationStatus` | 1 |
| `/metadata/broker/acl/permission` | 1 |
| `/metadata/broker/acl/principalId` | 1 |
| `/metadata/broker/clusterId` | 1 |
| `/metadata/broker/offset/previous` | 1 |
| `/metadata/broker/offset/target` | 1 |
| `/metadata/broker/operation/destructive` | 1 |
| `/metadata/broker/quota/dimension` | 1 |
| `/metadata/broker/replay/scope` | 1 |
| `/metadata/broker/system` | 1 |
| `/metadata/credential/type` | 1 |
| `/metadata/customer/accountType` | 1 |
| `/metadata/customer/customerType` | 1 |
| `/metadata/customer/deletionScope` | 1 |
| `/metadata/customer/limitType` | 1 |
| `/metadata/customer/mergedFromId` | 1 |
| `/metadata/customer/restrictionScope` | 1 |
| `/metadata/customer/status` | 1 |
| `/metadata/deployment/approvalRequired` | 1 |
| `/metadata/deployment/environment` | 1 |
| `/metadata/deployment/id` | 1 |
| `/metadata/deployment/previousVersion` | 1 |
| `/metadata/deployment/version` | 1 |
| `/metadata/financial/direction` | 1 |
| `/metadata/financial/limitType` | 1 |
| `/metadata/financial/originalTransactionId` | 1 |
| `/metadata/financial/reconciliationId` | 1 |
| `/metadata/financial/status` | 1 |
| `/metadata/financial/transactionId` | 1 |
| `/metadata/incident/assigneeId` | 1 |
| `/metadata/incident/correctiveAction/verificationMethod` | 1 |
| `/metadata/incident/priority` | 1 |
| `/metadata/incident/rca/method` | 1 |
| `/metadata/incident/resolutionType` | 1 |
| `/metadata/incident/sla/target` | 1 |
| `/metadata/incident/status` | 1 |
| `/metadata/integration/connectionId` | 1 |
| `/metadata/integration/credentialReference` | 1 |
| `/metadata/integration/endpointClass` | 1 |
| `/metadata/integration/provider` | 1 |
| `/metadata/integration/type` | 1 |
| `/metadata/integration/webhookId` | 1 |
| `/metadata/legalHold/active` | 1 |
| `/metadata/permission/granteeId` | 1 |
| `/metadata/permission/privileged` | 1 |
| `/metadata/permission/scope` | 1 |
| `/metadata/retention/class` | 1 |
| `/metadata/role/id` | 1 |
| `/metadata/role/privileged` | 1 |
| `/metadata/secret/destinationType` | 1 |
| `/metadata/secret/expiresAt` | 1 |
| `/metadata/secret/type` | 1 |
| `/metadata/serviceAccount/ownerId` | 1 |
| `/metadata/serviceAccount/purpose` | 1 |
| `/metadata/share/expiresAt` | 1 |
| `/metadata/share/permission` | 1 |
| `/metadata/share/recipientType` | 1 |
| `/metadata/user/type` | 1 |
| `/metadata/version/id` | 1 |
| `/metadata/version/previousId` | 1 |
| `/subject` | 1 |

## 4. What none of this checks

A profile requires that a field is present, is of a type, or equals a scalar. It cannot
check that the value is the right one. `/actor/id` being present does not make it the actor
who acted, and an approval object does not mean an approval happened. The most important
requirement in several profiles is semantic and is stated in the profile's prose rather than
in a rule, because a rule that approximated it would be wrong in a way nobody would notice.

See [ADR 0008](../decisions/0008-declarative-profile-conformance.md) for why the rule
vocabulary is this small, and what was deliberately left out of it.
