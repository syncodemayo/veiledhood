import { Router } from "express";
import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { getLoginMessage } from "../config/authMessage.js";
import { User } from "../models/User.js";
import { UserBalance } from "../models/UserBalance.js";

const verifyBodySchema = z.object({
  message: z.string(),
  signature: z.string().min(1),
});

export function createAuthRouter(env: Env): Router {
  const router = Router();
  const loginMessage = getLoginMessage(env.LOGIN_MESSAGE);

  router.get("/auth/message", (_req, res) => {
    res.json({ message: loginMessage });
  });

  router.post("/auth/verify", async (req, res) => {
    const parsed = verifyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { message, signature } = parsed.data;

    if (message !== loginMessage) {
      res.status(400).json({ error: "Message does not match expected login message" });
      return;
    }

    let recovered: string;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    const address = recovered.toLowerCase();

    try {
      await User.findOneAndUpdate(
        { address },
        { $setOnInsert: { address } },
        { upsert: true, new: true }
      );
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to persist user" });
      return;
    }

    const token = jwt.sign({ sub: address }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    } as SignOptions);

    const decoded = jwt.decode(token) as JwtPayload | null;
    const exp = typeof decoded?.exp === "number" ? decoded.exp : undefined;

    res.json({
      token,
      address,
      ...(exp !== undefined && { exp }),
    });
  });

  router.get("/auth/validate", async (req, res) => {
    const header = req.headers.authorization;
    const invalidBase = {
      valid: false as const,
      reason: "invalid" as const,
      hasVaultBalance: false,
    };
    if (!header?.startsWith("Bearer ")) {
      res.status(200).json(invalidBase);
      return;
    }
    const raw = header.slice("Bearer ".length).trim();
    if (!raw) {
      res.status(200).json(invalidBase);
      return;
    }

    try {
      const payload = jwt.verify(raw, env.JWT_SECRET) as JwtPayload;
      const sub = payload.sub;
      if (typeof sub !== "string" || !/^0x[a-f0-9]{40}$/i.test(sub)) {
        res.status(200).json(invalidBase);
        return;
      }
      const address = sub.toLowerCase();
      const exp =
        typeof payload.exp === "number" ? payload.exp : undefined;
      const pos = await UserBalance.findOne({
        address,
        totalAmount: { $regex: /^[1-9]\d*$/ },
      })
        .select("_id")
        .lean();
      const hasVaultBalance = pos != null;
      res.status(200).json({
        valid: true,
        address,
        hasVaultBalance,
        ...(exp !== undefined && { exp }),
      });
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        res.status(200).json({
          valid: false,
          reason: "expired" as const,
          hasVaultBalance: false,
        });
        return;
      }
      res.status(200).json(invalidBase);
    }
  });

  return router;
}
