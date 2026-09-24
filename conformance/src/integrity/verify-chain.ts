/**
 * Verification of previous-hash chains.
 *
 * Chain verification proves that the *supplied* set of events is internally
 * consistent. It cannot prove that the supplied set is complete: an attacker
 * who removes the tail of a chain, or who never let an event be produced,
 * leaves nothing for a verifier to find. See specification/integrity.md §8.
 */
import type { KeyObject } from "node:crypto";
import type { EventValidator } from "../validate-core.js";
import { digestsEqual } from "./digest.js";
import { verifyEventIntegrity, readIntegrity, schemaFailureMessage } from "./verify-event.js";
import type { ChainReport, ChainVerificationResult, Finding, Note, PassedCheck } from "./types.js";

/** One event offered for chain verification. */
export interface ChainEventInput {
  readonly label: string;
  readonly event: unknown;
}

interface ChainMember {
  readonly label: string;
  /**
   * What this event's own digest check found, kept instead of the event.
   *
   * A chain is a property of a set, so the members must be held until the last
   * one has arrived — but what has to be held is the link metadata and this
   * verdict, not the event that produced them. Keeping the event would make
   * the memory a run needs proportional to the size of the archive; keeping
   * this makes it proportional to the number of events in it.
   */
  readonly digestFindings: readonly Finding[];
  readonly sequence?: number;
  readonly hash?: string;
  readonly previousHash?: string;
  readonly hashAlgorithm?: string;
  readonly canonicalization?: string;
  readonly batchId?: string;
}

/** Which chains each `batchId` was seen in, across the whole supplied set. */
type BatchChains = ReadonlyMap<string, ReadonlySet<string>>;

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asSequence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function count(total: number, singular: string, plural = `${singular}s`): string {
  return `${total} ${total === 1 ? singular : plural}`;
}

/** "sequence 3", "sequences 1..3", or "sequences 1, 3" when the set has gaps. */
function describeSequences(members: readonly ChainMember[]): string {
  const sequences = [
    ...new Set(
      members.flatMap((member) => (member.sequence === undefined ? [] : [member.sequence])),
    ),
  ].sort((a, b) => a - b);
  const first = sequences[0];
  const last = sequences[sequences.length - 1];
  const unsequenced = members.length - members.filter((m) => m.sequence !== undefined).length;
  const suffix = unsequenced === 0 ? "" : `, ${count(unsequenced, "event")} without sequence`;

  if (first === undefined || last === undefined) {
    return `no sequence${suffix}`;
  }
  if (sequences.length === 1) {
    return `sequence ${first}${suffix}`;
  }
  const contiguous = last - first + 1 === sequences.length;
  return `sequences ${contiguous ? `${first}..${last}` : sequences.join(", ")}${suffix}`;
}

/** Orders members deterministically: by sequence, then by label for equal sequences. */
function compareMembers(left: ChainMember, right: ChainMember): number {
  const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  return left.label.localeCompare(right.label, "en");
}

function verifyOneChain(
  chainId: string,
  members: readonly ChainMember[],
  batchChains: BatchChains,
): ChainVerificationResult {
  const findings: Finding[] = [];
  const notes: Note[] = [];
  const checks: PassedCheck[] = [];

  // Every event's own digest must hold before its links mean anything. A
  // signature, when a key was supplied to check it, is verified alongside:
  // it covers the same canonicalized input as the hash, chain metadata
  // included, so a signed link is exactly as tamper-evident as a hashed one.
  let digestsValid = true;
  for (const member of members) {
    if (member.digestFindings.length > 0) {
      digestsValid = false;
      findings.push(...member.digestFindings);
    }
  }
  if (digestsValid && members.length > 0) {
    checks.push({ message: `all ${members.length} event digests valid` });
  }

  // A chain is only comparable if every member seals itself the same way: a
  // `previousHash` produced by a different algorithm can never equal the
  // predecessor's `hash`.
  const algorithms = new Set(members.map((member) => member.hashAlgorithm ?? "(none)"));
  const canonicalizations = new Set(members.map((member) => member.canonicalization ?? "(none)"));
  if (algorithms.size > 1 || canonicalizations.size > 1) {
    findings.push({
      kind: "algorithm-mismatch",
      message: "events in this chain do not share one hash algorithm and canonicalization",
      detail: [
        `hash algorithms: ${[...algorithms].sort().join(", ")}`,
        `canonicalizations: ${[...canonicalizations].sort().join(", ")}`,
      ],
    });
  }

  // Ordering is by `sequence`; without it there is no deterministic order.
  const withoutSequence = members.filter((member) => member.sequence === undefined);
  for (const member of withoutSequence) {
    findings.push({
      kind: "sequence-missing",
      label: member.label,
      message: "event declares no sequence, so it cannot be ordered within the chain",
    });
  }

  const ordered = [...members].sort(compareMembers);

  const bySequence = new Map<number, ChainMember[]>();
  for (const member of ordered) {
    if (member.sequence === undefined) {
      continue;
    }
    const bucket = bySequence.get(member.sequence);
    if (bucket === undefined) {
      bySequence.set(member.sequence, [member]);
    } else {
      bucket.push(member);
    }
  }

  for (const [sequence, bucket] of [...bySequence.entries()].sort((a, b) => a[0] - b[0])) {
    if (bucket.length > 1) {
      findings.push({
        kind: "duplicate-sequence",
        message: `sequence ${sequence} is declared by ${bucket.length} events`,
        detail: bucket.map((member) => member.label),
      });
    }
  }

  // Links are compared against the predecessor's *declared* hash. Every declared
  // hash has already been checked against a recalculated digest above, so this
  // is as strong as comparing against the recalculation while keeping a
  // modified event and a broken link reported as separate, locatable problems.
  const linkable = ordered.filter((member) => member.sequence !== undefined);
  let linksValid = true;

  for (const [index, member] of linkable.entries()) {
    if (index === 0) {
      if (member.previousHash !== undefined) {
        notes.push({
          message: "chain does not start at a genesis event",
          detail: [
            `first supplied event ${member.label} declares previousHash`,
            "the supplied set is a segment; the events before it were not verified",
          ],
        });
      }
      continue;
    }

    const predecessor = linkable[index - 1];
    if (predecessor === undefined) {
      continue;
    }

    if (member.previousHash === undefined) {
      linksValid = false;
      findings.push({
        kind: "previous-hash-missing",
        label: member.label,
        message: "event declares no previousHash but is not the first event in the chain",
      });
      continue;
    }

    if (predecessor.hash === undefined || !digestsEqual(member.previousHash, predecessor.hash)) {
      linksValid = false;
      findings.push({
        kind: "broken-link",
        label: member.label,
        message: "previousHash does not match the preceding event",
        detail: [
          `preceding event:       ${predecessor.label}`,
          `declared previousHash: ${member.previousHash}`,
          `preceding event hash:  ${predecessor.hash ?? "(none declared)"}`,
        ],
      });
    }
  }

  if (linksValid && linkable.length > 1) {
    checks.push({ message: `all ${linkable.length - 1} previous-hash links valid` });
  }
  if (linkable.length > 0 && linkable[0]?.previousHash === undefined) {
    checks.push({ message: "chain starts at a genesis event" });
  }

  // A gap is not a failure: the core model permits non-contiguous sequences, and
  // an event removed from the middle would break a link rather than only a gap.
  // Distinct values are used so that a duplicate is not also reported as a gap.
  const sequences = [...new Set(linkable.map((member) => member.sequence as number))].sort(
    (a, b) => a - b,
  );
  const first = sequences[0];
  const last = sequences[sequences.length - 1];
  if (first !== undefined && last !== undefined && last - first + 1 !== sequences.length) {
    notes.push({
      message: "sequence numbers are not contiguous",
      detail: [
        `observed: ${sequences.join(", ")}`,
        "the core model permits gaps; a removed event would also break a link",
      ],
    });
  }

  // Batches are reported, never judged. `integrity.batchId` names the group of
  // events that were sealed together (integrity.md §2.1); it is not a
  // verification scope, so nothing below touches the verdict. A batch that
  // also appears in another chain is stated for the same reason: it is a
  // fact about the supplied set, and only a claim that chains are batch-level
  // could make it a defect. See ADR 0013.
  const batches = new Map<string, ChainMember[]>();
  let unbatched = 0;
  for (const member of ordered) {
    if (member.batchId === undefined) {
      unbatched += 1;
      continue;
    }
    const bucket = batches.get(member.batchId);
    if (bucket === undefined) {
      batches.set(member.batchId, [member]);
    } else {
      bucket.push(member);
    }
  }
  if (batches.size > 0) {
    const detail = [...batches.entries()].map(([batchId, bucket]) => {
      const elsewhere = [...(batchChains.get(batchId) ?? [])]
        .filter((other) => other !== chainId)
        .sort((left, right) => left.localeCompare(right, "en"));
      const shared =
        elsewhere.length === 0
          ? ""
          : `; also declared in ${elsewhere.length === 1 ? "chain" : "chains"} ${elsewhere.join(", ")}`;
      return `${batchId}: ${count(bucket.length, "event")}, ${describeSequences(bucket)}${shared}`;
    });
    if (unbatched > 0) {
      detail.push(`${count(unbatched, "event")} declare${unbatched === 1 ? "s" : ""} no batchId`);
    }
    detail.push(
      "a batch is the group sealed together, not a verification scope; reported, not judged",
    );
    notes.push({
      message: `events declare ${count(batches.size, "sealing batch", "sealing batches")}`,
      detail,
    });
  }

  // The head is the value a published chain head or checkpoint names. It is
  // the declared hash, already checked against its recalculation above, and
  // is reported for a broken chain too: `intact` says what it is worth.
  const atHead = last === undefined ? undefined : bySequence.get(last);
  const headHash = atHead !== undefined && atHead.length === 1 ? atHead[0]?.hash : undefined;

  return {
    chainId,
    eventCount: members.length,
    ...(first === undefined ? {} : { firstSequence: first }),
    ...(last === undefined ? {} : { lastSequence: last }),
    ...(headHash === undefined ? {} : { headHash }),
    intact: findings.length === 0,
    checks,
    findings,
    notes,
  };
}

/**
 * Chains under construction, between the first event and the last.
 *
 * Chain verification cannot judge an event as it arrives: a link is a relation
 * between two events, and the second may be in another file. What it can do is
 * reduce each event to what the chain needs — its links, its ordering and the
 * verdict on its own digest — and let the event itself go. This holds that
 * reduction. See decision 0016.
 */
export interface ChainIntake {
  readonly validator: EventValidator;
  readonly publicKey: KeyObject | undefined;
  readonly unassigned: Finding[];
  readonly groups: Map<string, ChainMember[]>;
  eventCount: number;
}

export function startChainIntake(
  validator: EventValidator,
  publicKey?: KeyObject | undefined,
): ChainIntake {
  return {
    validator,
    publicKey,
    unassigned: [],
    groups: new Map<string, ChainMember[]>(),
    eventCount: 0,
  };
}

/** Reduces one event to its chain membership and releases it. */
export function addChainEvent(intake: ChainIntake, input: ChainEventInput): void {
  intake.eventCount += 1;
  {
    const issues = intake.validator.validateEvent(input.event);
    if (issues.length > 0) {
      const shown = issues.slice(0, 3).map((issue) => `${issue.path}  ${issue.message}`);
      intake.unassigned.push({
        kind: "schema-invalid",
        label: input.label,
        message: schemaFailureMessage(issues),
        detail:
          issues.length > shown.length
            ? [...shown, `and ${issues.length - shown.length} further schema issues`]
            : shown,
      });
      return;
    }

    const integrity = readIntegrity(input.event);
    if (integrity === undefined) {
      intake.unassigned.push({
        kind: "integrity-missing",
        label: input.label,
        message: "event carries no integrity object and cannot belong to a chain",
      });
      return;
    }

    const chainId = asString(integrity.chainId);
    if (chainId === undefined) {
      intake.unassigned.push({
        kind: "chain-id-missing",
        label: input.label,
        message: "event declares no integrity.chainId, so it cannot be assigned to a chain",
      });
      return;
    }

    // Every event's own digest must hold before its links mean anything, and
    // that is a property of the event alone — checked here, while the event is
    // in hand, rather than later from a copy of it. A signature, when a key was
    // supplied to check it, is verified alongside: it covers the same
    // canonicalized input as the hash, chain metadata included, so a signed
    // link is exactly as tamper-evident as a hashed one.
    const digest = verifyEventIntegrity(input.event, input.label, intake.validator, {
      validateSchema: false,
      publicKey: intake.publicKey,
    });

    const sequence = asSequence((input.event as Record<string, unknown>)["sequence"]);
    const hash = asString(integrity.hash);
    const previousHash = asString(integrity.previousHash);
    const hashAlgorithm = asString(integrity.hashAlgorithm);
    const canonicalization = asString(integrity.canonicalization);
    const batchId = asString(integrity.batchId);

    const member: ChainMember = {
      label: input.label,
      digestFindings: digest.verified ? [] : digest.findings,
      ...(sequence === undefined ? {} : { sequence }),
      ...(hash === undefined ? {} : { hash }),
      ...(previousHash === undefined ? {} : { previousHash }),
      ...(hashAlgorithm === undefined ? {} : { hashAlgorithm }),
      ...(canonicalization === undefined ? {} : { canonicalization }),
      ...(batchId === undefined ? {} : { batchId }),
    };

    const group = intake.groups.get(chainId);
    if (group === undefined) {
      intake.groups.set(chainId, [member]);
    } else {
      group.push(member);
    }
  }
}

/** Verifies the chains that the events seen so far have built. */
export function finishChains(intake: ChainIntake): ChainReport {
  const { groups, unassigned } = intake;

  const batchChains = new Map<string, Set<string>>();
  for (const [chainId, members] of groups) {
    for (const member of members) {
      if (member.batchId !== undefined) {
        const seen = batchChains.get(member.batchId);
        if (seen === undefined) {
          batchChains.set(member.batchId, new Set([chainId]));
        } else {
          seen.add(chainId);
        }
      }
    }
  }

  const chains = [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], "en"))
    .map(([chainId, members]) => verifyOneChain(chainId, members, batchChains));

  return {
    chains,
    unassigned,
    eventCount: intake.eventCount,
    intact: unassigned.length === 0 && chains.every((chain) => chain.intact),
  };
}

/**
 * Verifies every chain present in a set of events.
 *
 * Events are grouped by `integrity.chainId`; a set containing several chains is
 * verified as several independent chains, which is the intended model — a
 * single global chain is never required.
 *
 * The events are read once, in order, and released as they are read, so this
 * accepts anything iterable — an array in hand, or a reader still working
 * through a file.
 */
export function verifyChains(
  inputs: Iterable<ChainEventInput>,
  validator: EventValidator,
  publicKey?: KeyObject | undefined,
): ChainReport {
  const intake = startChainIntake(validator, publicKey);
  for (const input of inputs) {
    addChainEvent(intake, input);
  }
  return finishChains(intake);
}
