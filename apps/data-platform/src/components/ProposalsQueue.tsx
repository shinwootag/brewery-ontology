import { useState, useEffect, useCallback } from "react";
import {
  Button,
  ButtonGroup,
  Callout,
  Code,
  HTMLTable,
  NonIdealState,
  Spinner,
  Tag,
} from "@blueprintjs/core";
import { fetchProposals, decideProposal } from "../api.ts";
import type { Proposal } from "../api.ts";

/** Identity stamped on the action-invoke call as x-caller-identity. */
const REVIEWER = "brewmaster-lee";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Render action-specific params as compact key/value pairs. */
function formatParams(params: Record<string, unknown> | null) {
  if (!params || Object.keys(params).length === 0) {
    return <span className="bp5-text-muted">&mdash;</span>;
  }
  return (
    <div className="proposal-params">
      {Object.entries(params).map(([key, value]) => (
        <div key={key} className="proposal-param">
          <span className="proposal-param-key">{key}</span>
          <Code>
            {typeof value === "string" ? value : JSON.stringify(value)}
          </Code>
        </div>
      ))}
    </div>
  );
}

interface LaneProps {
  proposals: Proposal[];
  /** Escalated rows carry the standing concern that parked them. */
  showEscalation?: boolean;
  busyId: number | null;
  rowErrors: Record<number, string>;
  onDecide: (p: Proposal, decision: "approve" | "reject") => void;
}

function ProposalTable({
  proposals,
  showEscalation,
  busyId,
  rowErrors,
  onDecide,
}: LaneProps) {
  return (
    <div className="section-card proposals-scroll">
      <HTMLTable className="instance-table proposals-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Target</th>
            <th>Proposed By</th>
            <th>Proposed At</th>
            <th>Rationale</th>
            <th>Parameters</th>
            {showEscalation && <th>Escalation</th>}
            <th style={{ width: 110 }}>Status</th>
            <th style={{ width: 180 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {proposals.map((p) => {
            const err = rowErrors[p.id];
            const busy = busyId === p.id;
            return (
              <tr key={p.id}>
                <td>
                  <Code>{p.type}</Code>
                </td>
                <td>{p.target_id}</td>
                <td>{p.proposed_by}</td>
                <td className="proposal-date">{formatDate(p.proposed_at)}</td>
                <td className="proposal-rationale">{p.rationale}</td>
                <td>{formatParams(p.params)}</td>
                {showEscalation && (
                  <td className="proposal-escalation">
                    <div className="proposal-escalation-note">
                      {p.decision_note ?? (
                        <span className="bp5-text-muted">&mdash;</span>
                      )}
                    </div>
                    {p.reviewed_by && (
                      <div className="proposal-escalation-meta">
                        {p.reviewed_by}
                        {p.reviewed_at ? ` · ${formatDate(p.reviewed_at)}` : ""}
                      </div>
                    )}
                  </td>
                )}
                <td>
                  <Tag
                    minimal
                    round
                    intent={p.status === "escalated" ? "danger" : "warning"}
                  >
                    {p.status}
                  </Tag>
                </td>
                <td>
                  <ButtonGroup>
                    <Button
                      small
                      intent="success"
                      icon="tick"
                      loading={busy}
                      disabled={busy}
                      onClick={() => onDecide(p, "approve")}
                    >
                      Approve
                    </Button>
                    <Button
                      small
                      intent="danger"
                      icon="cross"
                      loading={busy}
                      disabled={busy}
                      onClick={() => onDecide(p, "reject")}
                    >
                      Reject
                    </Button>
                  </ButtonGroup>
                  {err && (
                    <Callout intent="danger" compact className="proposal-row-error">
                      {err}
                    </Callout>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </HTMLTable>
    </div>
  );
}

export function ProposalsQueue() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Per-row transient state, keyed by proposal id.
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  const load = useCallback(() => {
    setLoadError(null);
    fetchProposals()
      .then((all) =>
        setProposals(
          all.filter(
            (p) => p.status === "pending" || p.status === "escalated",
          ),
        ),
      )
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : "Failed to load"),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(
    async (proposal: Proposal, decision: "approve" | "reject") => {
      setBusyId(proposal.id);
      // Clear any prior error for this row before retrying.
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[proposal.id];
        return next;
      });
      try {
        await decideProposal(proposal.id, decision, REVIEWER);
        // Success: reload so the decided proposal drops out of its lane.
        load();
      } catch (err: unknown) {
        // Surface the error next to the row; leave its status unchanged.
        setRowErrors((prev) => ({
          ...prev,
          [proposal.id]: err instanceof Error ? err.message : "Action failed",
        }));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  if (loadError) {
    return (
      <div className="proposals-workspace">
        <div className="instance-list-header">
          <h2 className="instance-list-title">Proposals Queue</h2>
        </div>
        <Callout intent="danger" title="Failed to load proposals">
          {loadError}
        </Callout>
      </div>
    );
  }

  if (proposals == null) {
    return (
      <div className="empty-state">
        <Spinner />
      </div>
    );
  }

  const escalated = proposals.filter((p) => p.status === "escalated");
  const pending = proposals.filter((p) => p.status === "pending");

  const laneProps = { busyId, rowErrors, onDecide: decide };

  return (
    <div className="proposals-workspace">
      <div className="instance-list-header">
        <h2 className="instance-list-title">Proposals Queue</h2>
        <span className="instance-list-count">
          {pending.length} pending
          {escalated.length > 0 ? ` · ${escalated.length} escalated` : ""}
        </span>
      </div>

      {proposals.length === 0 ? (
        <NonIdealState
          icon="inbox"
          title="No open proposals"
          description="Agent-filed proposals awaiting review will appear here."
        />
      ) : (
        <>
          {/* Escalated first: these are parked on a human and are the reason
              someone opens this screen. */}
          {escalated.length > 0 && (
            <section className="proposals-lane">
              <div className="proposals-lane-header">
                <h3 className="proposals-lane-title">Escalated</h3>
                <Tag minimal round intent="danger">
                  {escalated.length}
                </Tag>
                <span className="proposals-lane-hint">
                  An agent could not resolve these. Read the escalation note
                  before deciding.
                </span>
              </div>
              <ProposalTable proposals={escalated} showEscalation {...laneProps} />
            </section>
          )}

          <section className="proposals-lane">
            <div className="proposals-lane-header">
              <h3 className="proposals-lane-title">Pending</h3>
              <Tag minimal round intent="warning">
                {pending.length}
              </Tag>
            </div>
            {pending.length === 0 ? (
              <Callout icon="tick" intent="success">
                No pending proposals.
              </Callout>
            ) : (
              <ProposalTable proposals={pending} {...laneProps} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
