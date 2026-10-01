/**
 * `propose_batch_defer_start` — files a Proposal (not a direct action) to defer
 * a batch's planned start. It POSTs to the generic create route with type
 * `proposal`, leaving the proposal `pending` for a human to approve/reject.
 * Approving it later triggers the underlying `batch.deferStart` action.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";
const PROPOSED_BY = "ingredient-delivery-disruption-agent";

export const proposeBatchDeferStart = tool(
  "propose_batch_defer_start",
  "Propose deferring a batch's planned start for human review. Does NOT change " +
    "the batch directly — it files a pending Proposal that a reviewer must " +
    "approve. On approval, the underlying batch.deferStart action runs. Returns " +
    "the Proposal id.",
  {
    batch_id: z.string().describe("The batch's domain id, e.g. 'B-2126'."),
    new_planned_start: z
      .string()
      .describe(
        "New planned start as an ISO 8601 date-time (e.g. '2026-05-10T09:00:00Z').",
      ),
    rationale: z
      .string()
      .describe("Your reasoning/case for why this deferral should be approved."),
  },
  async (args) => {
    const proposedAt = process.env.COURSE_NOW ?? new Date().toISOString();
    const res = await fetch(`${ONTOLOGY_URL}/api/objects/proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "batch.deferStart", // exact case-sensitive handler key
        targetId: args.batch_id,
        params: { newPlannedStart: args.new_planned_start }, // action-specific params only
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
            text: `propose_batch_defer_start failed (${res.status}): ${text}`,
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
              ? `Created proposal ${proposalId} (batch.deferStart on ${args.batch_id}, pending review).`
              : text,
        },
      ],
    };
  },
);
