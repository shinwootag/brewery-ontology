/**
 * `proposal_approve` — Agent SDK wrapper for the `proposal.approve` action.
 *
 * This is a DIRECT action: approving runs the underlying action the proposal
 * stands for, immediately, with no further review step.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";

export const proposalApprove = tool(
  "proposal_approve",
  "Approve a proposal. This runs the underlying action the proposal stands for " +
    "(e.g. batch.extendRest on its target) immediately — approval and execution " +
    "are the same step, and there is no further review. The proposal must be " +
    "'pending' or 'escalated'; already approved or rejected proposals cannot be " +
    "approved again. If the underlying action fails, the proposal is left " +
    "untouched. Returns the updated proposal and the result of the triggered " +
    "action.",
  {
    proposal_id: z
      .union([z.number().int(), z.string()])
      .describe("The proposal's id, e.g. 14."),
    decision_note: z
      .string()
      .optional()
      .describe(
        "Optional note recorded with the decision, explaining what the approval " +
          "rests on.",
      ),
  },
  async (args) => {
    const body: Record<string, unknown> = {};
    if (args.decision_note !== undefined) body.decisionNote = args.decision_note;

    const res = await fetch(
      `${ONTOLOGY_URL}/api/objects/proposal/${encodeURIComponent(String(args.proposal_id))}/actions/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      return {
        content: [
          { type: "text", text: `proposal_approve failed (${res.status}): ${text}` },
        ],
        isError: true,
      };
    }

    return { content: [{ type: "text", text }] };
  },
);
