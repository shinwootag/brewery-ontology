import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Icon,
  Spinner,
  Tag,
  Intent,
} from "@blueprintjs/core";
import { fetchTypeBundle, fetchInstance } from "../api.ts";
import type { ObjectType, TypeBundle, Property, ActionType } from "../api.ts";
import { ActionDialog } from "./ActionDialog.tsx";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function objectLabel(obj: Record<string, unknown>): string {
  if (typeof obj.name === "string") return obj.name;
  if (typeof obj.id === "string") return obj.id;
  const first = Object.values(obj).find((v) => typeof v === "string");
  return first ? String(first) : "—";
}

function formatValue(value: unknown, dataType: string): ReactNode {
  if (value == null) return <span className="bp5-text-muted">—</span>;

  switch (dataType) {
    case "datetime": {
      const d = new Date(value as string);
      return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
    }
    case "number":
      return String(value);
    case "json":
      return (
        <code className="obj-json">
          {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
        </code>
      );
    case "string[]":
      if (Array.isArray(value)) {
        return (
          <span className="obj-tags">
            {(value as string[]).map((v) => (
              <Tag key={v} minimal round>
                {v}
              </Tag>
            ))}
          </span>
        );
      }
      return String(value);
    case "enum":
      return (
        <Tag minimal round intent={Intent.PRIMARY}>
          {String(value)}
        </Tag>
      );
    default:
      return String(value);
  }
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ObjectDetailProps {
  typeApiName: string;
  instanceId: string;
  types: ObjectType[];
  typesById: Map<string, ObjectType>;
  onNavigate: (typeApiName: string, instanceId: string) => void;
  onBack: (() => void) | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ObjectDetail({
  typeApiName,
  instanceId,
  types,
  typesById,
  onNavigate,
  onBack,
}: ObjectDetailProps) {
  const [bundle, setBundle] = useState<TypeBundle | null>(null);
  const [instance, setInstance] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);

  function loadData() {
    Promise.all([fetchTypeBundle(typeApiName), fetchInstance(typeApiName, instanceId)]).then(
      ([b, inst]) => {
        setBundle(b);
        setInstance(inst);
      },
    );
  }

  useEffect(() => {
    setBundle(null);
    setInstance(null);
    loadData();
  }, [typeApiName, instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!bundle || !instance) {
    return (
      <div className="empty-state">
        <Spinner />
      </div>
    );
  }

  const typeMeta = types.find((t) => t.api_name === typeApiName);
  const titleProp = bundle.properties.find((p) => p.is_title);
  const pkProp = bundle.properties.find((p) => p.is_primary_key);
  const titleValue = titleProp
    ? String(instance[titleProp.datasource_column] ?? instanceId)
    : instanceId;

  const links = (instance.links ?? {}) as Record<string, unknown>;

  /* ---- Build link groups ---- */
  interface LinkGroup {
    label: string;
    targetTypeApiName: string;
    items: Record<string, unknown>[];
  }

  const linkGroups: LinkGroup[] = [];

  for (const link of bundle.outgoingLinks) {
    const data = links[link.api_name];
    if (data == null) continue;
    const items = Array.isArray(data) ? data : [data];
    if (items.length === 0) continue;
    const targetType = typesById.get(link.target_type_id);
    linkGroups.push({
      label: link.name,
      targetTypeApiName: targetType?.api_name ?? typeApiName,
      items: items as Record<string, unknown>[],
    });
  }

  for (const link of bundle.incomingLinks) {
    const data = links[link.inverse_api_name];
    if (!Array.isArray(data) || data.length === 0) continue;
    const sourceType = typesById.get(link.source_type_id);
    linkGroups.push({
      label: link.inverse_name,
      targetTypeApiName: sourceType?.api_name ?? typeApiName,
      items: data as Record<string, unknown>[],
    });
  }

  /* ---- Properties to display (skip PK if shown in header) ---- */
  const displayProps: Property[] = bundle.properties.filter(
    (p) => !p.is_primary_key && !p.is_title,
  );

  return (
    <div className="obj-detail-wrapper">
      {/* ---- Back + Header ---- */}
      <div className="obj-header">
        {onBack && (
          <Button
            icon="chevron-left"
            minimal
            className="obj-back-btn"
            onClick={onBack}
          />
        )}
        <Icon icon="document" size={28} className="obj-header-icon" />
        <div className="obj-header-text">
          <div className="obj-header-title">{titleValue}</div>
          <div className="obj-header-sub">{typeMeta?.name ?? typeApiName}</div>
        </div>
      </div>

      {/* ---- Action strip ---- */}
      {bundle.actions.length > 0 && (
        <div className="obj-action-strip">
          {bundle.actions.map((a) => (
            <Button
              key={a.id}
              icon="play"
              text={a.name}
              title={a.description ?? undefined}
              outlined
              intent={Intent.PRIMARY}
              onClick={() => setActiveAction(a)}
            />
          ))}
        </div>
      )}

      {/* ---- Action dialog ---- */}
      {activeAction && (
        <ActionDialog
          action={activeAction}
          typeApiName={typeApiName}
          instanceId={instanceId}
          isOpen={true}
          onClose={() => setActiveAction(null)}
          onSuccess={loadData}
        />
      )}

      {/* ---- Two-column layout ---- */}
      <div className="obj-columns">
        {/* ---- Left: Properties ---- */}
        <div className="section-card">
          <div className="section-header">
            <h3 className="section-title">Properties</h3>
            <Tag className="section-count" minimal round>
              {displayProps.length + (pkProp ? 1 : 0) + (titleProp ? 1 : 0)}
            </Tag>
          </div>
          <div className="section-body">
            {/* Always show PK first */}
            {pkProp && (
              <div className="obj-prop-row">
                <div className="obj-prop-label">{pkProp.name}</div>
                <div className="obj-prop-value">
                  {formatValue(instance[pkProp.datasource_column], pkProp.data_type)}
                </div>
              </div>
            )}
            {/* Title prop if different from PK */}
            {titleProp && titleProp.id !== pkProp?.id && (
              <div className="obj-prop-row">
                <div className="obj-prop-label">{titleProp.name}</div>
                <div className="obj-prop-value">
                  {formatValue(instance[titleProp.datasource_column], titleProp.data_type)}
                </div>
              </div>
            )}
            {displayProps.map((p) => (
              <div className="obj-prop-row" key={p.id}>
                <div className="obj-prop-label">{p.name}</div>
                <div className="obj-prop-value">
                  {formatValue(instance[p.datasource_column], p.data_type)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- Right: Links ---- */}
        <div className="section-card">
          <div className="section-header">
            <h3 className="section-title">Links</h3>
            <Tag className="section-count" minimal round>
              {linkGroups.length}
            </Tag>
          </div>
          <div className="section-body">
            {linkGroups.length === 0 ? (
              <div className="section-empty">No linked objects</div>
            ) : (
              linkGroups.map((group) => (
                <div key={group.label} className="obj-link-group">
                  <div className="obj-link-group-label">{group.label}</div>
                  {group.items.map((item, i) => {
                    const id = String(item.id ?? i);
                    return (
                      <div
                        key={id}
                        className="obj-link-item"
                        onClick={() => onNavigate(group.targetTypeApiName, id)}
                      >
                        <Icon icon="arrow-right" size={12} className="obj-link-arrow" />
                        <span className="obj-link-label">{objectLabel(item)}</span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
