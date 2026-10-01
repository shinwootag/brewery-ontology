import { useState, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import {
  Spinner,
  NonIdealState,
  Tag,
  Icon,
  Collapse,
  Button,
  Intent,
} from "@blueprintjs/core";
import { fetchInstance, fetchInstances, fetchAudit } from "../api.ts";
import type { AuditEntry } from "../api.ts";
import {
  analyzeBatch,
  targetSugarAt,
  fermentationWindow,
  isWithinWindow,
} from "../batchAnalysis.ts";
import type {
  Batch,
  Recipe,
  Tank,
  MaintenanceLog,
  SugarStatus,
} from "../batchAnalysis.ts";

const SUGAR_INTENT: Record<SugarStatus, Intent> = {
  ok: Intent.SUCCESS,
  warn: Intent.WARNING,
  bad: Intent.DANGER,
};

const fmtDate = (s?: string | null) =>
  s
    ? new Date(s).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");

const signed = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(3)}`;

interface PanelData {
  batch: Batch & { links?: Record<string, unknown> };
  recipe: Recipe | null;
  tank: Tank | null;
  qualityTests: Record<string, unknown>[];
  tankLogs: MaintenanceLog[];
  audit: AuditEntry[];
}

/* ------------------------------------------------------------------ */
/*  Reusable bits                                                      */
/* ------------------------------------------------------------------ */

function Section({
  title,
  right,
  defaultOpen = true,
  children,
}: {
  title: string;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="detail-section">
      <div className="detail-section-header" onClick={() => setOpen((o) => !o)}>
        <Icon
          className="detail-section-icon"
          icon={open ? "chevron-down" : "chevron-right"}
          size={14}
        />
        <span className="detail-section-title">{title}</span>
        {right}
      </div>
      <Collapse isOpen={open}>
        <div className="detail-section-body">{children}</div>
      </Collapse>
    </div>
  );
}

function Field({ label, children }: { label: string; children?: ReactNode }) {
  const empty = children == null || children === "";
  return (
    <div className="detail-field">
      <div className="detail-field-label">{label}</div>
      <div className="detail-field-value">
        {empty ? <span className="bp5-text-muted">—</span> : children}
      </div>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="audit-row">
      <div className="audit-row-head" onClick={() => setOpen((o) => !o)}>
        <Icon
          className="detail-section-icon"
          icon={open ? "chevron-down" : "chevron-right"}
          size={12}
        />
        <span className="audit-row-action">{entry.action}</span>
        <span className="audit-row-actor">· {entry.actor}</span>
        <span className="audit-row-time">{fmtDateTime(entry.timestamp)}</span>
      </div>
      <Collapse isOpen={open}>
        <div className="audit-detail">
          <div className="detail-subtle-label">params</div>
          <pre className="audit-json">{JSON.stringify(entry.params, null, 2)}</pre>
          {entry.result != null && (
            <>
              <div className="detail-subtle-label">result</div>
              <pre className="audit-json">{JSON.stringify(entry.result, null, 2)}</pre>
            </>
          )}
        </div>
      </Collapse>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export function BatchDetailPanel({
  batchId,
  now,
  onClose,
}: {
  batchId: string;
  now: Date;
  onClose: () => void;
}) {
  const [data, setData] = useState<PanelData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);

    // Batch (with resolved links), the tank's maintenance logs via the list
    // route, and audit entries — all in parallel.
    Promise.all([
      fetchInstance("batch", batchId),
      fetchInstances("maintenanceLog"),
      fetchAudit("batch", batchId),
    ])
      .then(([inst, logs, audit]) => {
        if (cancelled) return;
        const batch = inst as Batch & { links?: Record<string, unknown> };
        const links = batch.links ?? {};
        const recipe = (links.recipe ?? null) as Recipe | null;
        const tank = (links.assignedTank ?? null) as Tank | null;
        const qualityTests = (
          Array.isArray(links.qualityTests) ? links.qualityTests : []
        ) as Record<string, unknown>[];

        const tankId = batch.assigned_tank_id;
        const tankLogs = (logs as MaintenanceLog[])
          .filter(
            (l) =>
              l.target_type === "tank" && tankId != null && l.target_id === tankId,
          )
          .sort(
            (a, b) =>
              new Date(b.completed_at ?? b.started_at ?? 0).getTime() -
              new Date(a.completed_at ?? a.started_at ?? 0).getTime(),
          );

        setData({ batch, recipe, tank, qualityTests, tankLogs, audit });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });

    return () => {
      cancelled = true;
    };
  }, [batchId]);

  const analysis = useMemo(
    () => (data ? analyzeBatch(data.batch, data.recipe ?? undefined) : null),
    [data],
  );
  const fermWindow = useMemo(
    () => (data ? fermentationWindow(data.batch, data.recipe ?? undefined, now) : null),
    [data, now],
  );

  const header = (
    <div className="detail-panel-header">
      <div>
        <h3 className="detail-panel-title">{batchId}</h3>
        <div className="detail-panel-sub">Batch investigation</div>
      </div>
      <Button icon="cross" minimal onClick={onClose} aria-label="Close detail" />
    </div>
  );

  if (error) {
    return (
      <div className="section-card bi-detail-panel">
        {header}
        <NonIdealState icon="error" title="Couldn't load batch" description={error} />
      </div>
    );
  }
  if (!data || !analysis) {
    return (
      <div className="section-card bi-detail-panel">
        {header}
        <div className="empty-state" style={{ padding: 40 }}>
          <Spinner size={28} />
        </div>
      </div>
    );
  }

  const { batch, recipe, tank, qualityTests, tankLogs, audit } = data;

  const curve = recipe?.target_sugar_curve ?? null;
  const currentDay = batch.days_fermenting;
  const curvePoints = curve
    ? Object.entries(curve)
        .map(([k, v]) => [Number(k.replace(/^day_/, "")), Number(v)] as [number, number])
        .sort((a, b) => a[0] - b[0])
    : [];
  const targetNow = targetSugarAt(curve, currentDay);

  return (
    <div className="section-card bi-detail-panel">
      {header}

      {/* ---- Batch ---- */}
      <Section
        title="Batch"
        right={
          analysis.status && analysis.delta != null ? (
            <Tag round intent={SUGAR_INTENT[analysis.status]}>
              {signed(analysis.delta)}
            </Tag>
          ) : undefined
        }
      >
        <Field label="Sugar level">
          {batch.current_sugar_level != null ? (
            <>
              {batch.current_sugar_level}
              {targetNow != null && (
                <span className="bp5-text-muted"> (target {targetNow.toFixed(3)})</span>
              )}
            </>
          ) : null}
        </Field>
        <Field label="Temperature">
          {batch.current_temperature != null ? `${batch.current_temperature} °C` : null}
        </Field>
        <Field label="Days fermenting">{currentDay ?? null}</Field>
        <Field label="Planned start">{batch.planned_start ? fmtDate(batch.planned_start) : null}</Field>
        <Field label="Operator note">
          {batch.last_operator_note ? (
            <div className="detail-note">{batch.last_operator_note}</div>
          ) : null}
        </Field>
      </Section>

      {/* ---- Recipe ---- */}
      <Section title="Recipe">
        {recipe ? (
          <>
            <Field label="Name">{recipe.name}</Field>
            <Field label="Fermentation">
              {recipe.fermentation_days != null ? `${recipe.fermentation_days} days` : null}
            </Field>
            <Field label="Sensitivity">
              {recipe.notes ? <div className="detail-note">{recipe.notes}</div> : null}
            </Field>
            <Field label="Sugar curve">
              <div className="curve-points">
                {curvePoints.map(([d, v]) => (
                  <span key={d} className={`curve-pt${d === currentDay ? " hl" : ""}`}>
                    d{d}: {v}
                  </span>
                ))}
              </div>
              {targetNow != null && currentDay != null && (
                <div className="curve-target">
                  Target @ day {currentDay}: <strong>{targetNow.toFixed(3)}</strong>
                </div>
              )}
            </Field>
          </>
        ) : (
          <div className="detail-empty">No recipe linked.</div>
        )}
      </Section>

      {/* ---- Tank + Maintenance ---- */}
      <Section
        title="Tank + Maintenance"
        right={<Tag minimal round>{tankLogs.length}</Tag>}
      >
        {tank ? (
          <>
            <Field label="Tank">
              {tank.name}{" "}
              <Tag minimal round>
                {tank.status}
              </Tag>
            </Field>
            {tankLogs.length === 0 ? (
              <div className="detail-empty">No maintenance history.</div>
            ) : (
              tankLogs.map((log) => {
                const inWindow = isWithinWindow(
                  log.completed_at ?? log.started_at,
                  fermWindow,
                );
                return (
                  <div key={log.id} className="maint-item">
                    <div className="maint-item-head">
                      <span className="maint-item-title">{log.type}</span>
                      <Tag minimal round>
                        {log.status}
                      </Tag>
                      {inWindow && (
                        <Tag intent={Intent.WARNING} round>
                          In fermentation window
                        </Tag>
                      )}
                    </div>
                    <div className="maint-item-meta">
                      {fmtDate(log.started_at)}
                      {log.completed_at ? ` → ${fmtDate(log.completed_at)}` : ""}
                    </div>
                    {log.notes && <div className="maint-item-notes">{log.notes}</div>}
                  </div>
                );
              })
            )}
          </>
        ) : (
          <div className="detail-empty">No tank assigned.</div>
        )}
      </Section>

      {/* ---- Quality Tests ---- */}
      <Section
        title="Quality Tests"
        right={<Tag minimal round>{qualityTests.length}</Tag>}
      >
        {qualityTests.length === 0 ? (
          <div className="detail-empty">No quality tests.</div>
        ) : (
          qualityTests
            .slice()
            .sort(
              (a, b) =>
                new Date(String(b.test_date ?? 0)).getTime() -
                new Date(String(a.test_date ?? 0)).getTime(),
            )
            .map((qt, i) => (
              <div key={String(qt.id ?? i)} className="qt-item">
                <div className="qt-item-head">
                  <span className="maint-item-title">{fmtDate(qt.test_date as string)}</span>
                  {qt.tested_by != null && (
                    <span className="maint-item-meta">· {String(qt.tested_by)}</span>
                  )}
                </div>
                <div className="qt-metrics">
                  <span className="qt-metric">
                    <span>pH </span>
                    {qt.ph != null ? String(qt.ph) : "—"}
                  </span>
                  <span className="qt-metric">
                    <span>sugar </span>
                    {qt.sugar_level != null ? String(qt.sugar_level) : "—"}
                  </span>
                </div>
                {qt.notes != null && (
                  <div className="maint-item-notes">{String(qt.notes)}</div>
                )}
              </div>
            ))
        )}
      </Section>

      {/* ---- Audit ---- */}
      <Section
        title="Audit"
        right={<Tag minimal round>{audit.length}</Tag>}
        defaultOpen={false}
      >
        {audit.length === 0 ? (
          <div className="audit-empty">No audit entries.</div>
        ) : (
          audit.map((e) => <AuditRow key={e.id} entry={e} />)
        )}
      </Section>
    </div>
  );
}
