import { useState } from "react";
import { Button, InputGroup, NonIdealState, Switch } from "@blueprintjs/core";
import type { ObjectType } from "../api.ts";
import { TypeList } from "./TypeList.tsx";
import { InstanceList } from "./InstanceList.tsx";
import { ObjectDetail } from "./ObjectDetail.tsx";
import { GlobalSearch } from "./GlobalSearch.tsx";

interface NavEntry {
  typeApiName: string;
  instanceId?: string;
}

interface ObjectExplorerProps {
  types: ObjectType[];
  typesById: Map<string, ObjectType>;
}

export function ObjectExplorer({ types, typesById }: ObjectExplorerProps) {
  const [sidebarType, setSidebarType] = useState<string | null>(null);
  const [navStack, setNavStack] = useState<NavEntry[]>([]);
  const [query, setQuery] = useState("");
  const [searchAllTypes, setSearchAllTypes] = useState(false);

  const currentView = navStack.length > 0 ? navStack[navStack.length - 1] : null;
  const isDetailView = currentView?.instanceId != null;
  const showGlobalSearch = searchAllTypes && query.trim().length > 0;

  // Allow back from any detail view — either to a previous stack entry or
  // back to the list / global-search results (empty stack).
  const canGoBack =
    isDetailView && (navStack.length > 1 || showGlobalSearch || sidebarType != null);

  function handleTypeSelect(apiName: string) {
    setSidebarType(apiName);
    setNavStack([{ typeApiName: apiName }]);
  }

  function handleSelectInstance(typeApiName: string, instanceId: string) {
    setNavStack((prev) => [...prev, { typeApiName, instanceId }]);
  }

  function handleBack() {
    setNavStack((prev) => prev.slice(0, -1));
  }

  return (
    <>
      <div className="app-sidebar">
        <TypeList
          types={types}
          selectedApiName={sidebarType}
          onSelect={handleTypeSelect}
        />
      </div>
      <div className="app-main">
        {/* ---- Search bar (hidden in detail view) ---- */}
        {!isDetailView && (
          <div className="search-bar">
            <InputGroup
              leftIcon="search"
              placeholder="Search instances..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rightElement={
                query ? (
                  <Button
                    icon="cross"
                    minimal
                    onClick={() => setQuery("")}
                  />
                ) : undefined
              }
            />
            <Switch
              className="search-all-toggle"
              label="All types"
              checked={searchAllTypes}
              onChange={() => setSearchAllTypes((v) => !v)}
              inline
            />
          </div>
        )}

        {/* ---- Main content ---- */}
        {isDetailView ? (
          <ObjectDetail
            typeApiName={currentView.typeApiName}
            instanceId={currentView.instanceId!}
            types={types}
            typesById={typesById}
            onNavigate={handleSelectInstance}
            onBack={canGoBack ? handleBack : null}
          />
        ) : showGlobalSearch ? (
          <GlobalSearch
            query={query}
            types={types}
            onSelectInstance={handleSelectInstance}
          />
        ) : currentView ? (
          <InstanceList
            typeApiName={currentView.typeApiName}
            types={types}
            query={query}
            onSelectInstance={handleSelectInstance}
          />
        ) : (
          <div className="empty-state">
            <NonIdealState
              icon="search-template"
              title="Object Explorer"
              description="Select an object type from the sidebar to browse instances."
            />
          </div>
        )}
      </div>
    </>
  );
}
