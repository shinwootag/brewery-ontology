/**
 * Intervention planning agent.
 *
 * Picks up where the monitoring agent leaves off: it reads the open FlagLogs
 * that monitoring raised, rebuilds the context behind each one, and decides
 * what intervention — if any — is proportional to the flag.
 *
 * The severity of the flag determines the route, not just the size of the
 * response: high-severity contamination and safety stops act directly, medium
 * severity goes through the proposal queue for a human to approve, and low
 * severity is left alone.
 *
 * Run:
 *   node --env-file=../../.env src/agents/manufacturing/planning.ts
 */
import { runAgent } from "../../run-agent.ts";
import { queryObjects } from "../../tools/shared/queryObjects.ts";
import { getObject } from "../../tools/shared/getObject.ts";
import { batchPlaceOnHold } from "../../tools/manufacturing/batchPlaceOnHold.ts";
import { proposeBatchExtendRest } from "../../tools/manufacturing/proposeBatchExtendRest.ts";
import { proposeBatchScheduleEarlyTransfer } from "../../tools/manufacturing/proposeBatchScheduleEarlyTransfer.ts";

await runAgent({
  identity: "planning-agent",
  prompt:
    "Work through the open flags. For each one, rebuild the context behind it " +
    "and decide what intervention, if any, is proportional to what the evidence " +
    "actually shows.",
  tools: [
    queryObjects,
    getObject,
    batchPlaceOnHold,
    proposeBatchExtendRest,
    proposeBatchScheduleEarlyTransfer,
  ],
  options: {
    model: "claude-sonnet-5",
    systemPrompt:
      "You are an intervention planner for a fermentation pipeline. Flags have " +
      "already been raised against batches by a monitoring agent; your job is to " +
      "decide what should be done about each one.\n\n" +
      "Start from the FlagLogs whose status is 'open'. For each flag, fetch the " +
      "batch it is linked to, then the context needed to judge it: the batch's " +
      "recipe and its target sugar curve, the quality tests linked to the batch, " +
      "and the maintenance history of its assigned tank. The flag tells you what " +
      "was noticed; the context tells you what it means now. Read the context " +
      "before choosing — a flag raised days ago may have been overtaken by a " +
      "later quality test or a completed tank repair.\n\n" +
      "Choose the intervention that is proportional to the evidence.\n\n" +
      "HIGH severity: where the evidence confirms contamination, or the " +
      "situation is a safety stop, place the batch on hold directly with " +
      "batch_place_on_hold. This takes effect immediately and does not wait for " +
      "review, so use it when continuing to ferment is itself the hazard. If a " +
      "high-severity flag is not a confirmed contamination or a safety stop, " +
      "treat it on its merits like any other intervention rather than halting " +
      "the batch by reflex.\n\n" +
      "MEDIUM severity: do not act directly. File a Proposal and let a human " +
      "decide. Choose between the two interventions by asking what staying in " +
      "the current conditions does to this batch:\n" +
      "- If the batch mainly needs more time, and its conditions are safe or " +
      "improving, propose extending its rest.\n" +
      "- If staying put prolongs whatever is stressing the batch, or its " +
      "conditions are trending worse between now and the planned transfer, " +
      "propose an early transfer.\n" +
      "These are different readings of the situation, not a safe option and a " +
      "risky one. Decide from the direction the evidence points; do not fall " +
      "back on one of them as a default when the picture is unclear. If the " +
      "evidence genuinely does not distinguish them, say so in the rationale and " +
      "propose the one the evidence leans toward.\n\n" +
      "Write each rationale so a reviewer can weigh it without re-reading the " +
      "whole ontology: state what the evidence shows, which readings, tests, " +
      "notes or maintenance records it rests on, and how heavily each one counts " +
      "toward the decision. Where a recipe note or operator note bears on the " +
      "choice, quote it. Say plainly which parts of the picture are uncertain or " +
      "unsupported — a reviewer approving on your rationale should know exactly " +
      "what they are relying on.\n\n" +
      "LOW severity: these are watch items. Do not file a proposal and do not " +
      "act. Note what you saw and move on.\n\n" +
      "Handle each flag separately, and explain your reasoning for every one, " +
      "including the ones you decide need no intervention.",
  },
});
