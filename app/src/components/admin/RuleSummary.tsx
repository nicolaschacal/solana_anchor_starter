import { Activity, Apple, Clock3, Dna, Dumbbell, Flag, HelpCircle, LockKeyhole, Sparkles } from "lucide-react";
import {
  GROUPS,
  METRICS,
  OPERATORS,
  type EvolutionPath,
} from "../../lib/rebyters/types";
import type { BalanceProfile, RuleGroup } from "../../lib/rebyters/rule-types";
import { conditionLabel, resolvedLabel } from "../../lib/rebyters/rules";

const groupIcon = (group: number) => {
  const icons = [Dna, Apple, Clock3, Activity, Dumbbell];
  const Icon = icons[group] ?? HelpCircle;
  return <Icon size={13} aria-hidden="true" />;
};

function summary(group: RuleGroup, balance: BalanceProfile) {
  const conditions = group.alternatives.flat();
  if (
    group.group === 0 &&
    conditions.length &&
    conditions.every(
      (c) =>
        c.metrics.length === 1 &&
        c.test === conditions[0].test &&
        c.level === conditions[0].level &&
        c.value === conditions[0].value &&
        c.test === "min",
    )
  ) {
    const alternatives = group.alternatives.map((a) =>
      a.map((c) => balance.metrics[c.metrics[0]].label),
    );
    const common = alternatives[0].filter((label) =>
      alternatives.every((a) => a.includes(label)),
    );
    const remaining = alternatives.map((a) =>
      a.filter((label) => !common.includes(label)).join(" + "),
    );
    const rest = remaining.includes("") ? [] : remaining;
    const expression = [
      ...common,
      ...(rest.length
        ? [
            rest.length > 1 && common.length
              ? `(${rest.join(" / ")})`
              : rest.join(" / "),
          ]
        : []),
    ].join(" + ");
    const threshold = conditionLabel(conditions[0], balance)
      .split(": ")
      .slice(1)
      .join(": ");
    return `${expression}: ${threshold}`;
  }
  const mixed =
    group.group === 1
      ? group.alternatives.filter(
          (a) =>
            a.length === 2 &&
            a[0].metrics[0] !== a[1].metrics[0] &&
            a.every(
              (c) =>
                c.metrics.length === 1 &&
                c.metrics[0].startsWith("diet.") &&
                c.level === "low" &&
                c.test === "min",
            ),
        )
      : [];
  const allMixedPairs =
    mixed.length === 6 &&
    new Set(mixed.flatMap((a) => a.map((c) => c.metrics[0]))).size === 4 &&
    new Set(
      mixed.map((a) =>
        a
          .map((c) => c.metrics[0])
          .sort()
          .join("+"),
      ),
    ).size === 6;
  const alternatives = allMixedPairs
    ? group.alternatives.filter((a) => !mixed.includes(a))
    : group.alternatives;
  return [
    ...alternatives.map((a) =>
      a.map((c) => conditionLabel(c, balance)).join(" AND "),
    ),
    ...(allMixedPairs ? ["Mixed diet: any 2 foods at Low+"] : []),
  ].join(" OR ");
}
export function compactRuleLines(
  path: EvolutionPath,
  balance?: BalanceProfile,
): string[] {
  if (!path.rule || !balance) {
    if (path.requirements?.length)
      return [
        `${path.requiredGroupCount || "All"} categories`,
        ...path.requirements.map(
          (r) =>
            `${METRICS[r.group]?.[r.metric] ?? "Metric"} ${OPERATORS[r.operator]} ${r.value}`,
        ),
      ];
    if (path.designRule) {
      const design = path.designRule;
      const groups = [
        "Genetics",
        "Diet",
        "Time",
        "Activity",
        "Physical",
      ].flatMap((label) => {
        const value = design[`${label} group`];
        return value && value !== "any" ? [`${label}: ${value}`] : [];
      });
      return [
        "Design requirements (not active)",
        `${design["Required groups"]} of ${groups.length} categories`,
        ...(design["Mandatory gate"] && design["Mandatory gate"] !== "none"
          ? [`Required: ${design["Mandatory gate"]}`]
          : []),
        ...(Number(design["Min cycle"]) > 0
          ? [`Cycles: ${design["Min cycle"]}+`]
          : []),
        ...groups,
      ];
    }
    return ["No requirements"];
  }
  const rule = path.rule;
  const shorten = (value: string) =>
    value
      .replaceAll("Very high", "V.High")
      .replaceAll("Medium", "Med")
      .replaceAll(" AND ", " + ")
      .replaceAll(" OR ", " / ")
      .replaceAll("Completed lives", "Cycles");
  return [
    `${rule.requiredGroups}/${rule.groups.length} categories`,
    ...rule.mandatory.map(
      (c) => `Required: ${shorten(conditionLabel(c, balance))}`,
    ),
    ...rule.groups.map((g) => shorten(summary(g, balance))),
  ];
}
export function RuleSummary({
  path,
  balance,
  stage,
}: {
  path: EvolutionPath;
  balance?: BalanceProfile;
  stage: number;
}) {
  if (!path.rule || !balance)
    return (
      <p className="rule-unconfigured">
        Requirements not configured for this version.
      </p>
    );
  const rule = path.rule;
  return (
    <div className="rule-summary">
      <div className="rule-summary-head">
        <strong className="rule-qualification">
          <Flag size={13} aria-hidden="true" />
          At least {rule.requiredGroups} of {rule.groups.length} categories
        </strong>
        <span
          className="rule-help"
          tabIndex={0}
          aria-label="How evolution requirements work"
          title="Each category passes when one of its alternatives is satisfied. The Rebyter can evolve when at least the required number of categories pass, plus every Mandatory condition. Optional affinities help describe the route but are not required."
        >
          <HelpCircle size={14} />
        </span>
      </div>
      {rule.mandatory.length > 0 && (
        <div className="rule-gates">
          <strong>
            <LockKeyhole size={11} />
            Mandatory
          </strong>
          {rule.mandatory.map((c, i) => (
            <span key={i} title={resolvedLabel(c, balance, stage)}>
              {conditionLabel(c, balance)}
            </span>
          ))}
        </div>
      )}
      <dl>
        {rule.groups.map((g) => (
          <div key={g.group}>
            <dt><span className="rule-group-icon">{groupIcon(g.group)}</span>{GROUPS[g.group]}</dt>
            <dd
              title={g.alternatives
                .map((a) =>
                  a.map((c) => resolvedLabel(c, balance, stage)).join(" AND "),
                )
                .join(" OR ")}
            >
              {summary(g, balance)}
            </dd>
          </div>
        ))}
      </dl>
      {rule.bonuses.length > 0 && (
        <p className="rule-bonus">
          <Sparkles size={12} aria-hidden="true" />
          Optional: {rule.bonuses.map((c) => conditionLabel(c, balance)).join("; ")}
        </p>
      )}
    </div>
  );
}
