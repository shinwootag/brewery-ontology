import { useState, useEffect, useMemo } from "react";
import {
  Spinner,
  NonIdealState,
  Tag,
  Switch,
  HTMLSelect,
  HTMLTable,
  Icon,
  Tooltip,
  Intent,
} from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { fetchInstances } from "../api.ts";
import { courseNow } from "../courseTime.ts";
import { BatchDetailPanel } from "./BatchDetailPanel.tsx";
import {
  analyzeBatch,
  recentMaintenanceTankIds,
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

interface Row {
  batch: Batch;
  recipeName: string;
  tankId: string | null;
  tankName: string | null;
  recentMaint: boolean;
  delta: number | null;
  status: SugarStatus | null;
  behind: boolean;
}

/* ------------------------------------------------------------------ */
/*  Small presentational pieces                                        */
/* ------------------------------------------------------------------ */

function MetricCard({
  icon,
  label,
  value,
  sub,
  intent,
}: {
  icon: IconName;
  label: string;
  value: number;
  sub: string;
  intent?: "warning" | "danger";
}) {
  return (
    <div className={`metric-card${intent ? ` intent-${intent}` : ""}`}>
      <div className="metric-card-head">
        <Icon icon={icon} size={14} className="metric-card-icon" />
        <span className="metric-card-label">{label}</span>
      </div>
      <div className="metric-card-value">{value}</div>
      <div className="metric-card-sub">{sub}</div>
    </div>
  );
}

function SugarCell({ row }: { row: Row }) {
  if (row.delta == null || row.status == null || row.batch.current_sugar_level == null) {
    return <span className="bp5-text-muted">—</span>;
  }
  const sign = row.delta > 0 ? "+" : row.delta < 0 ? "−" : "±";
  return (
    <span className="sugar-cell">
      <span className="sugar-current">{row.batch.current_sugar_level}</span>
      <Tag round intent={SUGAR_INTENT[row.status]} title="vs. target sugar curve">
        {sign}
        {Math.abs(row.delta).toFixed(3)}
      </Tag>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Workspace                                                          */
/* ------------------------------------------------------------------ */

export function BatchInvestigation() {
  const [data, setData] = useState<{
    batches: Batch[];
    recipes: Recipe[];
    tanks: Tank[];
    logs: MaintenanceLog[];
  } | null>(null);

  const [statusFilter, setStatusFilter] = useState("all");
  const [tankFilter, setTankFilter] = useState("all");
  const [behindOnly, setBehindOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchInstances("batch"),
      fetchInstances("recipe"),
      fetchInstances("tank"),
      fetchInstances("maintenanceLog"),
    ]).then(([batches, recipes, tanks, logs]) => {
      setData({
        batches: batches as Batch[],
        recipes: recipes as Recipe[],
        tanks: tanks as Tank[],
        logs: logs as MaintenanceLog[],
      });
    });
  }, []);

  // COURSE_NOW is fixed for the session; compute once.
  const now = useMemo(() => courseNow(), []);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const recById = new Map(data.recipes.map((r) => [r.id, r]));
    const tankById = new Map(data.tanks.map((t) => [t.id, t]));
    const recentTanks = recentMaintenanceTankIds(data.logs, now);

    return data.batches.map((batch) => {
      const recipe = batch.recipe_id ? recById.get(batch.recipe_id) : undefined;
      const { delta, status, behind } = analyzeBatch(batch, recipe);
      const tankId = batch.assigned_tank_id ?? null;
      const tank = tankId ? tankById.get(tankId) : undefined;
      return {
        batch,
        recipeName: recipe?.name ?? batch.recipe_id ?? "—",
        tankId,
        tankName: tank?.name ?? null,
        recentMaint: tankId != null && recentTanks.has(tankId),
        delta,
        status,
        behind,
      };
    });
  }, [data, now]);

  const fermenting = useMemo(
    () => rows.filter((r) => r.batch.status === "fermenting"),
    [rows],
  );

  const metrics = useMemo(
    () => ({
      fermenting: fermenting.length,
      behind: fermenting.filter((r) => r.behind).length,
      recentMaint: fermenting.filter((r) => r.recentMaint).length,
    }),
    [fermenting],
  );

  const statuses = useMemo(
    () => [...new Set(rows.map((r) => r.batch.status))].sort(),
    [rows],
  );

  const tankOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.tankId) seen.set(r.tankId, r.tankName ?? r.tankId);
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (statusFilter === "all" || r.batch.status === statusFilter) &&
          (tankFilter === "all" || r.tankId === tankFilter) &&
          (!behindOnly || r.behind),
      ),
    [rows, statusFilter, tankFilter, behindOnly],
  );

  if (!data) {
    return (
      <div className="empty-state" style={{ flex: 1 }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div className="bi-workspace">
      <div className="bi-header">
        <h1 className="bi-header-title">Batch Investigation</h1>
        <div className="bi-header-sub">
          Date windows computed against course time · {now.toISOString().slice(0, 10)}
        </div>
      </div>

      {/* ---- Metric cards ---- */}
      <div className="bi-metrics">
        <MetricCard
          icon="lab-test"
          label="Fermenting Batches"
          value={metrics.fermenting}
          sub="status = fermenting"
        />
        <MetricCard
          icon="warning-sign"
          label="Behind Target"
          value={metrics.behind}
          sub="≥ 0.008 behind sugar curve"
          intent={metrics.behind > 0 ? "danger" : undefined}
        />
        <MetricCard
          icon="wrench"
          label="Recent Tank Maintenance"
          value={metrics.recentMaint}
          sub="tank serviced in last 7 days"
          intent={metrics.recentMaint > 0 ? "warning" : undefined}
        />
      </div>

      <div className="bi-body">
        {/* ---- Left: filters + batch table ---- */}
        <div className="bi-left">
          <div className="bi-filters">
            <label className="bi-filter">
              Status
              <HTMLSelect
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.currentTarget.value)}
              >
                <option value="all">All</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </HTMLSelect>
            </label>

            <label className="bi-filter">
              Tank
              <HTMLSelect
                value={tankFilter}
                onChange={(e) => setTankFilter(e.currentTarget.value)}
              >
                <option value="all">All</option>
                {tankOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </HTMLSelect>
            </label>

            <Switch
              className="bi-behind-toggle"
              checked={behindOnly}
              label="Behind target only"
              onChange={() => setBehindOnly((v) => !v)}
              inline
            />
          </div>

          <div className="section-card">
            <div className="section-header">
              <h3 className="section-title">Batches</h3>
              <Tag className="section-count" minimal round>
                {filtered.length === rows.length
                  ? rows.length
                  : `${filtered.length} of ${rows.length}`}
              </Tag>
            </div>

            {filtered.length === 0 ? (
              <NonIdealState
                icon="filter"
                title="No batches"
                description="No batches match the current filters."
              />
            ) : (
              <HTMLTable interactive className="batch-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Recipe</th>
                    <th>Sugar vs Target</th>
                    <th style={{ width: 80 }}>Days</th>
                    <th>Tank</th>
                    <th style={{ width: 120 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.batch.id}
                      className={r.batch.id === selectedId ? "selected" : undefined}
                      onClick={() => setSelectedId(r.batch.id)}
                    >
                      <td>{r.batch.id}</td>
                      <td>{r.recipeName}</td>
                      <td>
                        <SugarCell row={r} />
                      </td>
                      <td>
                        {r.batch.days_fermenting ?? (
                          <span className="bp5-text-muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className="tank-cell">
                          {r.tankName ?? r.tankId ?? (
                            <span className="bp5-text-muted">—</span>
                          )}
                          {r.recentMaint && (
                            <Tooltip content="Tank serviced in the last 7 days">
                              <Icon
                                icon="wrench"
                                size={12}
                                className="tank-maint-icon"
                              />
                            </Tooltip>
                          )}
                        </span>
                      </td>
                      <td>
                        <Tag
                          minimal
                          round
                          intent={
                            r.batch.status === "fermenting"
                              ? Intent.PRIMARY
                              : Intent.NONE
                          }
                        >
                          {r.batch.status}
                        </Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            )}
          </div>
        </div>

        {/* ---- Right: batch detail panel ---- */}
        {selectedId ? (
          <BatchDetailPanel
            key={selectedId}
            batchId={selectedId}
            now={now}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <div className="section-card bi-detail-panel">
            <div className="section-header">
              <h3 className="section-title">Batch Detail</h3>
            </div>
            <NonIdealState
              icon="panel-stats"
              title="No batch selected"
              description="Select a batch to inspect it here."
            />
          </div>
        )}
      </div>
    </div>
  );
}
