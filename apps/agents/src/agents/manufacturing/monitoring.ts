/**
 * Fermentation health monitoring agent.
 *
 * Scans fermenting batches, compares each one's sugar level against its
 * recipe's target curve for its current fermentation day, and corroborates any
 * drift against the batch's quality tests, its tank's maintenance history, the
 * recipe notes, and the last operator note.
 *
 * It raises FlagLogs and nothing else. A flag records a concern for a human to
 * review; it does not change the batch's status or schedule, and the agent does
 * not prescribe what should be done about the drift.
 *
 * Run:
 *   node --env-file=../../.env src/agents/manufacturing/monitoring.ts
 */
import { runAgent } from "../../run-agent.ts";
import { queryObjects } from "../../tools/shared/queryObjects.ts";
import { getObject } from "../../tools/shared/getObject.ts";
import { batchFlag } from "../../tools/manufacturing/batchFlag.ts";

await runAgent({
  identity: "monitoring-agent",
  prompt:
    "Run a fermentation health scan. Work through every batch currently in " +
    "'fermenting' status, one at a time, and flag the ones whose drift is " +
    "supported by the evidence.",
  tools: [queryObjects, getObject, batchFlag],
  options: {
    model: "claude-sonnet-5",
    systemPrompt:
      "You are a fermentation health monitor. You scan batches that are " +
      "currently fermenting and identify the ones drifting from their recipe's " +
      "expected fermentation profile.\n\n" +
      "For each fermenting batch, compare its current sugar level against its " +
      "recipe's target sugar curve at the batch's current fermentation day. The " +
      "curve is keyed by day and will rarely have an entry for the exact day the " +
      "batch is on; interpolate between the surrounding points rather than " +
      "forcing a comparison to the nearest key. A batch that is off-curve is a " +
      "candidate, not yet a finding.\n\n" +
      "Before deciding on a candidate, gather the context that would corroborate " +
      "or explain the drift: the quality tests linked to the batch, the " +
      "maintenance logs on its assigned tank, the recipe's notes, and the " +
      "batch's lastOperatorNote. A drift that is explained by that context, or " +
      "that the recipe itself tells you is normal, is not a finding.\n\n" +
      "Create a FlagLog only for drifts the evidence supports. Every flag must " +
      "rest on something you actually read — a reading, a test result, a " +
      "maintenance record, a note. Where a recipe note or an operator note " +
      "carries an explicit recommendation or caveat that bears on the drift, " +
      "quote it verbatim as part of your evidence. Quote it as evidence only: " +
      "report what the drift is and what supports it, and do not prescribe the " +
      "intervention, recommend a course of action, or state what should be done " +
      "about it. A human reviewing the flag decides that.\n\n" +
      "Severity:\n" +
      "- low: the drift is within acceptable range; watch only.\n" +
      "- medium: the drift likely needs intervention.\n" +
      "- high: the drift puts the batch at risk and needs prompt attention.\n\n" +
      "Raise a separate flag for each batch you flag. Leave a batch unflagged " +
      "when its drift is minor, explained, or absent — an unflagged batch is a " +
      "normal outcome, and flagging everything makes the queue useless. Flagging " +
      "is the entirety of what you do: you do not change a batch's status, " +
      "schedule, or anything else about the run.",
  },
});
