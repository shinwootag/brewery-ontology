import { useState, useEffect, useMemo, useCallback } from "react";
import { Spinner } from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import "./App.css";

import { fetchTypes } from "./api.ts";
import type { ObjectType } from "./api.ts";
import { AppSidebar } from "./components/AppSidebar.tsx";
import type { AppId } from "./components/AppSidebar.tsx";
import { OntologyManager } from "./components/OntologyManager.tsx";
import { ObjectExplorer } from "./components/ObjectExplorer.tsx";
import { BatchInvestigation } from "./components/BatchInvestigation.tsx";
import { ProposalsQueue } from "./components/ProposalsQueue.tsx";

export function App() {
  const [types, setTypes] = useState<ObjectType[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeApp, setActiveApp] = useState<AppId>("om");

  useEffect(() => {
    fetchTypes()
      .then(setTypes)
      .finally(() => setLoading(false));
  }, []);

  const typesById = useMemo(() => {
    const map = new Map<string, ObjectType>();
    for (const t of types) map.set(t.id, t);
    return map;
  }, [types]);

  const handleTypesChange = useCallback((updated: ObjectType[]) => {
    setTypes(updated);
  }, []);

  if (loading) {
    return (
      <div className="app-shell">
        <div className="empty-state" style={{ flex: 1 }}>
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <AppSidebar active={activeApp} onSelect={setActiveApp} />
      {activeApp === "om" ? (
        <OntologyManager
          types={types}
          typesById={typesById}
          onTypesChange={handleTypesChange}
        />
      ) : activeApp === "oe" ? (
        <ObjectExplorer types={types} typesById={typesById} />
      ) : activeApp === "bi" ? (
        <BatchInvestigation />
      ) : (
        <ProposalsQueue />
      )}
    </div>
  );
}
