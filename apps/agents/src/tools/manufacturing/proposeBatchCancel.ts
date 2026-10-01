/**
 * `propose_batch_cancel` — files a Proposal (not a direct action) to cancel a
 * batch. It POSTs to the generic create route with type `proposal`, leaving the
 * proposal `pending` for a human to approve/reject. Approving it later triggers
 * the underlying `batch.cancel` action.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";
const PROPOSED_BY = "ingredient-delivery-disruption-agent";

export const proposeBatchCancel = tool(
  "propose_batch_cancel",
  "Propose cancelling a batch for human review. Does NOT cancel the batch " +
    "directly — it files a pending Proposal that a reviewer must approve. On " +
    "approval, the underlying batch.cancel action runs. Returns the Proposal id.",
  {
    batch_id: z.string().describe("The batch's domain id, e.g. 'B-2118'."),
    reason: z
      .string()
      .describe("The reason to record on the cancel action itself."),
    rationale: z
      .string()
      .describe("Your reasoning/case for why this cancel should be approved."),
  },
  async (args) => {
    const proposedAt = process.env.COURSE_NOW ?? new Date().toISOString();
    const res = await fetch(`${ONTOLOGY_URL}/api/objects/proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "batch.cancel", // exact case-sensitive handler key
        targetId: args.batch_id,
        params: { reason: args.reason }, // action-specific params only
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
            text: `propose_batch_cancel failed (${res.status}): ${text}`,
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
              ? `Created proposal ${proposalId} (batch.cancel on ${args.batch_id}, pending review).`
              : text,
        },
      ],
    };
  },
);
