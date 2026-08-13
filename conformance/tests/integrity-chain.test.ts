/**
 * Previous-hash chain verification.
 *
 * Chain verification proves consistency of the supplied set only. The tests
 * below pin down what it detects; specification/integrity.md §8 states what it
 * cannot detect.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { createValidator, resolveSchemaPath } from "../src/validate.js";
import { sealEvent } from "../src/integrity/digest.js";
import { verifyChains, type ChainEventInput } from "../src/integrity/verify-chain.js";
import type { ChainReport } from "../src/integrity/types.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const integrityRoot = path.join(repoRoot, "examples", "integrity");
const validator = createValidator(schemaPath);

type Event = Record<string, unknown>;

const CHAIN_ID = "chain-test-instance-1";

function integrityOf(event: Event): Event {
  return event["integrity"] as Event;
}

/** Builds a sealed chain of `count` events with sequences 1..count. */
function buildChain(count: number, chainId = CHAIN_ID): Event[] {
  const events: Event[] = [];
  let previousHash: string | undefined;

  for (let index = 0; index < count; index += 1) {
    const sealed = sealEvent({
      specVersion: "0.1",
      id: `018f2a30-1111-7222-8333-00000000000${index + 1}`,
      time: `2026-04-03T08:0${index}:00.000Z`,
      sequence: index + 1,
      event: { name: "data.record.update", category: "data-modification", outcome: "success" },
      actor: { type: "user", id: "user-123" },
      resource: { type: "record", id: `record-${index + 1}` },
      application: { name: "application-service", environment: "production" },
      integrity: {
        canonicalization: "RFC8785",
        hashAlgorithm: "SHA-256",
        hash: "",
        ...(previousHash === undefined ? {} : { previousHash }),
        chainId,
      },
    }) as Event;

    previousHash = integrityOf(sealed)["hash"] as string;
    events.push(sealed);
  }

  return events;
}

function inputs(events: readonly Event[]): ChainEventInput[] {
  return events.map((event, index) => ({ label: `event-${index + 1}`, event }));
}

function verify(events: readonly Event[]): ChainReport {
  return verifyChains(inputs(events), validator);
}

function chainKinds(report: ChainReport): string[] {
  return report.chains.flatMap((chain) => chain.findings.map((finding) => finding.kind));
}

function loadDirectory(...segments: string[]): Event[] {
  const directory = path.join(integrityRoot, ...segments);
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((entry) => JSON.parse(readFileSync(path.join(directory, entry), "utf8")) as Event);
}

describe("a well-formed chain", () => {
  test("verifies end to end", () => {
    const report = verify(buildChain(3));
    assert.equal(report.intact, true);
    assert.equal(report.chains.length, 1);
    assert.equal(report.chains[0]?.eventCount, 3);
    assert.equal(report.chains[0]?.firstSequence, 1);
    assert.equal(report.chains[0]?.lastSequence, 3);
    assert.deepEqual(report.unassigned, []);
  });

  test("reports the checks it performed", () => {
    const report = verify(buildChain(3));
    assert.deepEqual(
      report.chains[0]?.checks.map((check) => check.message),
      [
        "all 3 event digests valid",
        "all 2 previous-hash links valid",
        "chain starts at a genesis event",
      ],
    );
  });

  test("the supplied order does not matter, because ordering is by sequence", () => {
    const events = buildChain(4);
    const shuffled = [events[2], events[0], events[3], events[1]] as Event[];
    assert.equal(verify(shuffled).intact, true);
  });

  test("a single-event chain is intact", () => {
    assert.equal(verify(buildChain(1)).intact, true);
  });

  test("non-contiguous sequences are permitted and reported as a note", () => {
    const events = buildChain(2);
    const second = structuredClone(events[1] as Event);
    second["sequence"] = 9;
    const resealed = sealEvent(second) as Event;

    const report = verify([events[0] as Event, resealed]);
    assert.equal(report.intact, true);
    assert.equal(report.chains[0]?.notes.length, 1);
    assert.match(report.chains[0]?.notes[0]?.message ?? "", /not contiguous/);
  });
});

describe("modification detection", () => {
  test("a modified event breaks its own digest but not the links", () => {
    const events = buildChain(3);
    ((events[1] as Event)["resource"] as Event)["id"] = "record-tampered";

    const report = verify(events);
    assert.equal(report.intact, false);
    assert.deepEqual(chainKinds(report), ["hash-mismatch"]);
  });

  test("re-sealing a modified event moves the failure to the link", () => {
    const events = buildChain(3);
    const tampered = structuredClone(events[1] as Event);
    (tampered["resource"] as Event)["id"] = "record-tampered";
    const resealed = sealEvent(tampered) as Event;

    const report = verify([events[0] as Event, resealed, events[2] as Event]);
    assert.equal(report.intact, false);
    assert.deepEqual(chainKinds(report), ["broken-link"]);
  });

  test("a removed event is detected as a broken link, not merely a gap", () => {
    const events = buildChain(3);
    const report = verify([events[0] as Event, events[2] as Event]);
    assert.equal(report.intact, false);
    assert.ok(chainKinds(report).includes("broken-link"));
  });
});

describe("ordering failures", () => {
  test("a duplicate sequence is rejected", () => {
    const events = buildChain(3);
    const duplicate = structuredClone(events[2] as Event);
    duplicate["sequence"] = 2;
    const report = verify([events[0] as Event, events[1] as Event, sealEvent(duplicate) as Event]);

    assert.equal(report.intact, false);
    assert.ok(chainKinds(report).includes("duplicate-sequence"));
  });

  test("a missing sequence is rejected", () => {
    const events = buildChain(3);
    const withoutSequence = structuredClone(events[1] as Event);
    delete withoutSequence["sequence"];
    const report = verify([
      events[0] as Event,
      sealEvent(withoutSequence) as Event,
      events[2] as Event,
    ]);

    assert.equal(report.intact, false);
    assert.ok(chainKinds(report).includes("sequence-missing"));
  });

  test("swapped sequence values are detected through the digest", () => {
    const events = buildChain(3);
    const second = structuredClone(events[1] as Event);
    const third = structuredClone(events[2] as Event);
    second["sequence"] = 3;
    third["sequence"] = 2;

    const report = verify([events[0] as Event, second, third]);
    assert.equal(report.intact, false);
    assert.equal(chainKinds(report).filter((kind) => kind === "hash-mismatch").length, 2);
  });
});

describe("linking rules", () => {
  test("the first event omits previousHash", () => {
    const events = buildChain(2);
    assert.equal(integrityOf(events[0] as Event)["previousHash"], undefined);
  });

  test("a first event that declares previousHash is a segment, not a failure", () => {
    const events = buildChain(3);
    const report = verify([events[1] as Event, events[2] as Event]);

    assert.equal(report.intact, true);
    assert.equal(report.chains[0]?.notes.length, 1);
    assert.match(report.chains[0]?.notes[0]?.message ?? "", /does not start at a genesis event/);
  });

  test("a later event without previousHash is rejected", () => {
    const events = buildChain(3);
    const orphan = structuredClone(events[2] as Event);
    delete integrityOf(orphan)["previousHash"];
    const report = verify([events[0] as Event, events[1] as Event, sealEvent(orphan) as Event]);

    assert.equal(report.intact, false);
    assert.ok(chainKinds(report).includes("previous-hash-missing"));
  });

  test("a chain that mixes hash algorithms is rejected", () => {
    const events = buildChain(2);
    const mixed = structuredClone(events[1] as Event);
    integrityOf(mixed)["hashAlgorithm"] = "SHA-512";
    const report = verify([events[0] as Event, sealEvent(mixed) as Event]);

    assert.equal(report.intact, false);
    assert.ok(chainKinds(report).includes("algorithm-mismatch"));
  });
});

describe("grouping", () => {
  test("independent chains are verified independently", () => {
    const report = verify([...buildChain(2, "chain-a"), ...buildChain(3, "chain-b")]);

    assert.equal(report.intact, true);
    assert.equal(report.chains.length, 2);
    assert.deepEqual(
      report.chains.map((chain) => chain.chainId),
      ["chain-a", "chain-b"],
    );
    assert.deepEqual(
      report.chains.map((chain) => chain.eventCount),
      [2, 3],
    );
  });

  test("one broken chain does not mark an unrelated chain broken", () => {
    const good = buildChain(2, "chain-a");
    const bad = buildChain(2, "chain-b");
    ((bad[1] as Event)["resource"] as Event)["id"] = "record-tampered";

    const report = verify([...good, ...bad]);
    assert.equal(report.intact, false);
    assert.equal(report.chains.find((chain) => chain.chainId === "chain-a")?.intact, true);
    assert.equal(report.chains.find((chain) => chain.chainId === "chain-b")?.intact, false);
  });

  test("an event without a chain identifier cannot be assigned", () => {
    const events = buildChain(1);
    delete integrityOf(events[0] as Event)["chainId"];
    const report = verify(events);

    assert.equal(report.intact, false);
    assert.deepEqual(
      report.unassigned.map((finding) => finding.kind),
      ["chain-id-missing"],
    );
  });

  test("an event without integrity cannot be assigned", () => {
    const event = structuredClone(buildChain(1)[0] as Event);
    delete event["integrity"];
    const report = verify([event]);

    assert.deepEqual(
      report.unassigned.map((finding) => finding.kind),
      ["integrity-missing"],
    );
  });

  test("a schema-invalid event cannot be assigned", () => {
    const event = structuredClone(buildChain(1)[0] as Event);
    delete event["actor"];
    const report = verify([event]);

    assert.deepEqual(
      report.unassigned.map((finding) => finding.kind),
      ["schema-invalid"],
    );
  });
});

describe("published chain fixtures", () => {
  test("the valid three-event chain is intact", () => {
    const report = verify(loadDirectory("valid", "three-event-chain"));
    assert.equal(report.intact, true);
    assert.equal(report.chains[0]?.eventCount, 3);
  });

  test("broken-previous-hash fails on the link, with every digest still valid", () => {
    const report = verify(loadDirectory("invalid", "broken-previous-hash"));
    assert.equal(report.intact, false);
    assert.deepEqual(chainKinds(report), ["broken-link"]);
    assert.ok(
      report.chains[0]?.checks.some((check) => check.message.includes("event digests valid")),
      "the fixture must demonstrate that per-event verification alone would pass",
    );
  });

  test("duplicate-sequence fails on the duplicate", () => {
    const report = verify(loadDirectory("invalid", "duplicate-sequence"));
    assert.equal(report.intact, false);
    assert.deepEqual(chainKinds(report), ["duplicate-sequence"]);
  });

  test("missing-sequence fails because the chain cannot be ordered", () => {
    const report = verify(loadDirectory("invalid", "missing-sequence"));
    assert.equal(report.intact, false);
    assert.ok(chainKinds(report).includes("sequence-missing"));
  });

  test("reordered-chain fails because sequence is part of the digest", () => {
    const report = verify(loadDirectory("invalid", "reordered-chain"));
    assert.equal(report.intact, false);
    assert.equal(chainKinds(report).filter((kind) => kind === "hash-mismatch").length, 2);
  });
});

describe("signatures in chains", () => {
  test("an unimplemented signature algorithm breaks the chain, with or without a key", () => {
    // Seal first, then attach the signature: `integrity.signature` is excluded
    // from the digest, so the hash stays valid and the signature alone fails.
    const events = buildChain(2);
    const signed = events[1] as Event;
    integrityOf(signed)["signature"] = {
      algorithm: "RSA-PSS-SHA256",
      value: "c2lnbmF0dXJlLXZhbHVlLW5vdC1jaGVja2FibGU=",
    };

    const report = verify(events);
    assert.equal(report.intact, false);
    assert.ok(chainKinds(report).includes("unsupported-signature-algorithm"));
  });
});
