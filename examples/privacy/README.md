# Privacy fixtures

**Status: Informative.** These fixtures illustrate and regression-test `auditmodel lint-privacy`. The
normative privacy requirements are [specification/privacy.md](../../specification/privacy.md); §6 of
that document describes the linter and its limits.

Every fixture here is a **schema-valid** event. The ones under `findings/` fail linting, not
validation — that separation is the point of having two commands.

```bash
auditmodel lint-privacy examples/privacy/clean
auditmodel lint-privacy examples/privacy/findings
auditmodel lint-privacy examples/privacy --format json
```

## All values are synthetic and non-functional

No fixture in this directory contains a real credential, a valid API key, a real JSON Web Token, a
real private key, a real connection string or real personal data. Every value is invented for this
repository.

They are constructed to match a detector while being obviously useless:

- The JSON Web Token has a real base64url header and payload, so it is structurally a token, and a
  signature that is the base64url encoding of the words `synthetic-signature-not-valid`. Nothing can
  verify it.
- The private key fixture contains a PEM marker and the words `SYNTHETIC FIXTURE CONTENT, NOT A REAL
KEY` where key material would be. There is no key.
- Token-prefix values use runs of `S` and `0` after the published prefix.
- Hosts use `example.com`, reserved for documentation by RFC 2606.
- Credential values say what they are: `synthetic-fixture-value-not-a-real-password`.

Contributors adding fixtures MUST follow the same rule. A fixture that works is a leaked credential
in a public repository, and rotating it afterwards does not remove it from the history.

## Clean fixtures

Every file under `clean/` MUST produce zero findings. They exist to catch false positives, which are
the failure mode that gets a linter switched off.

| Fixture                                                            | Exercises                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [minimal-clean-event.json](clean/minimal-clean-event.json)         | The seven required fields and nothing else                                    |
| [hashes-and-identifiers.json](clean/hashes-and-identifiers.json)   | UUID, ULID, trace and span identifiers, SHA-256/384/512 digests, timestamps   |
| [safe-evidence-reference.json](clean/safe-evidence-reference.json) | Evidence URLs and reference paths with no query, fragment or user information |
| [sanitized-change.json](clean/sanitized-change.json)               | A credential rotation recorded as changed **field names**, never values       |
| [structured-metadata.json](clean/structured-metadata.json)         | Small structured metadata, attributes and reverse-domain extensions           |

`sanitized-change.json` is the one worth reading. It records rotating an API key with
`changedFields: ["secret", "rotatedAt"]` and a `before`/`after` holding only a timestamp and a version
number. The fact of the rotation is fully auditable; the secret appears nowhere.

## Finding fixtures

Each file raises its documented rule. Expectations are asserted by
[`privacy-lint.test.ts`](../../conformance/tests/privacy-lint.test.ts).

| Fixture                                                                             | Rule           | Defect                                                  |
| ----------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------- |
| [password-field.json](findings/password-field.json)                                 | `OAM-PRIV-001` | A property named `password` is populated                |
| [access-token-field.json](findings/access-token-field.json)                         | `OAM-PRIV-001` | A property named `accessToken` is populated             |
| [bearer-token.json](findings/bearer-token.json)                                     | `OAM-PRIV-002` | A captured header value, under a harmless name          |
| [private-key.json](findings/private-key.json)                                       | `OAM-PRIV-003` | A PEM private key marker                                |
| [jwt-token.json](findings/jwt-token.json)                                           | `OAM-PRIV-010` | A structurally valid token                              |
| [url-userinfo.json](findings/url-userinfo.json)                                     | `OAM-PRIV-030` | A URL with an embedded user name and password           |
| [evidence-query-string.json](findings/evidence-query-string.json)                   | `OAM-PRIV-031` | An evidence reference carrying signed access parameters |
| [credentialed-connection-string.json](findings/credentialed-connection-string.json) | `OAM-PRIV-040` | A database URL carrying a password                      |
| [high-entropy-token.json](findings/high-entropy-token.json)                         | `OAM-PRIV-050` | A long random-looking value under a neutral name        |
| [oversized-change-before.json](findings/oversized-change-before.json)               | `OAM-PRIV-060` | A `change.before` holding a whole record                |
| [raw-response-body.json](findings/raw-response-body.json)                           | `OAM-PRIV-061` | A property named `responseBody` is populated            |

### Notes on individual fixtures

**`bearer-token.json` stores the header under `upstreamHeader`, not under `authorization`.** That is
deliberate: it proves the value rule fires on shape alone, without help from the property name. A
field actually named `authorization` would be caught by the name rule regardless of its contents.

**`high-entropy-token.json` reports at low confidence.** The value could be a session handle, an
opaque customer reference or a secret; the linter cannot tell, and says so. Compare it with
`hashes-and-identifiers.json`, where equally random-looking values are recognised as UUIDs, digests
and trace identifiers and produce nothing.

**`oversized-change-before.json` reports minimization, not exposure.** The finding says the value is
large enough to suggest an object was captured rather than selected. It does not claim the object
contains personal data, because nothing here can know that.

**`credentialed-connection-string.json` is reported as a connection string, not as a URL with user
information.** Both rules would match; reporting the more specific one avoids saying the same thing
twice. A host-only database URL is reported under a separate low-severity rule and is explicitly not
called a credential.

## What these fixtures cannot show

There is no fixture for a password that is a dictionary word in a field named `note`, because nothing
detects it. There is none for a national identification number, a home address or a medical detail,
because the linter looks for values shaped like secrets and most personal data is not shaped like
anything.

Those are not gaps to be closed by better fixtures. They are the boundary of what deterministic
static analysis can do, and they are stated in
[privacy.md](../../specification/privacy.md) §6.3 and §6.9.
