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

/** Summarises a set of results. */
export function summarise(results: readonly EventLintResult[]): LintSummary {
  const bySeverity = emptySeverityCounts();
  const categories = new Map<string, number>();
  let findings = 0;

  for (const result of results) {
    for (const finding of result.findings) {
      bySeverity[finding.severity] += 1;
      const category = finding.category ?? UNCATEGORISED;
      categories.set(category, (categories.get(category) ?? 0) + 1);
      findings += 1;
    }
  }

  return {
    events: results.length,
    clean: results.filter((result) => result.status === "clean").length,
    withFindings: results.filter((result) => result.status === "findings").length,
    schemaInvalid: results.filter((result) => result.status === "schema-invalid").length,
    findings,
    bySeverity,
    byCategory: [...categories.entries()]
      .map(([category, count]) => ({ category, findings: count }))
      .sort(
        (left, right) =>
          right.findings - left.findings || left.category.localeCompare(right.category, "en"),
      ),
  };
}
