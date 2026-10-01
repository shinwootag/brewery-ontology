/**
 * Minimal standalone agent script.
 *
 * Run from this workspace with:  pnpm --filter @ontology/agents agent
 * (which resolves to: node --env-file=../../.env src/hello.ts)
 *
 * Requires ANTHROPIC_API_KEY in the repo-root .env.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

const prompt = process.argv.slice(2).join(" ") || "Say hello in one short sentence.";

const response = query({
  prompt,
  options: {
    model: "claude-sonnet-5",
    // No tools/permissions needed for a plain text turn.
    allowedTools: [],
  },
});

for await (const message of response) {
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text") process.stdout.write(block.text);
    }
  } else if (message.type === "result") {
    process.stdout.write("\n");
  }
}
