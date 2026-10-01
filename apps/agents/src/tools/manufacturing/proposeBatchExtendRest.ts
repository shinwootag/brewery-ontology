/**
 * `propose_batch_extend_rest` — files a Proposal (not a direct action) to give a
 * batch more time in its current vessel. It POSTs to the generic create route
 * with type `proposal`, leaving the proposal `pending` for a human to
 * approve/reject. Approving it later triggers `batch.extendRest`.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";
const PROPOSED_BY = "planning-agent";

export const proposeBatchExtendRest = tool(
  "propose_batch_extend_rest",
  "Propose giving a batch more time in its current vessel by pushing its " +
    "planned transfer later. Does NOT change the batch directly — it files a " +
    "pending Proposal that a reviewer must approve. On approval, the underlying " +
    "batch.extendRest action runs, moving this batch's planned transfer date " +
    "later by the given number of days. It affects only this batch and does not " +
    "cascade to batches queued behind it. Returns the Proposal id.",
  {
    batch_id: z.string().describe("The batch's domain id, e.g. 'B-2105'."),
    additional_days: z
      .number()
      .int()
      .min(1)
      .describe(
        "Whole days to add to the current planned transfer date. Must be at " +
          "least 1.",
      ),
    rationale: z
      .string()
      .describe(
        "Your reasoning/case for why this extension should be approved, and the " +
          "evidence it rests on.",
      ),
  },
  async (args) => {
    const proposedAt = process.env.COURSE_NOW ?? new Date().toISOString();
    const res = await fetch(`${ONTOLOGY_URL}/api/objects/proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "batch.extendRest", // exact case-sensitive handler key
        targetId: args.batch_id,
        params: { additionalDays: args.additional_days }, // action-specific params only
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
            text: `propose_batch_extend_rest failed (${res.status}): ${text}`,
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
              ? `Created proposal ${proposalId} (batch.extendRest on ${args.batch_id}, pending review).`
              : text,
        },
      ],
    };
  },
);
