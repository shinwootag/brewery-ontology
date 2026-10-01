import { useState, useEffect, useMemo } from "react";
import { HTMLTable, Spinner, NonIdealState, Tag } from "@blueprintjs/core";
import { fetchTypeBundle, fetchInstances } from "../api.ts";
import type { ObjectType, TypeBundle, Property } from "../api.ts";

/* ------------------------------------------------------------------ */
/*  Search helper                                                      */
/* ------------------------------------------------------------------ */

export function matchesQuery(
  instance: Record<string, unknown>,
  searchableProps: Property[],
  query: string,
): boolean {
  const q = query.toLowerCase();
  for (const prop of searchableProps) {
    const val = instance[prop.datasource_column];
    if (val == null) continue;
    if (String(val).toLowerCase().includes(q)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface InstanceListProps {
  typeApiName: string;
  types: ObjectType[];
  query: string;
  onSelectInstance: (typeApiName: string, instanceId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function InstanceList({
  typeApiName,
  types,
  query,
  onSelectInstance,
}: InstanceListProps) {
  const [bundle, setBundle] = useState<TypeBundle | null>(null);
  const [instances, setInstances] = useState<Record<string, unknown>[] | null>(
    null,
  );

  useEffect(() => {
    setBundle(null);
    setInstances(null);
    Promise.all([
      fetchTypeBundle(typeApiName),
      fetchInstances(typeApiName),
    ]).then(([b, inst]) => {
      setBundle(b);
      setInstances(inst);
    });
  }, [typeApiName]);

  const searchableProps = useMemo(
    () => bundle?.properties.filter((p) => p.data_type !== "boolean") ?? [],
    [bundle],
  );

  const q = query.trim();
  const filtered = useMemo(
    () =>
      instances == null
        ? []
        : q
          ? instances.filter((inst) => matchesQuery(inst, searchableProps, q))
          : instances,
    [instances, searchableProps, q],
  );

  if (!bundle || !instances) {
    return (
      <div className="empty-state">
        <Spinner />
      </div>
    );
  }

  const typeMeta = types.find((t) => t.api_name === typeApiName);
  const titleProp = bundle.properties.find((p) => p.is_title);
  const pkProp = bundle.properties.find((p) => p.is_primary_key);
  const statusProp = bundle.properties.find(
    (p) => p.api_name === "status" || p.datasource_column === "status",
  );

  const titleCol =
    titleProp?.datasource_column ?? pkProp?.datasource_column ?? "id";
  const pkCol = pkProp?.datasource_column ?? "id";
  const statusCol = statusProp?.datasource_column;

  const countLabel =
    q && filtered.length !== instances.length
      ? `${filtered.length} of ${instances.length} objects`
      : `${instances.length} objects`;

  if (instances.length === 0) {
    return (
      <div className="instance-list-wrapper">
        <div className="instance-list-header">
          <h2 className="instance-list-title">
            {typeMeta?.name ?? typeApiName}
          </h2>
        </div>
        <NonIdealState
          icon="search"
          title="No objects"
          description={`No ${typeMeta?.name ?? typeApiName} instances found.`}
        />
      </div>
    );
  }

  return (
    <div className="instance-list-wrapper">
      <div className="instance-list-header">
        <h2 className="instance-list-title">{typeMeta?.name ?? typeApiName}</h2>
        <span className="instance-list-count">{countLabel}</span>
      </div>

      {filtered.length === 0 ? (
        <NonIdealState
          icon="search"
          title="No matches"
          description={`No results for "${q}" in ${typeMeta?.name ?? typeApiName}.`}
        />
      ) : (
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
                    onClick={() => onSelectInstance(typeApiName, pk)}
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
      )}
    </div>
  );
}
