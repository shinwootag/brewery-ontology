/**
 * `proposal_reject` — Agent SDK wrapper for the `proposal.reject` action.
 *
 * This is a DIRECT action: it closes the proposal immediately. The underlying
 * action is never run.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";

export const proposalReject = tool(
  "proposal_reject",
  "Reject a proposal. Closes it without running the underlying action, and " +
    "records the reviewer and decision note. This is final — a rejected " +
    "proposal cannot later be approved, and nothing about the target changes. " +
    "The proposal must be 'pending' or 'escalated'. Returns the updated proposal.",
  {
    proposal_id: z
      .union([z.number().int(), z.string()])
      .describe("The proposal's id, e.g. 14."),
    decision_note: z
      .string()
      .optional()
      .describe(
        "Optional note recorded with the decision, explaining why the proposal " +
          "was rejected.",
      ),
  },
  async (args) => {
    const body: Record<string, unknown> = {};
    if (args.decision_note !== undefined) body.decisionNote = args.decision_note;

    const res = await fetch(
      `${ONTOLOGY_URL}/api/objects/proposal/${encodeURIComponent(String(args.proposal_id))}/actions/reject`,
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
          { type: "text", text: `proposal_reject failed (${res.status}): ${text}` },
        ],
        isError: true,
      };
    }

    return { content: [{ type: "text", text }] };
  },
);
