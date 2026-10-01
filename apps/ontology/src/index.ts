import "./time-anchor.ts"; 
import "./clock.ts"; // must run first: anchors the global clock before any handler
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import meta from "./routes/meta.ts";
import objects from "./routes/objects.ts";
import actions from "./routes/actions.ts";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api/objects/meta", meta);
app.route("/api/objects", actions);
app.route("/api/objects", objects);

serve({ fetch: app.fetch, port: 3456 }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});
