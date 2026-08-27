import { Router, type Request, type Response } from "express";
import { getUSDC } from "@shroud-fi/transport";
import type { Env } from "../config/env.js";
import { isShroudFiReady, getShroudFiContext } from "../services/shroudAgent.js";
import { parseAiPriceMap } from "../services/x402Pricing.js";

/**
 * GET /.well-known/x402-bazaar.json
 *
 * Self-listing for any x402 marketplace / discovery indexer. Advertises the
 * Veiledhood endpoints that accept stealth-x402 payments + their prices.
 *
 * `recipientMeta` is the ERC-6538 stealth meta-address — clients that
 * understand ShroudFi can verify the freshness of each `payTo`. Older clients
 * that don't recognize the field simply ignore it; the per-endpoint stealth
 * derivation happens inside the 402 challenge they hit.
 *
 * Returns an empty `endpoints` array (and `enabled: false`) when X402 is not
 * yet configured — keeps the URL valid in every environment.
 */
export function createX402DiscoveryRouter(env: Env): Router {
  const router = Router();

  router.get("/.well-known/x402-bazaar.json", (_req: Request, res: Response): void => {
    if (!isShroudFiReady(env)) {
      res.json({
        name: "Veiledhood",
        homepage: "https://app.veiledhood.to",
        enabled: false,
        endpoints: [],
      });
      return;
    }

    const ctx = getShroudFiContext(env);
    const chainId = ctx.transport.chain.id;
    const usdc = getUSDC(chainId);
    const network = `eip155:${chainId}`;
    const baseUrl = "https://api.veiledhood.to";

    // Per-model price overrides for /ai/chat, if configured. Advertised so
    // agents can pick a model knowing its exact upfront cost. Empty map ⇒
    // field omitted and the flat `price` applies to every model.
    const aiPriceMap = parseAiPriceMap(env);
    const aiPricesByModel = [...aiPriceMap.entries()].map(([model, atomic]) => ({
      model,
      price: { atomic: atomic.toString(), asset: usdc, network },
    }));

    res.json({
      name: "Veiledhood",
      homepage: "https://app.veiledhood.to",
      enabled: true,
      recipientMeta: ctx.recipientMetaAddress,
      facilitator: env.X402_FACILITATOR_URL,
      endpoints: [
        {
          path: "/ai/chat",
          method: "POST",
          description:
            "Private AI inference — encrypted prompts via Arcium + AWS Nitro TEE. Pay with USDC, receive an LLM response.",
          resource: `${baseUrl}/ai/chat`,
          price: {
            atomic: env.X402_PRICE_AI_CHAT_RAW_USDC.toString(),
            asset: usdc,
            network,
          },
          ...(aiPricesByModel.length > 0 ? { pricesByModel: aiPricesByModel } : {}),
        },
        {
          path: "/context/full",
          method: "POST",
          description:
            "Combined shielded + public wallet context. Pooled-RPC k-anonymity for the on-chain query.",
          resource: `${baseUrl}/context/full`,
          price: {
            atomic: env.X402_PRICE_CONTEXT_FULL_RAW_USDC.toString(),
            asset: usdc,
            network,
          },
        },
      ],
    });
  });

  return router;
}
