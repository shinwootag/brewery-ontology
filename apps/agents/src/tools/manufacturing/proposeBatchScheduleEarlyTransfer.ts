/**
 * `propose_batch_schedule_early_transfer` — files a Proposal (not a direct
 * action) to advance a batch's transfer. It POSTs to the generic create route
 * with type `proposal`, leaving the proposal `pending` for a human to
 * approve/reject. Approving it later triggers `batch.scheduleEarlyTransfer`.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";
const PROPOSED_BY = "planning-agent";

export const proposeBatchScheduleEarlyTransfer = tool(
  "propose_batch_schedule_early_transfer",
  "Propose moving a batch's transfer earlier, advancing it toward the next " +
    "stage ahead of schedule. This is the intervention for when remaining in " +
    "the current vessel and conditions is itself the risk. Does NOT change the " +
    "batch directly — it files a pending Proposal that a reviewer must approve. " +
    "On approval, the underlying batch.scheduleEarlyTransfer action runs, " +
    "rewriting this batch's planned transfer date and nothing else. It does not " +
    "check whether a destination vessel is free at the new time, does not " +
    "reserve one, and does not move whatever currently occupies it — approval " +
    "is not confirmation that the earlier slot is available. Returns the " +
    "Proposal id.",
  {
    batch_id: z.string().describe("The batch's domain id, e.g. 'B-2105'."),
    planned_at: z
      .string()
      .describe(
        "New planned transfer as an ISO 8601 date-time (e.g. " +
          "'2026-05-02T09:00:00Z'). Must be in the future and earlier than the " +
          "batch's current planned transfer date.",
      ),
    rationale: z
      .string()
      .describe(
        "Your reasoning/case for why this early transfer should be approved, " +
          "and the evidence it rests on.",
      ),
  },
  async (args) => {
    const proposedAt = process.env.COURSE_NOW ?? new Date().toISOString();
    const res = await fetch(`${ONTOLOGY_URL}/api/objects/proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "batch.scheduleEarlyTransfer", // exact case-sensitive handler key
        targetId: args.batch_id,
        params: { plannedAt: args.planned_at }, // action-specific params only
        rationale: args.rationale,
        status: "pending",
        proposedBy: PROPOSED_BY,
        proposedAt,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        content: [
          {
            type: "text",
            text: `propose_batch_schedule_early_transfer failed (${res.status}): ${text}`,
          },
        ],
        isError: true,
      };
    }

    let proposalId: unknown;
    try {
      proposalId = JSON.parse(text).id;
    } catch {
      proposalId = undefined;
    }

    return {
      content: [
        {
          type: "text",
          text:
            proposalId != null
              ? `Created proposal ${proposalId} (batch.scheduleEarlyTransfer on ${args.batch_id}, pending review).`
              : text,
        },
      ],
    };
  },
);
