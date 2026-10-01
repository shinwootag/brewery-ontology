/**
 * Fetches the live ontology metadata and renders it as a compact, readable
 * text block for injection into an agent's system prompt. This lets the agent
 * know which object types, properties, links, and actions exist without having
 * to discover them by trial and error.
 */
const ONTOLOGY_URL = process.env.ONTOLOGY_URL ?? "http://localhost:3456";

interface MetaType {
  id: string;
  api_name: string;
  name: string;
  description: string | null;
  instance_count: number;
}

interface MetaProperty {
  api_name: string;
  data_type: string;
  is_primary_key: boolean;
  is_title: boolean;
  required: boolean;
}

interface MetaLink {
  api_name: string;
  inverse_api_name: string;
  source_type_id: string;
  target_type_id: string;
  cardinality: string;
}

interface MetaAction {
  api_name: string;
  name: string;
  description: string | null;
}

interface TypeBundle {
  objectType: MetaType;
  properties: MetaProperty[];
  outgoingLinks: MetaLink[];
  incomingLinks: MetaLink[];
  actions: MetaAction[];
}

export async function buildSchemaBlock(): Promise<string> {
  const typesRes = await fetch(`${ONTOLOGY_URL}/api/objects/meta/types`);
  if (!typesRes.ok) {
    throw new Error(`Failed to fetch ontology types: ${typesRes.status}`);
  }
  const types = (await typesRes.json()) as MetaType[];
  const apiNameById = new Map(types.map((t) => [t.id, t.api_name]));
  // instance_count is only present on the list endpoint, not the per-type bundle.
  const countById = new Map(types.map((t) => [t.id, t.instance_count]));

  const bundles = await Promise.all(
    types.map(async (t): Promise<TypeBundle> => {
      const res = await fetch(`${ONTOLOGY_URL}/api/objects/meta/types/${t.api_name}`);
      if (!res.ok) throw new Error(`Failed to fetch type ${t.api_name}: ${res.status}`);
      return res.json() as Promise<TypeBundle>;
    }),
  );

  const lines: string[] = ["# Ontology schema", ""];

  for (const b of bundles) {
    const ot = b.objectType;
    const count = countById.get(ot.id) ?? 0;
    lines.push(
      `## ${ot.name} — api_name: \`${ot.api_name}\` (${count} instances)`,
    );
    if (ot.description) lines.push(ot.description);

    lines.push("Properties:");
    for (const p of b.properties) {
      const flags = [
        p.is_primary_key ? "pk" : null,
        p.is_title ? "title" : null,
        p.required ? "required" : null,
      ].filter(Boolean);
      lines.push(
        `  - ${p.api_name}: ${p.data_type}${flags.length ? ` [${flags.join(", ")}]` : ""}`,
      );
    }

    if (b.outgoingLinks.length > 0 || b.incomingLinks.length > 0) {
      lines.push("Links:");
      for (const l of b.outgoingLinks) {
        const target = apiNameById.get(l.target_type_id) ?? l.target_type_id;
        lines.push(`  - ${l.api_name} → ${target} (${l.cardinality})`);
      }
      for (const l of b.incomingLinks) {
        const source = apiNameById.get(l.source_type_id) ?? l.source_type_id;
        lines.push(`  - ${l.inverse_api_name} ← ${source} (reverse)`);
      }
    }

    if (b.actions.length > 0) {
      lines.push("Actions:");
      for (const a of b.actions) {
        lines.push(`  - ${a.api_name}${a.description ? `: ${a.description}` : ""}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
