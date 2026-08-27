import { Router, type Response } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import type { Env } from "../config/env.js";
import {
  requireAuth,
  type AuthedRequest,
} from "../middleware/requireAuth.js";
import { rateLimitAgents } from "../middleware/rateLimit.js";
import { Agent } from "../models/Agent.js";
import { AgentEnvelope } from "../models/AgentEnvelope.js";

/**
 * `/agents` — encrypted agent CRUD + run, plus the per-user master-key
 * envelope. The MCP server is the primary consumer; the API server stays
 * blind (only opaque ciphertext, IV, and lifecycle metadata are stored).
 *
 * Logging policy: NEVER log `ciphertext`, `iv`, `salt`, `iterations` or any
 * params. Always slice addresses to 10 chars + ellipsis.
 */

const ID_REGEX = /^[0-9a-f-]{8,64}$/i;

const AGENT_STRATEGY_KINDS = ["dca", "rebalance", "yield"] as const;
const DATA_KIND = "data" as const;

const createBody = z.object({
  kind: z.enum(["dca", "rebalance", "yield", "data"]),
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  version: z.number().int().min(1).max(99).optional().default(1),
});

const listQuery = z.object({
  kind: z.enum(["dca", "rebalance", "yield", "data"]).optional(),
});

/**
 * Per-kind payload cap. Strategy kinds stay at the original 16 KB; data
 * blobs get the larger DATA_MAX_CIPHERTEXT_BYTES (1 MB default) so partners
 * can store files / docs / JSON rather than just compact strategy params.
 */
function maxCiphertextBytesForKind(
  env: Env,
  kind: "dca" | "rebalance" | "yield" | "data",
): number {
  return kind === DATA_KIND
    ? env.DATA_MAX_CIPHERTEXT_BYTES
    : env.AGENTS_MAX_CIPHERTEXT_BYTES;
}

/** Per-kind per-user item cap (agents cap is separate from data cap). */
function maxPerUserForKind(
  env: Env,
  kind: "dca" | "rebalance" | "yield" | "data",
): number {
  return kind === DATA_KIND ? env.DATA_MAX_PER_USER : env.AGENTS_MAX_PER_USER;
}

const patchBody = z
  .object({
    ciphertext: z.string().min(1).optional(),
    iv: z.string().min(1).optional(),
    status: z.enum(["active", "paused"]).optional(),
  })
  .refine(
    (b) => b.ciphertext !== undefined || b.status !== undefined,
    { message: "must include ciphertext or status" },
  );

const envelopeBody = z.object({
  salt: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  iterations: z.number().int().min(1).max(10_000_000),
  version: z.number().int().min(1).max(99).optional().default(1),
});

function shortAddr(addr: string): string {
  return addr.slice(0, 10) + "…";
}

function exceedsMax(ciphertext: string, maxBytes: number): boolean {
  return Buffer.byteLength(ciphertext, "utf8") > maxBytes;
}

interface AgentDocLike {
  agentId: string;
  kind: "dca" | "rebalance" | "yield" | "data";
  ciphertext: string;
  iv: string;
  version: number;
  status: "active" | "paused" | "deleted";
  lastRunAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

function serializeAgent(doc: AgentDocLike) {
  return {
    agentId: doc.agentId,
    kind: doc.kind,
    ciphertext: doc.ciphertext,
    iv: doc.iv,
    version: doc.version,
    status: doc.status,
    lastRunAt: doc.lastRunAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function createAgentsRouter(env: Env): Router {
  const router = Router();
  const auth = requireAuth(env);
  const limit = rateLimitAgents(env);

  // POST /agents — create
  router.post("/agents", auth, limit, async (req: AuthedRequest, res: Response) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const addr = req.walletAddress!;
    const { kind, ciphertext, iv, version } = parsed.data;

    const maxBytes = maxCiphertextBytesForKind(env, kind);
    if (exceedsMax(ciphertext, maxBytes)) {
      res.status(413).json({
        error: "ciphertext exceeds max size",
        maxBytes,
      });
      return;
    }

    try {
      const kindFilter =
        kind === DATA_KIND ? { kind: DATA_KIND } : { kind: { $in: AGENT_STRATEGY_KINDS } };
      const count = await Agent.countDocuments({
        address: addr,
        status: { $ne: "deleted" },
        ...kindFilter,
      });
      const maxPerUser = maxPerUserForKind(env, kind);
      if (count >= maxPerUser) {
        res.status(409).json({
          error: kind === DATA_KIND ? "data item limit reached" : "agent limit reached",
          max: maxPerUser,
        });
        return;
      }

      const agentId = crypto.randomUUID();
      const doc = await Agent.create({
        address: addr,
        agentId,
        kind,
        ciphertext,
        iv,
        version,
        status: "active",
      });
      console.log(
        `[veiledhood-agents] create user=${shortAddr(addr)} agent=${agentId.slice(0, 8)} kind=${kind}`,
      );
      res.status(201).json({ agentId: doc.agentId, createdAt: doc.createdAt });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[veiledhood-agents] create error user=${shortAddr(addr)} err="${msg.slice(0, 200)}"`,
      );
      res.status(500).json({ error: "Failed to create agent" });
    }
  });

  // GET /agents — list (no ciphertext). Optional ?kind= filter.
  router.get("/agents", auth, limit, async (req: AuthedRequest, res: Response) => {
    const addr = req.walletAddress!;
    const parsedQuery = listQuery.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: "Invalid query", details: parsedQuery.error.flatten() });
      return;
    }
    const kindParam = parsedQuery.data.kind;
    try {
      const filter: Record<string, unknown> = {
        address: addr,
        status: { $ne: "deleted" },
      };
      if (kindParam !== undefined) {
        filter.kind = kindParam;
      }
      const rows = await Agent.find(filter)
        .select("agentId kind status lastRunAt createdAt updatedAt")
        .sort({ createdAt: -1 })
        .lean<
          {
            agentId: string;
            kind: "dca" | "rebalance" | "yield" | "data";
            status: "active" | "paused";
            lastRunAt?: Date | null;
            createdAt: Date;
            updatedAt: Date;
          }[]
        >();
      res.json({
        agents: rows.map((r) => ({
          agentId: r.agentId,
          kind: r.kind,
          status: r.status,
          lastRunAt: r.lastRunAt ?? null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[veiledhood-agents] list error user=${shortAddr(addr)} err="${msg.slice(0, 200)}"`,
      );
      res.status(500).json({ error: "Failed to list agents" });
    }
  });

  // GET /agents/:id — full doc (with ciphertext)
  router.get("/agents/:id", auth, limit, async (req: AuthedRequest, res: Response) => {
    const id = req.params.id;
    if (!ID_REGEX.test(id)) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const addr = req.walletAddress!;
    try {
      const doc = await Agent.findOne({ address: addr, agentId: id }).lean<AgentDocLike | null>();
      if (!doc || doc.status === "deleted") {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      res.json(serializeAgent(doc));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[veiledhood-agents] get error user=${shortAddr(addr)} err="${msg.slice(0, 200)}"`,
      );
      res.status(500).json({ error: "Failed to read agent" });
    }
  });

  // PATCH /agents/:id — update ciphertext/iv and/or status
  router.patch("/agents/:id", auth, limit, async (req: AuthedRequest, res: Response) => {
    const id = req.params.id;
    if (!ID_REGEX.test(id)) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const addr = req.walletAddress!;
    const { ciphertext, iv, status } = parsed.data;

    if (ciphertext !== undefined && iv === undefined) {
      res.status(400).json({ error: "iv must be supplied alongside ciphertext" });
      return;
    }

    const update: Record<string, unknown> = {};
    if (ciphertext !== undefined) {
      update.ciphertext = ciphertext;
      update.iv = iv;
    }
    if (status !== undefined) update.status = status;

    try {
      // Look up existing kind to apply the right payload cap.
      if (ciphertext !== undefined) {
        const existing = await Agent.findOne(
          { address: addr, agentId: id, status: { $ne: "deleted" } },
          { kind: 1 },
        ).lean<{ kind: "dca" | "rebalance" | "yield" | "data" } | null>();
        if (!existing) {
          res.status(404).json({ error: "agent not found" });
          return;
        }
        const maxBytes = maxCiphertextBytesForKind(env, existing.kind);
        if (exceedsMax(ciphertext, maxBytes)) {
          res.status(413).json({
            error: "ciphertext exceeds max size",
            maxBytes,
          });
          return;
        }
      }
      const doc = await Agent.findOneAndUpdate(
        { address: addr, agentId: id, status: { $ne: "deleted" } },
        update,
        { new: true },
      ).lean<{ updatedAt: Date } | null>();
      if (!doc) {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      console.log(
        `[veiledhood-agents] patch user=${shortAddr(addr)} agent=${id.slice(0, 8)} fields=${Object.keys(update).join(",")}`,
      );
      res.json({ ok: true, updatedAt: doc.updatedAt });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[veiledhood-agents] patch error user=${shortAddr(addr)} err="${msg.slice(0, 200)}"`,
      );
      res.status(500).json({ error: "Failed to update agent" });
    }
  });

  // DELETE /agents/:id — soft delete
  router.delete("/agents/:id", auth, limit, async (req: AuthedRequest, res: Response) => {
    const id = req.params.id;
    if (!ID_REGEX.test(id)) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const addr = req.walletAddress!;
    try {
      const doc = await Agent.findOneAndUpdate(
        { address: addr, agentId: id, status: { $ne: "deleted" } },
        { status: "deleted" },
        { new: true },
      ).lean<{ agentId: string } | null>();
      if (!doc) {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      console.log(
        `[veiledhood-agents] delete user=${shortAddr(addr)} agent=${id.slice(0, 8)}`,
      );
      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[veiledhood-agents] delete error user=${shortAddr(addr)} err="${msg.slice(0, 200)}"`,
      );
      res.status(500).json({ error: "Failed to delete agent" });
    }
  });

  // POST /agents/:id/run — bump lastRunAt and return full doc
  router.post("/agents/:id/run", auth, limit, async (req: AuthedRequest, res: Response) => {
    const id = req.params.id;
    if (!ID_REGEX.test(id)) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const addr = req.walletAddress!;
    const startedAt = Date.now();
    try {
      const doc = await Agent.findOneAndUpdate(
        { address: addr, agentId: id, status: { $ne: "deleted" } },
        { lastRunAt: new Date() },
        { new: true },
      ).lean<AgentDocLike | null>();
      if (!doc) {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      const elapsedMs = Date.now() - startedAt;
      console.log(
        `[veiledhood-agents] run user=${shortAddr(addr)} agent=${id.slice(0, 8)} elapsed=${elapsedMs}ms`,
      );
      res.json(serializeAgent(doc));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[veiledhood-agents] run error user=${shortAddr(addr)} err="${msg.slice(0, 200)}"`,
      );
      res.status(500).json({ error: "Failed to run agent" });
    }
  });

  // POST /agents/keys/envelope — upsert master-key envelope
  router.post(
    "/agents/keys/envelope",
    auth,
    limit,
    async (req: AuthedRequest, res: Response) => {
      const parsed = envelopeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
        return;
      }
      const addr = req.walletAddress!;
      const { salt, iv, ciphertext, iterations, version } = parsed.data;

      if (exceedsMax(ciphertext, env.AGENTS_MAX_CIPHERTEXT_BYTES)) {
        res.status(413).json({
          error: "ciphertext exceeds max size",
          maxBytes: env.AGENTS_MAX_CIPHERTEXT_BYTES,
        });
        return;
      }
      try {
        const doc = await AgentEnvelope.findOneAndUpdate(
          { address: addr },
          { address: addr, salt, iv, ciphertext, iterations, version },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ).lean<{ updatedAt: Date } | null>();
        console.log(
          `[veiledhood-agents] envelope upsert user=${shortAddr(addr)} iterations=${iterations} version=${version}`,
        );
        res.status(201).json({ ok: true, updatedAt: doc?.updatedAt ?? new Date() });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          `[veiledhood-agents] envelope upsert error user=${shortAddr(addr)} err="${msg.slice(0, 200)}"`,
        );
        res.status(500).json({ error: "Failed to save envelope" });
      }
    },
  );

  // GET /agents/keys/envelope — read master-key envelope
  router.get(
    "/agents/keys/envelope",
    auth,
    limit,
    async (req: AuthedRequest, res: Response) => {
      const addr = req.walletAddress!;
      try {
        const doc = await AgentEnvelope.findOne({ address: addr }).lean<{
          salt: string;
          iv: string;
          ciphertext: string;
          iterations: number;
          version: number;
          createdAt: Date;
          updatedAt: Date;
        } | null>();
        if (!doc) {
          res.status(404).json({ error: "envelope not found" });
          return;
        }
        res.json({
          salt: doc.salt,
          iv: doc.iv,
          ciphertext: doc.ciphertext,
          iterations: doc.iterations,
          version: doc.version,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          `[veiledhood-agents] envelope read error user=${shortAddr(addr)} err="${msg.slice(0, 200)}"`,
        );
        res.status(500).json({ error: "Failed to read envelope" });
      }
    },
  );

  return router;
}
