import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware, trackPresence } from "./lib/auth";
import { recordError, describeError } from "./lib/error-buffer";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
// Global JSON body parser. We deliberately exclude /api/admin/import here
// because that route installs its own parser with a much higher limit (a
// real site backup is hundreds of MB; the 10MB cap that protects every
// other endpoint would cause the upload to fail before the route handler
// even runs). Anonymous traffic still hits the 10MB cap because the route-
// specific parser is gated behind requireAdmin.
const globalJson = express.json({ limit: "10mb" });
app.use((req, res, next) => {
  if (req.path === "/api/admin/import") return next();
  return globalJson(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(sessionMiddleware);
app.use(trackPresence);

app.use("/api", router);

// Centralised error handler. Without this Express returns a bare HTML 500 with
// no logging, so a single uncaught DB error in production looks identical to a
// healthy 200 in the access log and the user just sees "HTTP 500" with no
// hint as to why. With this in place we get a structured stack trace in the
// pino logs and a JSON body the client can show to the user.
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  logger.error(
    { err, method: req.method, url: req.url?.split("?")[0] },
    "Unhandled error in request",
  );
  // Capture into the in-memory ring buffer so admins can review recent
  // failures via the diagnostics window without needing access to raw
  // container logs. We unwrap `error.cause` chains so wrapped Postgres
  // errors (drizzle's outer "Failed query: ..." wrapper) reveal the actual
  // underlying problem rather than just the wrapper.
  const described = describeError(err);
  recordError({
    method: req.method,
    url: req.url?.split("?")[0] ?? "",
    message: described.message,
    stack: described.stack,
    user: req.session?.username ?? null,
  });
  if (res.headersSent) return;
  const isProduction = process.env["NODE_ENV"] === "production";
  // We surface the raw error message under `detail` in two cases:
  //   1. We're not in production (local dev) — speeds up debugging.
  //   2. The requester is signed in as an admin — gives the site owner
  //      a usable error popup on the live site without leaking internals
  //      to anonymous visitors. This is essential when the production
  //      host is outside Replit and we have no way to read its server
  //      logs from the workspace.
  const isAdminRequester = !!req.session?.isAdmin;
  const exposeDetail = !isProduction || isAdminRequester;
  res.status(500).json({
    error: "Internal server error",
    detail: exposeDetail ? described.message : undefined,
  });
};
app.use(errorHandler);

export default app;
