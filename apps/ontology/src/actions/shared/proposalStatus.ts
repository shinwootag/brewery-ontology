/**
 * Shared status rules for the Proposal decision actions.
 *
 * Kept in one place so approve/reject/escalate cannot drift apart — the whole
 * point of the escalated lane is that an escalated proposal is still decidable.
 */

/**
 * Statuses a proposal can still be approved or rejected from.
 *
 * `escalated` is deliberately included: escalation parks a proposal for a human
 * to resolve, it does not close it. `approved` and `rejected` are terminal.
 */
export const DECIDABLE_STATUSES = new Set(["pending", "escalated"]);

/** Statuses a proposal can be escalated from. Escalating is a first move on an
 *  undecided proposal; re-escalating would overwrite the standing concern. */
export const ESCALATABLE_STATUSES = new Set(["pending"]);

/** Human-readable list for error messages, e.g. `"pending" or "escalated"`. */
export function describeStatuses(statuses: Set<string>): string {
  return [...statuses].map((s) => `"${s}"`).join(" or ");
}
