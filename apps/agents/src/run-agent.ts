/**
 * Shared entry point for standalone agent scripts.
 *
 * `runAgent({ identity, prompt, options })` wraps the Claude Agent SDK's
 * `query()` and takes care of the cross-cutting concerns every agent needs:
 *
 *   1. A live HTTP dashboard on :3455 that streams the run (tool calls, tool
 *      results, assistant text, final result) to a self-contained web page.
 *   2. OpenTelemetry → Langfuse tracing of every `query()` call (auto-enabled
 *      when the LANGFUSE_* env vars are present).
 *   3. Auto-injection of the ontology schema and the COURSE_NOW override date
 *      into the system prompt.
 *   4. A locked-down permission policy: only this agent's own MCP tools are
 *      allowed (no prompt); Bash, Read, and everything else are denied.
 *   5. A fetch interceptor that stamps `x-caller-identity` on ontology calls.
 *
 * Agent files import this and call it as their whole program; when the agent
 * finishes, the process exits.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor, isDefaultExportSpan } from "@langfuse/otel";
import { ClaudeAgentSDKInstrumentation } from "@arizeai/openinference-instrumentation-claude-agent-sdk";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import * as ClaudeAgentSDKModule from "@anthropic-ai/claude-agent-sdk";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type {
  Options,
  CanUseTool,
  PermissionResult,
  SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { buildSchemaBlock } from "./helpers/buildSchemaBlock.ts";

const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";
const DASHBOARD_PORT = 3455;

/* ------------------------------------------------------------------ */
/*  (2) OpenTelemetry → Langfuse                                       */
/* ------------------------------------------------------------------ */

// Node's ESM namespace objects are read-only, so the instrumentation patches a
// mutable copy — and we must call `query()` from that copy for it to be traced.
const ClaudeAgentSDK = { ...ClaudeAgentSDKModule };

const tracingEnabled = Boolean(
  process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
);

let otelShutdown: () => Promise<void> = async () => {};

if (tracingEnabled) {
  const instrumentation = new ClaudeAgentSDKInstrumentation();
  instrumentation.manuallyInstrument(
    ClaudeAgentSDK as Parameters<typeof instrumentation.manuallyInstrument>[0],
  );

  const otelSdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        shouldExportSpan: ({ otelSpan }) =>
          isDefaultExportSpan(otelSpan) ||
          otelSpan.instrumentationScope.name ===
            "@arizeai/openinference-instrumentation-claude-agent-sdk",
      }),
    ],
    instrumentations: [instrumentation],
  });
  otelSdk.start();
  otelShutdown = () => otelSdk.shutdown();
} else {
  console.warn(
    "[run-agent] LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY not set — tracing disabled.",
  );
}

const tracer = trace.getTracer("ontology-agents");

/* ------------------------------------------------------------------ */
/*  (5) Fetch interceptor: stamp identity on ontology calls only       */
/* ------------------------------------------------------------------ */

interface PatchedFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  __ontologyPatched?: boolean;
}

export function installFetchInterceptor(identity: string): void {
  const realFetch = globalThis.fetch as PatchedFetch;
  if (realFetch.__ontologyPatched) return;

  const patched: PatchedFetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    // Only ontology traffic gets the header — never Anthropic or Langfuse.
    if (url && url.startsWith(ONTOLOGY_URL)) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set("x-caller-identity", identity);
      if (input instanceof Request && !init) {
        return realFetch(new Request(input, { headers }));
      }
      return realFetch(input, { ...init, headers });
    }
    return realFetch(input, init);
  };

  patched.__ontologyPatched = true;
  globalThis.fetch = patched as typeof fetch;
}

/* ------------------------------------------------------------------ */
/*  (1) Live dashboard on :3455                                        */
/* ------------------------------------------------------------------ */

type AgentEvent =
  | { kind: "status"; text: string; prompt?: string; identity?: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool_use"; name: string; input: unknown; id: string }
  | { kind: "tool_result"; text: string; id: string; isError: boolean }
  | { kind: "result"; text: string; subtype: string }
  | { kind: "error"; text: string }
  | { kind: "done" };

function createDashboard() {
  const buffer: AgentEvent[] = [];
  const clients = new Set<ServerResponse>();

  const send = (res: ServerResponse, ev: AgentEvent) =>
    res.write(`data: ${JSON.stringify(ev)}\n\n`);

  const emit = (ev: AgentEvent) => {
    buffer.push(ev);
    for (const res of clients) send(res, ev);
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      for (const ev of buffer) send(res, ev);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DASHBOARD_HTML);
  });

  const listening = new Promise<void>((resolve) =>
    server.listen(DASHBOARD_PORT, resolve),
  );

  const close = () => {
    for (const res of clients) res.end();
    clients.clear();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { emit, listening, close };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function renderToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text: unknown }).text)
          : JSON.stringify(b),
      )
      .join("");
  }
  return JSON.stringify(content);
}

/**
 * (3) Preamble injected at the top of the system prompt: the COURSE_NOW
 * override date, framed explicitly, followed by the live ontology schema.
 */
async function buildContextPreamble(): Promise<string> {
  const parts: string[] = [];

  // Ontology schema goes first, wrapped in <ontology-schema> tags.
  parts.push(`<ontology-schema>\n${await buildSchemaBlock()}\n</ontology-schema>`);

  const courseNow = process.env.COURSE_NOW;
  if (courseNow) {
    parts.push(
      [
        "# COURSE_NOW — override current date",
        `Treat **${courseNow}** as the current date and time (call it "COURSE_NOW").`,
        "It is the authoritative \"now\" for ALL time-relative reasoning about",
        "ontology data — phrases like \"recent\", \"today\", \"in the last 7 days\",",
        "\"overdue\", or \"how many days ago\" must be computed against COURSE_NOW,",
        "not against the real wall-clock date.",
      ].join("\n"),
    );
  }

  return parts.join("\n\n");
}

/**
 * Merge our preamble into whatever systemPrompt the caller supplied, keeping the
 * <ontology-schema> block at the very start of the prompt.
 */
function mergeSystemPrompt(
  base: Options["systemPrompt"],
  preamble: string,
): Options["systemPrompt"] {
  if (base == null) return preamble;
  if (typeof base === "string") return `${preamble}\n\n${base}`;
  if (Array.isArray(base)) return [preamble, ...base];
  if (base.type === "preset") {
    // Presets can only be appended to; the schema still leads the appended text.
    return {
      ...base,
      append: [preamble, base.append].filter(Boolean).join("\n\n"),
    };
  }
  return preamble;
}

/* ------------------------------------------------------------------ */
/*  runAgent                                                           */
/* ------------------------------------------------------------------ */

/** Name of the MCP server runAgent builds from each agent's `tools`. */
const TOOLS_SERVER_NAME = "ontology";

export interface RunAgentArgs {
  /** Names the Langfuse trace and stamps `x-caller-identity` on ontology calls. */
  identity: string;
  prompt: string;
  /** This agent's own tools. runAgent wraps them in an MCP server and gates them. */
  tools: SdkMcpToolDefinition<any>[];
  /** Extra SDK options (model, maxTurns, extra mcpServers, …). */
  options?: Options;
}

export async function runAgent({
  identity,
  prompt,
  tools,
  options = {},
}: RunAgentArgs): Promise<void> {
  // (5) Identity-stamping fetch, installed before any ontology call is made.
  installFetchInterceptor(identity);

  // Build this agent's MCP server from its tools, alongside any caller-supplied
  // servers, then gate the lot.
  const toolsServer = createSdkMcpServer({
    name: TOOLS_SERVER_NAME,
    version: "0.0.0",
    tools,
  });
  const mcpServers = {
    ...(options.mcpServers ?? {}),
    [TOOLS_SERVER_NAME]: toolsServer,
  };

  // (4) Permission policy — allow only our own MCP servers' tools.
  const serverNames = Object.keys(mcpServers);
  const isOwnTool = (toolName: string) =>
    serverNames.some(
      (n) => toolName === `mcp__${n}` || toolName.startsWith(`mcp__${n}__`),
    );

  const canUseTool: CanUseTool = async (toolName, input): Promise<PermissionResult> => {
    if (isOwnTool(toolName)) return { behavior: "allow", updatedInput: input };
    return {
      behavior: "deny",
      message: `Tool "${toolName}" is not permitted. This agent may only use the ontology MCP tools (${serverNames.map((n) => `mcp__${n}`).join(", ") || "none"}).`,
    };
  };

  // (3) Inject COURSE_NOW + schema.
  const preamble = await buildContextPreamble();

  const finalOptions: Options = {
    ...options,
    mcpServers,
    systemPrompt: mergeSystemPrompt(options.systemPrompt, preamble),
    permissionMode: "default",
    // Leave allowedTools empty of our own servers on purpose: bare allowlist
    // entries would auto-approve *before* canUseTool runs (shadowing it), so we
    // let every tool fall through to canUseTool — which approves our own tools
    // (no prompt) and denies everything else.
    allowedTools: options.allowedTools ?? [],
    // Explicitly forbid Bash and Read on top of the deny-by-default policy.
    disallowedTools: [...(options.disallowedTools ?? []), "Bash", "Read"],
    canUseTool,
  };

  // (1) Dashboard.
  const dash = createDashboard();
  await dash.listening;
  console.log(
    `\n[run-agent] "${identity}" — watch live at http://localhost:${DASHBOARD_PORT}\n`,
  );
  dash.emit({ kind: "status", text: `Running agent "${identity}"`, prompt, identity });

  // (2) Trace naming: the root span's name becomes the Langfuse trace name.
  await tracer.startActiveSpan(identity, async (span) => {
    span.setAttribute("langfuse.trace.name", identity);
    span.setAttribute("agent.identity", identity);
    try {
      for await (const message of ClaudeAgentSDK.query({
        prompt,
        options: finalOptions,
      })) {
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "text") {
              console.log(`\n[assistant] ${block.text}`);
              dash.emit({ kind: "assistant", text: block.text });
            } else if (block.type === "tool_use") {
              console.log(`[tool_use] ${block.name} ${JSON.stringify(block.input)}`);
              dash.emit({
                kind: "tool_use",
                name: block.name,
                input: block.input,
                id: block.id,
              });
            }
          }
        } else if (message.type === "user") {
          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_result") {
                const text = renderToolResultContent(block.content);
                console.log(`[tool_result] ${text.slice(0, 200)}`);
                dash.emit({
                  kind: "tool_result",
                  text,
                  id: block.tool_use_id,
                  isError: block.is_error ?? false,
                });
              }
            }
          }
        } else if (message.type === "result") {
          const text =
            "result" in message && typeof message.result === "string"
              ? message.result
              : message.subtype;
          console.log(`\n[result] ${text}`);
          dash.emit({ kind: "result", text, subtype: message.subtype });
        }
      }
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      console.error(`[run-agent] error: ${text}`);
      dash.emit({ kind: "error", text });
      span.recordException(err instanceof Error ? err : new Error(text));
      span.setStatus({ code: SpanStatusCode.ERROR, message: text });
    } finally {
      span.end();
    }
  });

  dash.emit({ kind: "done" });

  // Flush spans to Langfuse, then tear the dashboard down. The process finishes.
  await otelShutdown();
  await dash.close();
}

/* ------------------------------------------------------------------ */
/*  Self-contained dashboard page                                      */
/* ------------------------------------------------------------------ */

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agent run</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f6f7f9; color: #1c2127;
  }
  header {
    position: sticky; top: 0; padding: 16px 24px; background: #ffffffe6;
    backdrop-filter: blur(8px); border-bottom: 1px solid #e1e4e8;
  }
  header h1 { margin: 0; font-size: 16px; }
  header .prompt { margin-top: 4px; color: #5c6773; font-size: 13px; }
  header .status { margin-top: 6px; font-size: 12px; color: #738091; }
  main { max-width: 860px; margin: 0 auto; padding: 20px 24px 80px; }
  .ev { border: 1px solid #e1e4e8; border-radius: 10px; margin: 12px 0; overflow: hidden; background: #fff; }
  .ev .head {
    display: flex; align-items: center; gap: 8px; padding: 9px 14px;
    font-size: 11px; text-transform: uppercase; letter-spacing: .04em; font-weight: 600;
  }
  .ev .body { padding: 0 14px 12px; }
  .ev pre {
    margin: 0; padding: 10px 12px; background: #f2f4f6; border-radius: 8px;
    overflow-x: auto; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap; word-break: break-word;
  }
  .assistant .head { color: #1c2127; } .assistant { border-color: #d0d7de; }
  .assistant .text { white-space: pre-wrap; }
  .tool_use .head { color: #0a6cff; } .tool_use { border-color: #b6d4ff; background: #f5f9ff; }
  .tool_result .head { color: #3d7a44; } .tool_result { border-color: #cfe6d2; }
  .tool_result.err .head { color: #c23030; } .tool_result.err { border-color: #f2c2c2; }
  .result { border-color: #a7d3ac; background: #f3fbf4; } .result .head { color: #1d7324; }
  .error { border-color: #f2c2c2; background: #fdf3f3; } .error .head { color: #c23030; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .done { text-align: center; color: #738091; padding: 20px; font-size: 12px; }
  @media (prefers-color-scheme: dark) {
    body { background: #1c2127; color: #e8eaed; }
    header { background: #22272ee6; border-color: #30363d; }
    header h1, .assistant .head { color: #e8eaed; }
    .ev { background: #22272e; border-color: #30363d; }
    .ev pre { background: #1c2127; }
    .tool_use { background: #12233a; } .result { background: #12261a; } .error { background: #2a1717; }
  }
</style>
</head>
<body>
<header>
  <h1 id="title">Agent run</h1>
  <div class="prompt" id="prompt"></div>
  <div class="status" id="status">Connecting…</div>
</header>
<main id="feed"></main>
<script>
  const feed = document.getElementById("feed");
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
  const pretty = (v) => { try { return JSON.stringify(typeof v === "string" ? JSON.parse(v) : v, null, 2); } catch { return String(v); } };
  function card(cls, label, inner) {
    const el = document.createElement("div");
    el.className = "ev " + cls;
    el.innerHTML = '<div class="head"><span class="dot"></span>' + label + '</div><div class="body">' + inner + '</div>';
    feed.appendChild(el);
    window.scrollTo(0, document.body.scrollHeight);
  }
  const es = new EventSource("/events");
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.kind === "status") {
      document.getElementById("title").textContent = ev.identity ? 'Agent: ' + ev.identity : ev.text;
      if (ev.prompt) document.getElementById("prompt").textContent = ev.prompt;
      document.getElementById("status").textContent = "Running…";
    } else if (ev.kind === "assistant") {
      card("assistant", "assistant", '<div class="text">' + esc(ev.text) + '</div>');
    } else if (ev.kind === "tool_use") {
      card("tool_use", "tool call · " + esc(ev.name), "<pre>" + esc(pretty(ev.input)) + "</pre>");
    } else if (ev.kind === "tool_result") {
      card("tool_result" + (ev.isError ? " err" : ""), ev.isError ? "tool error" : "tool result", "<pre>" + esc(pretty(ev.text)) + "</pre>");
    } else if (ev.kind === "result") {
      card("result", "final result", '<div class="text">' + esc(ev.text) + '</div>');
      document.getElementById("status").textContent = "Done";
    } else if (ev.kind === "error") {
      card("error", "error", "<pre>" + esc(ev.text) + "</pre>");
      document.getElementById("status").textContent = "Error";
    } else if (ev.kind === "done") {
      const d = document.createElement("div"); d.className = "done"; d.textContent = "— run complete —"; feed.appendChild(d);
      es.close();
    }
  };
  es.onerror = () => { document.getElementById("status").textContent = "Disconnected"; };
</script>
</body>
</html>`;
