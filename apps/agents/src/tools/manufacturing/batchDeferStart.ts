/**
 * `batch_defer_start` — Agent SDK wrapper for the `batch.deferStart` action.
 *
 * POSTs to the Hono backend's action-invoke route, which validates the params
 * against the action_type metadata and dispatches the handler.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";

export const batchDeferStart = tool(
  "batch_defer_start",
  "Defer a batch's planned start date. Postpones the batch's planned_start to a " +
    "later time. The batch must be in 'queued' status and the new date must be " +
    "in the future. Returns the updated batch.",
  {
    batchId: z.string().describe("The batch's domain id, e.g. 'B-2130'."),
    newPlannedStart: z
      .string()
      .describe(
        "New planned start as an ISO 8601 date-time (e.g. '2026-05-03T09:00:00Z'). " +
          "Must be in the future.",
      ),
  },
  async (args) => {
    const res = await fetch(
      `${ONTOLOGY_URL}/api/objects/batch/${encodeURIComponent(args.batchId)}/actions/deferStart`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPlannedStart: args.newPlannedStart }),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      return {
        content: [
          { type: "text", text: `batch_defer_start failed (${res.status}): ${text}` },
        ],
        isError: true,
      };
    }

    return { content: [{ type: "text", text }] };
  },
);
