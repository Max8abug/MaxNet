import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./lib/auth";

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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(sessionMiddleware);

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
  if (res.headersSent) return;
  const isProduction = process.env["NODE_ENV"] === "production";
  res.status(500).json({
    error: "Internal server error",
    // In production we still hide the raw message from end users, but in
    // development surfacing it shaves a round-trip off most debugging.
    detail: isProduction ? undefined : (err instanceof Error ? err.message : String(err)),
  });
};
app.use(errorHandler);

export default app;
