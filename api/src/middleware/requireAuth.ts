import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { Env } from "../config/env.js";

export interface AuthedRequest extends Request {
  walletAddress?: string;
}

export function requireAuth(env: Env) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      res.status(401).json({ error: "Missing token" });
      return;
    }
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
      const sub = payload.sub;
      if (typeof sub !== "string" || !/^0x[a-f0-9]{40}$/i.test(sub)) {
        res.status(401).json({ error: "Invalid token subject" });
        return;
      }
      req.walletAddress = sub.toLowerCase();
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
