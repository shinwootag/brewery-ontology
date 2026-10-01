/**
 * `query_objects` — a shared Claude Agent SDK tool that runs a filtered query
 * against the ontology's instance data.
 *
 * It POSTs to the Hono backend's `/api/objects/:type/query` route, which maps
 * property API names to real columns and applies the filters server-side.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const HONO_URL = process.env.HONO_URL ?? "http://localhost:3456";

const OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "contains",
  "isNull",
  "isNotNull",
] as const;

const filterSchema = z.object({
  property: z.string().describe("Property API name to filter on, e.g. 'status'."),
  op: z
    .enum(OPS)
    .describe(
      "Comparison operator. Use 'in' with an array value; 'contains' for a " +
        "case-insensitive substring match; 'isNull'/'isNotNull' need no value.",
    ),
  value: z
    .unknown()
    .optional()
    .describe(
      "The value to compare against. An array for 'in'; omitted for " +
        "'isNull'/'isNotNull'.",
    ),
});

export const queryObjects = tool(
  "query_objects",
  "Query ontology object instances of a given type, optionally filtered. " +
    "Returns the matching instance rows as JSON.",
  {
    type: z
      .string()
      .describe("The object type's API name, e.g. 'batch', 'tank', 'recipe'."),
    filters: z
      .array(filterSchema)
      .optional()
      .describe("Optional filters, ANDed together."),
    limit: z.number().optional().describe("Optional maximum number of rows."),
  },
  async (args) => {
    const res = await fetch(
      `${HONO_URL}/api/objects/${encodeURIComponent(args.type)}/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: args.filters ?? [],
          limit: args.limit,
        }),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      return {
        content: [
          { type: "text", text: `query_objects failed (${res.status}): ${text}` },
        ],
        isError: true,
      };
    }

    return { content: [{ type: "text", text }] };
  },
);
