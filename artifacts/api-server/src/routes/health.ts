import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// The server clock is the canonical reference for live timers and relative
// presence calculations. It avoids relying on a user's potentially skewed
// device clock while historical timestamps remain absolute ISO values.
router.get("/time", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ serverNow: new Date().toISOString() });
});

export default router;
