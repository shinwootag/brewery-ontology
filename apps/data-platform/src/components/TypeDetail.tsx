import { useState, useCallback } from "react";
import { EditableText, Icon, Tag, Intent } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { patchType } from "../api.ts";
import type { ObjectType, TypeBundle } from "../api.ts";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const DATA_TYPE_ICON: Record<string, IconName> = {
  string: "citation",
  number: "numerical",
  datetime: "calendar",
  enum: "properties",
  json: "code",
  "string[]": "th-list",
};

function dataTypeIcon(dt: string): IconName {
  return DATA_TYPE_ICON[dt] ?? "property";
}

function formatCardinality(c: string): string {
  switch (c) {
    case "many_to_one":
      return "Many \u2192 One";
    case "one_to_many":
      return "One \u2192 Many";
    default:
      return c;
  }
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface TypeDetailProps {
  type: ObjectType;
  bundle: TypeBundle;
  typesById: Map<string, ObjectType>;
  onTypeUpdated: (updated: ObjectType) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function TypeDetail({
  type,
  bundle,
  typesById,
  onTypeUpdated,
}: TypeDetailProps) {
  const { properties, outgoingLinks, incomingLinks, actions } = bundle;
  const linkCount = outgoingLinks.length + incomingLinks.length;

  /* ---- editable fields ---- */
  const [name, setName] = useState(type.name);
  const [desc, setDesc] = useState(type.description ?? "");

  // Reset local state when selected type changes
  const typeId = type.id;
  const [prevTypeId, setPrevTypeId] = useState(typeId);
  if (typeId !== prevTypeId) {
    setPrevTypeId(typeId);
    setName(type.name);
    setDesc(type.description ?? "");
  }

  const confirmName = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === type.name) {
        setName(type.name);
        return;
      }
      const updated = await patchType(type.api_name, { name: trimmed });
      onTypeUpdated(updated);
    },
    [type, onTypeUpdated],
  );

  const confirmDesc = useCallback(
    async (value: string) => {
      if (value === (type.description ?? "")) return;
      const updated = await patchType(type.api_name, {
        description: value || null,
      });
      onTypeUpdated(updated);
    },
    [type, onTypeUpdated],
  );

  return (
    <div className="app-main-inner">
      {/* ---- Header ---- */}
      <div className="detail-header">
        <Icon icon="cube" size={28} className="detail-header-icon" />
        <div className="detail-header-text">
          <div className="detail-header-name">
            <EditableText
              value={name}
              onChange={setName}
              onConfirm={confirmName}
              selectAllOnFocus
            />
          </div>
          <div className="detail-header-sub">
            Object type &middot; {type.instance_count}{" "}
            {type.instance_count === 1 ? "object" : "objects"}
          </div>
        </div>
      </div>

      {/* ---- Metadata ---- */}
      <div className="meta-card">
        <div className="meta-grid">
          {/* Left column */}
          <div>
            <div className="meta-row">
              <div className="meta-label">Description</div>
              <div className="meta-value">
                <EditableText
                  value={desc}
                  onChange={setDesc}
                  onConfirm={confirmDesc}
                  placeholder="Add a description\u2026"
                  multiline
                  minLines={1}
                  maxLines={4}
                />
              </div>
            </div>
            <div className="meta-row">
              <div className="meta-label">Point of contact</div>
              <div className="meta-value">
                {type.point_of_contact ?? <span className="bp5-text-muted">None</span>}
              </div>
            </div>
            <div className="meta-row">
              <div className="meta-label">API name</div>
              <div className="meta-value meta-value-mono">{type.api_name}</div>
            </div>
            <div className="meta-row">
              <div className="meta-label">Schema</div>
              <div className="meta-value meta-value-mono">{type.schema}</div>
            </div>
            <div className="meta-row">
              <div className="meta-label">Datasource table</div>
              <div className="meta-value meta-value-mono">{type.datasource_table}</div>
            </div>
          </div>

          {/* Right column */}
          <div>
            <div className="meta-row">
              <div className="meta-label">Status</div>
              <div className="meta-value">
                <Tag
                  intent={type.status === "active" ? Intent.SUCCESS : Intent.NONE}
                  minimal
                  round
                >
                  {type.status}
                </Tag>
              </div>
            </div>
            <div className="meta-row">
              <div className="meta-label">Visibility</div>
              <div className="meta-value">
                <Tag minimal round>{type.visibility}</Tag>
              </div>
            </div>
            <div className="meta-row">
              <div className="meta-label">Edits</div>
              <div className="meta-value">
                <Tag
                  intent={type.edits_enabled ? Intent.SUCCESS : Intent.WARNING}
                  minimal
                  round
                >
                  {type.edits_enabled ? "Enabled" : "Disabled"}
                </Tag>
              </div>
            </div>
            <div className="meta-row">
              <div className="meta-label">ID</div>
              <div className="meta-value meta-value-mono">{type.id}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Properties ---- */}
      <div className="section-card">
        <div className="section-header">
          <h3 className="section-title">Properties</h3>
          <Tag className="section-count" minimal round>
            {properties.length}
          </Tag>
        </div>
        <div className="section-body">
          {properties.length === 0 ? (
            <div className="section-empty">No properties defined</div>
          ) : (
            properties.map((p) => (
              <div className="prop-row" key={p.id}>
                <Icon
                  icon={dataTypeIcon(p.data_type)}
                  size={14}
                  className="prop-icon"
                />
                <span className="prop-name">{p.name}</span>
                <div className="prop-tags">
                  {p.is_title && (
                    <Tag intent={Intent.PRIMARY} minimal round>
                      Title
                    </Tag>
                  )}
                  {p.is_primary_key && (
                    <Tag intent={Intent.WARNING} minimal round>
                      Primary key
                    </Tag>
                  )}
                  {p.required && !p.is_primary_key && (
                    <Tag minimal round>
                      Required
                    </Tag>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ---- Link types ---- */}
      <div className="section-card">
        <div className="section-header">
          <h3 className="section-title">Link types</h3>
          <Tag className="section-count" minimal round>
            {linkCount}
          </Tag>
        </div>
        <div className="section-body">
          {linkCount === 0 ? (
            <div className="section-empty">No links defined</div>
          ) : (
            <table className="links-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Link name</th>
                  <th>Related type</th>
                  <th>Cardinality</th>
                </tr>
              </thead>
              <tbody>
                {outgoingLinks.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Icon icon="arrow-right" size={14} className="link-dir-icon" />
                    </td>
                    <td>{l.name}</td>
                    <td>{typesById.get(l.target_type_id)?.name ?? l.target_type_id}</td>
                    <td>
                      <Tag minimal round>
                        {formatCardinality(l.cardinality)}
                      </Tag>
                    </td>
                  </tr>
                ))}
                {incomingLinks.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Icon icon="arrow-left" size={14} className="link-dir-icon" />
                    </td>
                    <td>{l.inverse_name}</td>
                    <td>{typesById.get(l.source_type_id)?.name ?? l.source_type_id}</td>
                    <td>
                      <Tag minimal round>
                        {formatCardinality(
                          l.cardinality === "many_to_one" ? "one_to_many" : "many_to_one",
                        )}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ---- Action types ---- */}
      <div className="section-card">
        <div className="section-header">
          <h3 className="section-title">Action types</h3>
          <Tag className="section-count" minimal round>
            {actions.length}
          </Tag>
        </div>
        <div className="section-body">
          {actions.length === 0 ? (
            <div className="section-empty">No actions defined</div>
          ) : (
            actions.map((a) => (
              <div className="action-row" key={a.id}>
                <Icon icon="play" size={14} className="action-icon" />
                <div className="action-info">
                  <div className="action-name">{a.name}</div>
                  {a.description && (
                    <div className="action-desc">{a.description}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
