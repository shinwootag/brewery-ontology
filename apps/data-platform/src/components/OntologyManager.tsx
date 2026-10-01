import { useState, useEffect, useMemo, useCallback } from "react";
import { NonIdealState, Spinner } from "@blueprintjs/core";
import { fetchTypeBundle } from "../api.ts";
import type { ObjectType, TypeBundle } from "../api.ts";
import { TypeList } from "./TypeList.tsx";
import { TypeDetail } from "./TypeDetail.tsx";

interface OntologyManagerProps {
  types: ObjectType[];
  typesById: Map<string, ObjectType>;
  onTypesChange: (types: ObjectType[]) => void;
}

export function OntologyManager({
  types,
  typesById,
  onTypesChange,
}: OntologyManagerProps) {
  const [selectedApiName, setSelectedApiName] = useState<string | null>(
    types.length > 0 ? types[0].api_name : null,
  );
  const [bundle, setBundle] = useState<TypeBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);

  useEffect(() => {
    if (!selectedApiName) {
      setBundle(null);
      return;
    }
    setBundleLoading(true);
    fetchTypeBundle(selectedApiName)
      .then(setBundle)
      .finally(() => setBundleLoading(false));
  }, [selectedApiName]);

  const selectedType = useMemo(
    () => types.find((t) => t.api_name === selectedApiName) ?? null,
    [types, selectedApiName],
  );

  const handleTypeUpdated = useCallback(
    (updated: ObjectType) => {
      onTypesChange(
        types.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
      );
    },
    [types, onTypesChange],
  );

  return (
    <>
      <div className="app-sidebar">
        <TypeList
          types={types}
          selectedApiName={selectedApiName}
          onSelect={setSelectedApiName}
        />
      </div>
      <div className="app-main">
        {bundleLoading ? (
          <div className="empty-state">
            <Spinner />
          </div>
        ) : selectedType && bundle ? (
          <TypeDetail
            type={selectedType}
            bundle={bundle}
            typesById={typesById}
            onTypeUpdated={handleTypeUpdated}
          />
        ) : (
          <div className="empty-state">
            <NonIdealState
              icon="cube"
              title="No type selected"
              description="Select an object type from the sidebar."
            />
          </div>
        )}
      </div>
    </>
  );
}
