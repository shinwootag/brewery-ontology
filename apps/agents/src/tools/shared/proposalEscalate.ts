/**
 * `proposal_escalate` — Agent SDK wrapper for the `proposal.escalate` action.
 *
 * Escalation is not a decision: it parks the proposal for a human, who can
 * still approve or reject it afterwards. The underlying action is not run.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";

export const proposalEscalate = tool(
  "proposal_escalate",
  "Escalate a proposal for a human to resolve, recording a note explaining the " +
    "unresolved concern. This does NOT run the underlying action and does NOT " +
    "close the proposal — it moves it into the escalated lane, where a reviewer " +
    "can still approve or reject it later. Nothing about the target changes. " +
    "The proposal must currently be 'pending'. Returns the updated proposal.",
  {
    proposal_id: z
      .union([z.number().int(), z.string()])
      .describe("The proposal's id, e.g. 14."),
    note: z
      .string()
      .describe(
        "The unresolved concern, written for the human who will resolve it: " +
          "what the proposal assumes, what the evidence does or does not support, " +
          "and what they would need to check to settle it.",
      ),
  },
  async (args) => {
    const res = await fetch(
      `${ONTOLOGY_URL}/api/objects/proposal/${encodeURIComponent(String(args.proposal_id))}/actions/escalate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: args.note }),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      return {
        content: [
          { type: "text", text: `proposal_escalate failed (${res.status}): ${text}` },
        ],
        isError: true,
      };
    }

    return { content: [{ type: "text", text }] };
  },
);
