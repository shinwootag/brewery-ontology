/**
 * Ingredient delivery disruption agent.
 *
 * Given a supplier notice that an ingredient's delivery is delayed, it works
 * through the upcoming batches that depend on that ingredient and, per batch,
 * decides whether to propose a cancel, a deferral, or to leave it alone. It
 * acts ONLY by filing proposals through its propose_* tools — every real change
 * is gated behind a human reviewer who approves or rejects the proposal.
 *
 * Run:
 *   node --env-file=../../.env src/agents/manufacturing/ingredientDeliveryDisruption.ts
 */
import { runAgent } from "../../run-agent.ts";
import { queryObjects } from "../../tools/shared/queryObjects.ts";
import { getObject } from "../../tools/shared/getObject.ts";
import { proposeBatchCancel } from "../../tools/manufacturing/proposeBatchCancel.ts";
import { proposeBatchDeferStart } from "../../tools/manufacturing/proposeBatchDeferStart.ts";

const DISRUPTION_NOTICE = `Supplier notification: Your Citra order due this week has been disrupted by a short harvest allocation. We can confirm a partial shipment enough for roughly one 150 hL brew, arriving May 15. The remainder of the order cannot be confirmed this contract year; we will notify you if allocation opens up, but we cannot commit to a date.`;

await runAgent({
  identity: "ingredient-delivery-disruption-agent",
  prompt: `Process the following ingredient delivery disruption notice. Work through the upcoming batches that depend on the affected ingredient and decide, for each, whether to propose a cancel, propose a deferral, or leave it as planned.\n\n${DISRUPTION_NOTICE}`,
  tools: [queryObjects, getObject, proposeBatchCancel, proposeBatchDeferStart],
  options: {
    model: "claude-sonnet-5",
    systemPrompt:
      "You are an ingredient delivery disruption agent. When an ingredient's " +
      "delivery is delayed, you work through the upcoming batches that depend " +
      "on it and decide, for each one, whether it should be cancelled, deferred " +
      "until supply recovers, or left as planned. Before deciding on a batch, " +
      "query the ontology to understand its state — its recipe, how central the " +
      "delayed ingredient is to it, its volume, and how far along it is. You act " +
      "only by creating proposals through your propose_* tools. You do not " +
      "approve, reject, or carry out actions yourself; creating a proposal is " +
      "where your work ends, and a human reviewer decides what actually happens. " +
      "Make a separate proposal for each batch you want to act on, and explain " +
      "your reasoning in each. Leave a batch alone when no action is warranted.",
  },
});
