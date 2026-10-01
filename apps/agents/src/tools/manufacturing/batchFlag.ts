/**
 * `batch_flag` — Agent SDK wrapper for the `batch.flag` action.
 *
 * POSTs to the Hono backend's action-invoke route, which validates the params
 * against the action_type metadata and dispatches the handler.
 *
 * Flagging opens a FlagLog against the batch for human review. It does NOT
 * change the batch's status or schedule — nothing about the batch's run is
 * altered by raising a flag.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";

export const batchFlag = tool(
  "batch_flag",
  "Raise a flag against a batch for human review, recording a reason and a " +
    "severity. Creates an open FlagLog linked to the batch. This does not " +
    "change the batch's status, schedule, or anything else about the run — it " +
    "only records a concern for a person to look at. Returns the created FlagLog.",
  {
    batchId: z.string().describe("The batch's domain id, e.g. 'B-2105'."),
    reason: z
      .string()
      .describe(
        "What the concern is and the evidence supporting it. State the observed " +
          "drift and the data it rests on (readings, test results, quoted notes).",
      ),
    severity: z
      .enum(["low", "medium", "high"])
      .describe(
        "How serious the drift is: 'low' to watch only, 'medium' if it likely " +
          "needs intervention, 'high' if it needs prompt attention.",
      ),
  },
  async (args) => {
    const res = await fetch(
      `${ONTOLOGY_URL}/api/objects/batch/${encodeURIComponent(args.batchId)}/actions/flag`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: args.reason, severity: args.severity }),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      return {
        content: [
          { type: "text", text: `batch_flag failed (${res.status}): ${text}` },
        ],
        isError: true,
      };
    }

    return { content: [{ type: "text", text }] };
  },
);
