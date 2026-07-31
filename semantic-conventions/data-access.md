# Data Access Events

**Specification version: 0.1 · Status: Experimental**

Categories: `data-access`, `data-modification`

## 1. Recommended event names

### Reading

| Name                     | Operation                      |
| ------------------------ | ------------------------------ |
| `data.record.read`       | A record was read individually |
| `data.record.search`     | A search returned records      |
| `data.report.generate`   | A report was produced          |
| `data.export.create`     | An export was produced         |
| `data.export.download`   | An export was retrieved        |
| `document.file.view`     | A document was viewed          |
| `document.file.download` | A document was downloaded      |

### Writing

| Name                  | Operation                     |
| --------------------- | ----------------------------- |
| `data.record.create`  | A record was created          |
| `data.record.update`  | A record was modified         |
| `data.record.delete`  | A record was deleted          |
| `data.record.restore` | A deleted record was restored |
| `data.import.create`  | Data was imported             |

### Sharing

| Name                         | Operation                                            |
| ---------------------------- | ---------------------------------------------------- |
| `document.share.create`      | Access was granted to a recipient                    |
| `document.share.revoke`      | A share was withdrawn                                |
| `document.permission.grant`  | A permission was granted on a resource               |
| `document.permission.revoke` | A permission was removed                             |
| `data.transfer.external`     | Data was transmitted outside the operator's boundary |

## 2. Not everything is worth auditing

Read events are the highest-volume category in most systems and the least useful by default. An audit
trail that records every list view is expensive, hard to search, and hides the events that matter.

Producers SHOULD audit reads where at least one of these holds:

- The resource is classified above `internal`.
- The read crosses a tenant, organization or customer boundary.
- The actor is privileged, or is acting for someone else.
- The volume is unusual: an export, a bulk search, a full extract.
- The data is personal data and the operator has committed to access transparency.

Producers SHOULD NOT audit ordinary reads of unclassified data by their owner. That is what
application logs are for.

## 3. Context to populate

| Field                     | Guidance                                                          |
| ------------------------- | ----------------------------------------------------------------- |
| `resource.classification` | Frequently the reason the event is being recorded at all          |
| `resource.ownerId`        | Who the data belongs to, where it differs from the actor          |
| `privacy`                 | `containsPersonalData`, `dataCategories`, `processing`, `purpose` |
| `authorization`           | The decision that permitted the access                            |
| `reason`                  | For support access and any access to another party's data         |
| `request.route`           | The route template, never a resolved URL with a query string      |
| `metadata`                | `recordCount`, `exportFormat`, `scope`, `filterName`              |
| `controlCategories`       | `data-access-logging`, `external-data-sharing`                    |

## 4. Search and bulk reads

A search returns an unknown number of records. Recording each one is usually infeasible and often
undesirable. Recommended handling:

- Record one `data.record.search` event with `resource` set to the collection searched.
- Record `metadata.recordCount`, and the **name** of the filter applied, not its values.
- MUST NOT record the query string or the search terms. Search terms routinely contain personal data
  and are among the most sensitive values a system holds. See
  [privacy.md](../specification/privacy.md).

## 5. External sharing

Sharing outside the operator's boundary is a distinct control, and SHOULD be recorded as such:

- Include `external-data-sharing` in `controlCategories`.
- Record the recipient **type** and **domain**, not the recipient's address, unless the audit purpose
  specifically requires identifying the individual.
- Record share constraints — expiry, password protection, watermarking, download permission — in
  `metadata`, because they are what a reviewer assesses.
- Emit a matching `document.share.revoke` when the share ends, so that the trail shows exposure
  windows rather than only their beginning.

See [examples/valid/document-external-share.json](../examples/valid/document-external-share.json).

## 6. Exports

Exports concentrate risk: one operation moves a large volume of data out of the controlled system.

- `data.export.create` records production of the export; `data.export.download` records retrieval.
  Both are worth recording, because they can be separated by days and performed by different
  principals.
- Record `metadata.recordCount` and `metadata.exportFormat`.
- Record `privacy` fully. An export is the event most likely to be reviewed under a data protection
  question.
- Where the export is produced by a service for a user, record the `subject` and `delegation`. See
  [examples/valid/service-account-data-export.json](../examples/valid/service-account-data-export.json).

## 7. Modification

For data modification, `change` carries the substance. Prefer `changedFields` over values; see
[change-model.md](../specification/change-model.md).

`data-modification` is the category for business data. Changes to application or platform settings
belong in `configuration`; see
[configuration-and-change.md](configuration-and-change.md).
