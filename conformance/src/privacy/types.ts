/**
 * Shared types for privacy linting.
 *
 * A **privacy finding** is a suspicion raised by deterministic static analysis.
 * It is not proof of a data breach, a regulatory violation, a confirmed
 * credential or confirmed personal data, and the absence of findings is not
 * proof that an event is safe or compliant. See specification/privacy.md §6.
 */

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type Confidence = "low" | "medium" | "high";

export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

/** One suspected privacy or secret-exposure risk. Never carries the offending value. */
export interface PrivacyFinding {
  /** Stable rule identifier, such as `OAM-PRIV-001`. */
  readonly ruleId: string;
  /** How serious the risk would be if the suspicion is correct. */
  readonly severity: Severity;
  /** How confident the rule is that the suspicion is correct. */
  readonly confidence: Confidence;
  /** JSON Pointer to the offending location inside the event. */
  readonly path: string;
  /** One line describing what was observed. Never contains the observed value. */
  readonly message: string;
  /** Coarse grouping of the rule. */
  readonly category?: string;
  /** What to do about it. */
  readonly recommendation?: string;
  /** File the event was read from. Added by the command layer. */
  readonly sourceFile?: string;
  /** `id` of the event the finding belongs to. */
  readonly eventId?: string;
}

export type LintStatus = "clean" | "findings" | "schema-invalid";

/** Outcome of linting one event. */
export interface EventLintResult {
  readonly label: string;
  readonly eventId?: string;
  readonly status: LintStatus;
  readonly findings: readonly PrivacyFinding[];
  /**
   * Rendered schema issues, present only when the event failed validation.
   * Deep linting is not attempted for a malformed event, because traversing an
   * arbitrary structure produces findings whose paths mean nothing.
   */
  readonly schemaIssues: readonly string[];
}

/** Counts for a run, for the summary line and the JSON report. */
export interface LintSummary {
  readonly events: number;
  readonly clean: number;
  readonly withFindings: number;
  readonly schemaInvalid: number;
  readonly findings: number;
  readonly bySeverity: Readonly<Record<Severity, number>>;
  /**
   * Findings per rule category, most findings first.
   *
   * Severity says how bad one finding would be; category says what kind of
   * mistake produced it, which is what an instrumentation fix is organised
   * around. Fifty findings that are all one category are one afternoon's work;
   * fifty spread across nine are a different problem.
   *
   * A rule that declares no category is counted under `uncategorised` rather
   * than dropped, so the category counts always sum to `findings`.
   */
  readonly byCategory: readonly CategoryCount[];
}

/** Findings attributed to one rule category. */
export interface CategoryCount {
  readonly category: string;
  readonly findings: number;
}

/** Category recorded for a finding whose rule declares none. */
export const UNCATEGORISED = "uncategorised";

export function emptySeverityCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

/**
 * Counts results one at a time.
 *
 * A command that reads its events as a stream never holds them all, and it
 * must not hold every result either, or it has only moved the problem. It
 * counts into a tally instead and keeps nothing but the counts.
 */
export interface LintTally {
  events: number;
  clean: number;
  withFindings: number;
  schemaInvalid: number;
  findings: number;
  readonly bySeverity: Record<Severity, number>;
  readonly categories: Map<string, number>;
}

export function startLintTally(): LintTally {
  return {
    events: 0,
    clean: 0,
    withFindings: 0,
    schemaInvalid: 0,
    findings: 0,
    bySeverity: emptySeverityCounts(),
    categories: new Map<string, number>(),
  };
}

export function addToLintTally(tally: LintTally, result: EventLintResult): void {
  tally.events += 1;
  if (result.status === "clean") {
    tally.clean += 1;
  } else if (result.status === "findings") {
    tally.withFindings += 1;
  } else if (result.status === "schema-invalid") {
    tally.schemaInvalid += 1;
  }

  for (const finding of result.findings) {
    tally.bySeverity[finding.severity] += 1;
    const category = finding.category ?? UNCATEGORISED;
    tally.categories.set(category, (tally.categories.get(category) ?? 0) + 1);
    tally.findings += 1;
  }
}

export function finishLintTally(tally: LintTally): LintSummary {
  return {
    events: tally.events,
    clean: tally.clean,
    withFindings: tally.withFindings,
    schemaInvalid: tally.schemaInvalid,
    findings: tally.findings,
    bySeverity: { ...tally.bySeverity },
    byCategory: [...tally.categories.entries()]
      .map(([category, count]) => ({ category, findings: count }))
      .sort(
        (left, right) =>
          right.findings - left.findings || left.category.localeCompare(right.category, "en"),
      ),
  };
}

/** Summarises a set of results. The same count, over an array already in hand. */
export function summarise(results: readonly EventLintResult[]): LintSummary {
  const tally = startLintTally();
  for (const result of results) {
    addToLintTally(tally, result);
  }
  return finishLintTally(tally);
}
