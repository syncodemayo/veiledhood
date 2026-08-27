import { Router } from "express";
import mongoose from "mongoose";

const router = Router();

function dbStatus(): "connected" | "disconnected" | "connecting" | "disconnecting" {
  switch (mongoose.connection.readyState) {
    case 1:
      return "connected";
    case 2:
      return "connecting";
    case 3:
      return "disconnecting";
    default:
      return "disconnected";
  }
}

router.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "veiledhood-api",
    db: dbStatus(),
  });
});

export default router;
