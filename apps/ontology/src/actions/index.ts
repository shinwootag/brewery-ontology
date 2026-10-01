import { batchDeferStart } from "./manufacturing/batchDeferStart.ts";
import { tankScheduleMaintenance } from "./manufacturing/tankScheduleMaintenance.ts";
import { batchCancel } from "./manufacturing/batchCancel.ts";
import { batchFlag } from "./manufacturing/batchFlag.ts";
import { batchPlaceOnHold } from "./manufacturing/batchPlaceOnHold.ts";
import { batchExtendRest } from "./manufacturing/batchExtendRest.ts";
import { batchScheduleEarlyTransfer } from "./manufacturing/batchScheduleEarlyTransfer.ts";
import { proposalApprove } from "./shared/proposalApprove.ts";
import { proposalReject } from "./shared/proposalReject.ts";
import { proposalEscalate } from "./shared/proposalEscalate.ts";

export interface ActionContext {
  objectType: {
    id: string;
    api_name: string;
    schema: string;
    datasource_table: string;
  };
  actionType: {
    id: string;
    api_name: string;
    parameter_schema: unknown;
  };
  /**
   * Who invoked the action, taken from the `x-caller-identity` request header
   * (stamped by agents). Undefined for anonymous/direct callers; handlers
   * should fall back to "system" when writing the audit actor.
   */
  callerIdentity?: string;
  /**
   * Set when this action is being invoked because an approved proposal
   * authorized it. Handlers record it in the audit row's
   * `authorized_by_proposal` column so the proposal → action chain is explicit.
   */
  authorizedByProposal?: string;
}

export type ActionHandler = (
  instance: Record<string, unknown>,
  params: Record<string, unknown>,
  context: ActionContext,
) => Promise<Record<string, unknown>>;

/** Dispatch map keyed by "objectTypeApiName.actionApiName" */
export const actionHandlers: Record<string, ActionHandler> = {
  "batch.deferStart": batchDeferStart,
  "batch.cancel": batchCancel,
  "batch.flag": batchFlag,
  "batch.placeOnHold": batchPlaceOnHold,
  "batch.extendRest": batchExtendRest,
  "batch.scheduleEarlyTransfer": batchScheduleEarlyTransfer,
  "tank.scheduleMaintenance": tankScheduleMaintenance,
  "proposal.approve": proposalApprove,
  "proposal.reject": proposalReject,
  "proposal.escalate": proposalEscalate,
};
