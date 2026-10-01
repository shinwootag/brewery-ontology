import { useState, useEffect, useMemo } from "react";
import { HTMLTable, Spinner, NonIdealState, Tag, Icon } from "@blueprintjs/core";
import { fetchTypeBundle, fetchInstances } from "../api.ts";
import type { ObjectType, TypeBundle, Property } from "../api.ts";
import { matchesQuery } from "./InstanceList.tsx";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TypeData {
  type: ObjectType;
  bundle: TypeBundle;
  instances: Record<string, unknown>[];
}

interface GlobalSearchProps {
  query: string;
  types: ObjectType[];
  onSelectInstance: (typeApiName: string, instanceId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function GlobalSearch({
  query,
  types,
  onSelectInstance,
}: GlobalSearchProps) {
  const [allData, setAllData] = useState<TypeData[] | null>(null);

  useEffect(() => {
    setAllData(null);
    Promise.all(
      types.map(async (type) => {
        const [bundle, instances] = await Promise.all([
          fetchTypeBundle(type.api_name),
          fetchInstances(type.api_name),
        ]);
        return { type, bundle, instances };
      }),
    ).then(setAllData);
  }, [types]);

  const q = query.trim();

  const groups = useMemo(() => {
    if (!allData || !q) return [];

    // Index data by type ID for link lookups
    const dataByTypeId = new Map(allData.map((d) => [d.type.id, d]));

    // Collect result PKs per type api_name
    const resultPks = new Map<string, Set<string>>();
    function addResult(apiName: string, pk: string) {
      let s = resultPks.get(apiName);
      if (!s) {
        s = new Set();
        resultPks.set(apiName, s);
      }
      s.add(pk);
    }

    // Pass 1 — direct property matches
    for (const { type, bundle, instances } of allData) {
      const searchable = bundle.properties.filter(
        (p) => p.data_type !== "boolean",
      );
      const pkCol =
        bundle.properties.find((p) => p.is_primary_key)?.datasource_column ??
        "id";
      for (const inst of instances) {
        if (matchesQuery(inst, searchable, q)) {
          addResult(type.api_name, String(inst[pkCol]));
        }
      }
    }

    // Pass 2 — expand outgoing links from direct matches
    // e.g. Batch B-2105 matched → assigned_tank_id = T-12 → add Tank T-12
    for (const { type, bundle, instances } of allData) {
      const pks = resultPks.get(type.api_name);
      if (!pks || pks.size === 0) continue;

      const pkCol =
        bundle.properties.find((p) => p.is_primary_key)?.datasource_column ??
        "id";

      for (const link of bundle.outgoingLinks) {
        const targetData = dataByTypeId.get(link.target_type_id);
        if (!targetData) continue;

        const viaProp = bundle.properties.find(
          (p) => p.id === link.via_property_id,
        );
        if (!viaProp) continue;

        for (const inst of instances) {
          if (!pks.has(String(inst[pkCol]))) continue;
          const fkVal = inst[viaProp.datasource_column];
          if (fkVal != null) {
            addResult(targetData.type.api_name, String(fkVal));
          }
        }
      }
    }

    // Build display groups from the collected PKs
    return allData
      .map(({ type, bundle, instances }) => {
        const pks = resultPks.get(type.api_name);
        if (!pks || pks.size === 0) return null;
        const pkCol =
          bundle.properties.find((p) => p.is_primary_key)?.datasource_column ??
          "id";
        const filtered = instances.filter((inst) =>
          pks.has(String(inst[pkCol])),
        );
        return { type, bundle, filtered };
      })
      .filter((g): g is NonNullable<typeof g> => g != null);
  }, [allData, q]);

  if (!allData) {
    return (
      <div className="empty-state">
        <Spinner />
      </div>
    );
  }

  if (!q) {
    return (
      <div className="empty-state">
        <NonIdealState
          icon="search"
          title="Search all types"
          description="Type a query to search across all object types."
        />
      </div>
    );
  }

  const totalResults = groups.reduce((sum, g) => sum + g.filtered.length, 0);

  if (totalResults === 0) {
    return (
      <div className="global-search-wrapper">
        <NonIdealState
          icon="search"
          title="No matches"
          description={`No results for "${q}" across all types.`}
        />
      </div>
    );
  }

  return (
    <div className="global-search-wrapper">
      <p className="global-search-summary">
        {totalResults} {totalResults === 1 ? "result" : "results"} across{" "}
        {groups.length} {groups.length === 1 ? "type" : "types"}
      </p>

      {groups.map(({ type, bundle, filtered }) => {
        const titleProp = bundle.properties.find((p: Property) => p.is_title);
        const pkProp = bundle.properties.find((p: Property) => p.is_primary_key);
        const statusProp = bundle.properties.find(
          (p: Property) =>
            p.api_name === "status" || p.datasource_column === "status",
        );
        const titleCol =
          titleProp?.datasource_column ??
          pkProp?.datasource_column ??
          "id";
        const pkCol = pkProp?.datasource_column ?? "id";
        const statusCol = statusProp?.datasource_column;

        return (
          <div key={type.id} className="global-search-group">
            <div className="global-search-group-header">
              <Icon icon="cube" size={14} />
              <span className="global-search-group-name">{type.name}</span>
              <Tag minimal round>
                {filtered.length}
              </Tag>
            </div>
            <div className="section-card">
              <HTMLTable interactive className="instance-table">
                <thead>
                  <tr>
                    <th>{titleProp?.name ?? pkProp?.name ?? "ID"}</th>
                    {statusCol && <th style={{ width: 140 }}>Status</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inst) => {
                    const pk = String(inst[pkCol] ?? "");
                    const title = String(inst[titleCol] ?? pk);
                    const status = statusCol ? inst[statusCol] : null;
                    return (
                      <tr
                        key={pk}
                        onClick={() =>
                          onSelectInstance(type.api_name, pk)
                        }
                      >
                        <td>{title}</td>
                        {statusCol && (
                          <td>
                            {status != null ? (
                              <Tag minimal round>
                                {String(status)}
                              </Tag>
                            ) : (
                              <span className="bp5-text-muted">&mdash;</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </HTMLTable>
            </div>
          </div>
        );
      })}
    </div>
  );
}
