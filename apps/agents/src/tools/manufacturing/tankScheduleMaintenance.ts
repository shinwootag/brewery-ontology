/**
 * `tank_schedule_maintenance` — Agent SDK wrapper for the
 * `tank.scheduleMaintenance` action.
 *
 * POSTs to the Hono backend's action-invoke route, which validates the params
 * against the action_type metadata and dispatches the handler.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";

export const tankScheduleMaintenance = tool(
  "tank_schedule_maintenance",
  "Schedule maintenance on a tank. This TAKES THE TANK OFFLINE (sets its status " +
    "to 'maintenance') and creates a scheduled maintenance log recording the " +
    "planned time and notes. Fails if the tank still has a batch in 'fermenting' " +
    "status. Returns the created maintenance log.",
  {
    tankId: z.string().describe("The tank's domain id, e.g. 'T-8'."),
    type: z
      .enum(["inspection", "preventive", "corrective", "cleaning"])
      .describe("The kind of maintenance to schedule."),
    plannedAt: z
      .string()
      .describe(
        "When the maintenance is planned, as an ISO 8601 date-time " +
          "(e.g. '2026-05-01T09:00:00Z').",
      ),
    notes: z.string().describe("Free-text notes describing the maintenance."),
  },
  async (args) => {
    const res = await fetch(
      `${ONTOLOGY_URL}/api/objects/tank/${encodeURIComponent(args.tankId)}/actions/scheduleMaintenance`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: args.type,
          plannedAt: args.plannedAt,
          notes: args.notes,
        }),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      return {
        content: [
          {
            type: "text",
            text: `tank_schedule_maintenance failed (${res.status}): ${text}`,
          },
        ],
        isError: true,
      };
    }

    return { content: [{ type: "text", text }] };
  },
);
