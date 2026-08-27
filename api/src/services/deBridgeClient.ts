/** Native asset (ETH) on EVM chains per deBridge DLN. */
export const DEBRIDGE_NATIVE = "0x0000000000000000000000000000000000000000";

export type FetchImpl = (url: string | URL, init?: RequestInit) => Promise<Response>;

export class DeBridgeApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`deBridge API ${status}: ${body.slice(0, 300)}`);
    this.name = "DeBridgeApiError";
  }
}

export interface DeBridgeClientConfig {
  apiUrl: string; // create-tx host, e.g. https://dln.debridge.finance/v1.0
  statsApiUrl: string; // status host, e.g. https://dln-api.debridge.finance/api
  referralCode?: string;
  affiliateFeePercent?: number;
  fetchImpl?: FetchImpl;
}

export interface DlnQuoteParams {
  srcChainId: number;
  srcTokenIn: string;
  srcAmountIn: string;
  dstChainId: number;
  dstTokenOut: string;
}

export interface DlnQuote {
  orderId?: string;
  srcAmountIn: string;
  dstAmountOut: string;
}

export interface DlnCreateParams extends DlnQuoteParams {
  dstRecipient: string;
  srcOrderAuthority: string;
  dstOrderAuthority: string;
  senderAddress: string;
}

export interface DlnOrderTx {
  orderId: string;
  dstAmountOut: string;
  tx: { to: string; data: string; value: string };
}

interface CreateTxResponse {
  orderId?: string;
  estimation?: {
    srcChainTokenIn?: { amount?: string };
    dstChainTokenOut?: { amount?: string; recommendedAmount?: string };
  };
  tx?: { to?: string; data?: string; value?: string };
}

export interface DeBridgeClient {
  quote(p: DlnQuoteParams): Promise<DlnQuote>;
  createOrderTx(p: DlnCreateParams): Promise<DlnOrderTx>;
  getOrderStatus(orderId: string): Promise<string>;
  getOrderIdsByTxHash(hash: string): Promise<string[]>;
}

export function createDeBridgeClient(cfg: DeBridgeClientConfig): DeBridgeClient {
  const doFetch: FetchImpl = cfg.fetchImpl ?? ((u, i) => fetch(u, i));
  const apiUrl = cfg.apiUrl.replace(/\/$/, "");
  const statsApiUrl = cfg.statsApiUrl.replace(/\/$/, "");

  async function getJson<T>(url: string): Promise<T> {
    const res = await doFetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new DeBridgeApiError(res.status, body);
    }
    return (await res.json()) as T;
  }

  function createTxUrl(p: DlnQuoteParams, extra: Record<string, string>): string {
    const qs = new URLSearchParams({
      srcChainId: String(p.srcChainId),
      srcChainTokenIn: p.srcTokenIn,
      srcChainTokenInAmount: p.srcAmountIn,
      dstChainId: String(p.dstChainId),
      dstChainTokenOut: p.dstTokenOut,
      dstChainTokenOutAmount: "auto",
      ...(cfg.referralCode ? { referralCode: cfg.referralCode } : {}),
      ...(cfg.affiliateFeePercent != null
        ? { affiliateFeePercent: String(cfg.affiliateFeePercent) }
        : {}),
      ...extra,
    });
    return `${apiUrl}/dln/order/create-tx?${qs.toString()}`;
  }

  function dstAmount(body: CreateTxResponse): string {
    const d = body.estimation?.dstChainTokenOut;
    return d?.recommendedAmount ?? d?.amount ?? "0";
  }

  return {
    async quote(p) {
      const body = await getJson<CreateTxResponse>(createTxUrl(p, {}));
      return {
        orderId: body.orderId,
        srcAmountIn: body.estimation?.srcChainTokenIn?.amount ?? p.srcAmountIn,
        dstAmountOut: dstAmount(body),
      };
    },

    async createOrderTx(p) {
      const url = createTxUrl(p, {
        dstChainTokenOutRecipient: p.dstRecipient,
        srcChainOrderAuthorityAddress: p.srcOrderAuthority,
        dstChainOrderAuthorityAddress: p.dstOrderAuthority,
        senderAddress: p.senderAddress,
      });
      const body = await getJson<CreateTxResponse>(url);
      if (!body.orderId || !body.tx?.to || !body.tx?.data) {
        throw new Error("deBridge create-tx response missing orderId/tx");
      }
      return {
        orderId: body.orderId,
        dstAmountOut: dstAmount(body),
        tx: {
          to: body.tx.to,
          data: body.tx.data,
          value: body.tx.value ?? "0",
        },
      };
    },

    async getOrderStatus(orderId) {
      const body = await getJson<{ state?: string; status?: string }>(
        `${statsApiUrl}/Orders/${orderId}`
      );
      const state = body.state ?? body.status;
      if (!state) throw new Error("deBridge status response missing state");
      return state;
    },

    async getOrderIdsByTxHash(hash) {
      const body = await getJson<{ orderIds?: string[] }>(
        `${statsApiUrl}/Transaction/${hash}/orderIds`
      );
      return body.orderIds ?? [];
    },
  };
}
