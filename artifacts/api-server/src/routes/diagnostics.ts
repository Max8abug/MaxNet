import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/auth";
import { listErrors, clearErrors } from "../lib/error-buffer";

const router: IRouter = Router();

router.get("/diagnostics/errors", requireAdmin, (_req, res) => {
  res.json({ errors: listErrors() });
});

router.delete("/diagnostics/errors", requireAdmin, (_req, res) => {
  clearErrors();
  res.json({ ok: true });
});

export default router;
