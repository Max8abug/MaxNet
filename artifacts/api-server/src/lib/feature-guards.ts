import type { RequestHandler } from "express";
import { isFeatureTemporarilyDisabled } from "@workspace/feature-registry";

export function requireEnabledFeature(feature: string): RequestHandler {
  return (_req, res, next) => {
    if (isFeatureTemporarilyDisabled(feature)) {
      res.status(503).json({
        error: `${feature} is temporarily unavailable.`,
        code: "FEATURE_TEMPORARILY_DISABLED",
      });
      return;
    }
    next();
  };
}
