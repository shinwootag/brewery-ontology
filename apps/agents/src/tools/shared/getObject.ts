/**
 * `get_object` — a shared Claude Agent SDK tool that fetches a single ontology
 * object instance by type and id, with its links resolved by the backend.
 *
 * It GETs the Hono backend's `/api/objects/:type/:id` route.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";

export const getObject = tool(
  "get_object",
  "Fetch a single ontology object instance by type and id, including its " +
    "resolved links. Returns the instance as JSON.",
  {
    type: z
      .string()
      .describe("The object type's API name, e.g. 'batch', 'tank', 'recipe'."),
    id: z.string().describe("The instance's domain id, e.g. 'B-2105'."),
  },
  async (args) => {
    const res = await fetch(
      `${ONTOLOGY_URL}/api/objects/${encodeURIComponent(args.type)}/${encodeURIComponent(args.id)}`,
    );

    const text = await res.text();
    if (!res.ok) {
      return {
        content: [
          { type: "text", text: `get_object failed (${res.status}): ${text}` },
        ],
        isError: true,
      };
    }

    return { content: [{ type: "text", text }] };
  },
);
