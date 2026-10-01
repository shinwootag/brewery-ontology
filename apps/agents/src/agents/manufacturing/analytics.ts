/**
 * Manufacturing analytics agent.
 *
 * A brewery operations analyst that answers questions about the current state
 * of production by querying the ontology through our shared tools.
 *
 * Run:
 *   node --env-file=../../.env src/agents/manufacturing/index.ts "your question"
 */
import { runAgent } from "../../run-agent.ts";
import { queryObjects } from "../../tools/shared/queryObjects.ts";
import { getObject } from "../../tools/shared/getObject.ts";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error(
    'Usage: node --env-file=../../.env src/agents/manufacturing/index.ts "<question>"',
  );
  process.exit(1);
}

await runAgent({
  identity: "analytics-agent",
  prompt: question,
  tools: [queryObjects, getObject],
  options: {
    model: "claude-sonnet-5",
    systemPrompt:
      "You are a brewery operations analyst. You help operators understand " +
      "the current state of production by querying the ontology. Always cite " +
      "specific object IDs when answering. Don't speculate about data you " +
      "haven't queried. If you can't answer with the available tools, say so.",
  },
});
