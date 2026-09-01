/**
 * Coverage: what a profile reached across a set of events.
 *
 * `check-profile` answers "does this event conform?". This answers a different
 * question, and confusing the two is the mistake it exists to prevent: **how
 * much of this profile is my instrumentation actually exercising?**
 *
 * A pipeline that runs `check-profile` over an export and sees no violations
 * has learned almost nothing if every event was `not-applicable`. That is the
 * real state of a producer whose event names sit outside the profile's
 * vocabulary, and it is indistinguishable from success in a summary line that
 * only counts failures.
 *
 * **It counts events, not obligations.** "4 of 15 rules were selected" is a
 * statement about this event set, never a percentage of conformance, a maturity
 * score or a grade. A profile is not a checklist to be completed: most rules do
 * not apply to most events, and a low number is the normal state of a narrow
 * export rather than a defect.
 *
 * Two distinctions carry most of the value here.
 *
 * **Selected is not applied.** A rule with a `when` condition is selected by an
 * event's name and then contributes nothing, because the condition did not
 * hold. `INC-CLOSE-001` requires an approval when
 * `/metadata/incident/approvalRequired` is true — against a producer that never
 * writes that flag it is selected on every closure and applied on none. Nothing
 * fails, and nothing is checked. Reporting only selection would present that as
 * coverage.
 *
 * **Ungoverned names are the finding.** The event names a profile did not
 * govern are what tell a producer that its vocabulary and the profile's have
 * not met, which no per-event verdict shows.
 */
import { conditionHolds } from "./evaluate-rule.js";
import { eventName, selectRules } from "./select-rules.js";
import {
  summariseProfileResults,
  type ProfileCheckResult,
  type ProfileCheckSummary,
  type ProfileDefinition,
  type RuleSeverity,
} from "./types.js";

/** What one rule did across the event set. */
export interface RuleCoverage {
  readonly ruleId: string;
  readonly severity: RuleSeverity;
  /** Events whose name this rule's selector matched. */
  readonly selected: number;
  /**
   * Events where the rule contributed requirements. Lower than `selected` when
   * a `when` condition did not hold; equal when the rule has no condition.
   */
  readonly applied: number;
  /** Events where the rule produced at least one error-severity finding. */
  readonly failed: number;
}

/** What one event name did, and whether the profile governs it at all. */
export interface EventNameCoverage {
  readonly name: string;
  readonly events: number;
  readonly governed: boolean;
}

export interface ProfileCoverage {
  readonly profile: {
    readonly name: string;
    readonly version: string;
    readonly status: string;
  };
  readonly events: ProfileCheckSummary;
  readonly rules: {
    readonly total: number;
    /** Rules whose selector matched at least one event. */
    readonly selected: number;
    /** Rules that contributed requirements to at least one event. */
    readonly applied: number;
    /** Rule ids no event in this set selected, in definition order. */
    readonly neverSelected: readonly string[];
    /**
     * Rule ids that were selected by an event and applied to none, in
     * definition order. Every one of these is a requirement that looked
     * enforced and was not.
     */
    readonly selectedButNeverApplied: readonly string[];
  };
  readonly perRule: readonly RuleCoverage[];
  /** Every distinct event name in the set, most frequent first. */
  readonly names: readonly EventNameCoverage[];
  readonly nameTotals: {
    readonly distinct: number;
    readonly governed: number;
    readonly ungoverned: number;
  };
}

/**
 * Summarises what a profile reached across already-checked events.
 *
 * The events are re-read here rather than threaded through
 * {@link ProfileCheckResult}, because selection and condition evaluation are
 * the two facts coverage is about and a check result records neither. Nothing
 * is re-validated: the core verdict already in each result is what decides
 * whether an event's rules were evaluated at all.
 */
export function summariseCoverage(
  events: readonly unknown[],
  results: readonly ProfileCheckResult[],
  profile: ProfileDefinition,
): ProfileCoverage {
  const selected = new Map<string, number>();
  const applied = new Map<string, number>();
  const failed = new Map<string, number>();
  const nameCounts = new Map<string, number>();
  const governedNames = new Set<string>();

  for (const rule of profile.rules) {
    selected.set(rule.id, 0);
    applied.set(rule.id, 0);
    failed.set(rule.id, 0);
  }

  for (const [index, event] of events.entries()) {
    const result = results[index];
    const name = eventName(event);
    if (name !== undefined) {
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }

    // A core-invalid event had no rule evaluated against it, so counting its
    // name as governed would credit the profile with a check it never made.
    if (result === undefined || result.status === "core-invalid" || name === undefined) {
      continue;
    }

    const rules = selectRules(profile, name);
    if (rules.length > 0) {
      governedNames.add(name);
    }

    const failing = new Set(result.errors.map((finding) => finding.ruleId));
    for (const rule of rules) {
      selected.set(rule.id, (selected.get(rule.id) ?? 0) + 1);
      if (rule.when === undefined || conditionHolds(event, rule.when)) {
        applied.set(rule.id, (applied.get(rule.id) ?? 0) + 1);
      }
      if (failing.has(rule.id)) {
        failed.set(rule.id, (failed.get(rule.id) ?? 0) + 1);
      }
    }
  }

  const perRule: RuleCoverage[] = profile.rules.map((rule) => ({
    ruleId: rule.id,
    severity: rule.severity ?? "error",
    selected: selected.get(rule.id) ?? 0,
    applied: applied.get(rule.id) ?? 0,
    failed: failed.get(rule.id) ?? 0,
  }));

  const names: EventNameCoverage[] = [...nameCounts.entries()]
    .map(([name, count]) => ({ name, events: count, governed: governedNames.has(name) }))
    .sort((left, right) => right.events - left.events || left.name.localeCompare(right.name, "en"));

  return {
    profile: { name: profile.name, version: profile.version, status: profile.status },
    events: summariseProfileResults(results),
    rules: {
      total: profile.rules.length,
      selected: perRule.filter((rule) => rule.selected > 0).length,
      applied: perRule.filter((rule) => rule.applied > 0).length,
      neverSelected: perRule.filter((rule) => rule.selected === 0).map((rule) => rule.ruleId),
      selectedButNeverApplied: perRule
        .filter((rule) => rule.selected > 0 && rule.applied === 0)
        .map((rule) => rule.ruleId),
    },
    perRule,
    names,
    nameTotals: {
      distinct: names.length,
      governed: names.filter((entry) => entry.governed).length,
      ungoverned: names.filter((entry) => !entry.governed).length,
    },
  };
}
