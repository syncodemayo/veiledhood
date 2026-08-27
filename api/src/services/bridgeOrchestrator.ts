import { Bridge, type BridgeStatus, type IBridge } from "../models/Bridge.js";

/** Side-effecting steps. Production impl wires Plan 3a + Plan 2; tests inject a fake. */
export interface BridgeExecutor {
  fundSourceGas(b: IBridge): Promise<string>; // gas top-up tx hash
  sourceWithdraw(b: IBridge): Promise<{ adminWithdrawTxHash: string }>;
  submitDeBridgeOrder(b: IBridge): Promise<{ orderId: string; bridgeTxHash: string }>;
  waitForFulfillment(orderId: string): Promise<{ received: bigint }>;
  fundDestGas(b: IBridge): Promise<string>;
  destDepositAndCredit(b: IBridge): Promise<{ depositTxHash: string }>;
  /** Re-credit the user's source leaf when the bridge fails before fulfillment. */
  refundToSource(b: IBridge): Promise<void>;
}

const TERMINAL: BridgeStatus[] = ["complete", "failed", "refunded"];
/**
 * Up to and including this status, a failure is refundable (funds still on the
 * source side — escrow or user leaf). NOTE: `bridge_submitted` is deliberately
 * NOT here: once the order tx lands, the funds have left the escrow into
 * deBridge and are mid-flight, so a failure while polling for fulfillment must
 * NOT refund — it leaves the doc non-terminal for resume-on-boot to finish the
 * dest leg.
 */
const PRE_FULFILLMENT: BridgeStatus[] = [
  "created",
  "source_split",
  "source_withdrawn",
];

async function setStatus(bridgeId: string, status: BridgeStatus, extra: Record<string, unknown> = {}) {
  await Bridge.updateOne({ bridgeId }, { $set: { status, ...extra } });
}

/**
 * Advance a bridge from its current status to a terminal one, one executor
 * step per status. Idempotent: safe to call repeatedly (used by resume).
 */
export async function driveBridge(bridgeId: string, exec: BridgeExecutor): Promise<void> {
  // Loop until terminal. Each iteration loads the freshest doc.
  // A guard caps iterations to the number of states to avoid any infinite loop.
  for (let i = 0; i < 16; i++) {
    const b = await Bridge.findOne({ bridgeId }).lean<IBridge | null>();
    if (!b) throw new Error(`bridge ${bridgeId} not found`);
    if (TERMINAL.includes(b.status)) return;

    try {
      switch (b.status) {
        case "created": {
          const tx = await exec.fundSourceGas(b);
          await setStatus(bridgeId, "source_split", { sourceRootBeforeTxHash: tx });
          break;
        }
        case "source_split": {
          const r = await exec.sourceWithdraw(b);
          await setStatus(bridgeId, "source_withdrawn", {
            sourceWithdrawTxHash: r.adminWithdrawTxHash,
          });
          break;
        }
        case "source_withdrawn": {
          const r = await exec.submitDeBridgeOrder(b);
          await setStatus(bridgeId, "bridge_submitted", {
            deBridgeOrderId: r.orderId,
            bridgeTxHash: r.bridgeTxHash,
          });
          break;
        }
        case "bridge_submitted": {
          const fresh = await Bridge.findOne({ bridgeId }).lean<IBridge | null>();
          const r = await exec.waitForFulfillment(fresh!.deBridgeOrderId!);
          await setStatus(bridgeId, "bridge_fulfilled", {
            amountReceived: r.received.toString(),
          });
          break;
        }
        case "bridge_fulfilled": {
          const tx = await exec.fundDestGas(b);
          await setStatus(bridgeId, "dest_deposited", { destDepositTxHash: tx });
          break;
        }
        case "dest_deposited": {
          const r = await exec.destDepositAndCredit(b);
          await setStatus(bridgeId, "dest_credited", { destRootAfterTxHash: r.depositTxHash });
          break;
        }
        case "dest_credited": {
          await setStatus(bridgeId, "complete");
          break;
        }
        default:
          throw new Error(`unhandled bridge status ${b.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (PRE_FULFILLMENT.includes(b.status)) {
        // Refundable: funds are still on the source side (escrow or user leaf).
        try {
          await exec.refundToSource(b);
          await setStatus(bridgeId, "failed", { error: message });
        } catch (refundErr) {
          const rmsg = refundErr instanceof Error ? refundErr.message : String(refundErr);
          await setStatus(bridgeId, "failed", { error: `${message} | refund failed: ${rmsg}` });
        }
        return;
      }
      // At/after fulfillment: do NOT refund (funds are mid-flight or already on
      // dest). Leave the doc at its current status for resume-on-boot to retry.
      throw err;
    }
  }
  throw new Error(`bridge ${bridgeId} did not reach a terminal state within the step cap`);
}

/** Resume every non-terminal bridge on boot. */
export async function resumeIncompleteBridges(
  makeExecutor: (b: IBridge) => BridgeExecutor
): Promise<void> {
  const stuck = await Bridge.find({
    status: { $nin: TERMINAL },
  })
    .select("bridgeId")
    .lean<{ bridgeId: string }[]>();
  for (const s of stuck) {
    const b = await Bridge.findOne({ bridgeId: s.bridgeId }).lean<IBridge | null>();
    if (!b) continue;
    try {
      await driveBridge(s.bridgeId, makeExecutor(b));
      console.log(`[veiledhood-bridge] resumed ${s.bridgeId}`);
    } catch (e) {
      console.error(`[veiledhood-bridge] failed to resume ${s.bridgeId}:`, e);
    }
  }
}
