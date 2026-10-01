import { Icon } from "@blueprintjs/core";
import type { ObjectType } from "../api.ts";

interface TypeListProps {
  types: ObjectType[];
  selectedApiName: string | null;
  onSelect: (apiName: string) => void;
}

export function TypeList({ types, selectedApiName, onSelect }: TypeListProps) {
  return (
    <>
      <div className="sidebar-header">
        <h2>
          Object Types
          <span className="sidebar-count">{types.length}</span>
        </h2>
      </div>
      <div className="sidebar-list">
        {types.map((t) => (
          <div
            key={t.id}
            className={`type-item${t.api_name === selectedApiName ? " selected" : ""}`}
            onClick={() => onSelect(t.api_name)}
          >
            <Icon icon="cube" size={16} />
            <div className="type-item-info">
              <div className="type-item-name">{t.name}</div>
              <div className="type-item-count">
                {t.instance_count} {t.instance_count === 1 ? "object" : "objects"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
