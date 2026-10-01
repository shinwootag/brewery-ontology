/**
 * `batch_place_on_hold` — Agent SDK wrapper for the `batch.placeOnHold` action.
 *
 * This is a DIRECT action, not a proposal: it changes the batch immediately,
 * with no human review step in between.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";

export const batchPlaceOnHold = tool(
  "batch_place_on_hold",
  "Place a batch on hold immediately, recording the reason. Sets the batch's " +
    "status to 'onHold' and halts the run. The batch must currently be " +
    "'fermenting' or 'conditioning'. This takes effect at once — there is no " +
    "review step. It does not change the batch's planned transfer date, and it " +
    "does not free or reassign the tank. Returns the updated batch.",
  {
    batchId: z.string().describe("The batch's domain id, e.g. 'B-2105'."),
    reason: z
      .string()
      .describe(
        "Why the batch is being halted, and the evidence it rests on. Recorded " +
          "on the batch's audit trail.",
      ),
  },
  async (args) => {
    const res = await fetch(
      `${ONTOLOGY_URL}/api/objects/batch/${encodeURIComponent(args.batchId)}/actions/placeOnHold`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: args.reason }),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      return {
        content: [
          { type: "text", text: `batch_place_on_hold failed (${res.status}): ${text}` },
        ],
        isError: true,
      };
    }

    return { content: [{ type: "text", text }] };
  },
);
