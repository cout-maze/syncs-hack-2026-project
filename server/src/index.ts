import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });
dotenv.config();
import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { authMiddleware } from "./lib/auth";
import { HttpError, errorBody } from "./lib/errors";
import { seedIfEmpty } from "./seed";
import { authRouter } from "./modules/auth/router";
import { cityRouter } from "./modules/city/router";
import { proposalsRouter } from "./modules/proposals/router";
import { advisorRouter } from "./modules/advisor/router";

seedIfEmpty();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

const api = express.Router();
api.use(authMiddleware);
api.use(authRouter);
api.use(cityRouter);
api.use(proposalsRouter);
api.use(advisorRouter);
app.use("/api/v1", api);

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof HttpError) {
      res.status(error.status).json(errorBody({ code: error.code, message: error.message, details: error.details }));
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json(
        errorBody({
          code: "BAD_REQUEST",
          message: "Validation failed.",
          details: { issues: error.issues },
        }),
      );
      return;
    }
    console.error(error);
    res.status(500).json(errorBody({ code: "INTERNAL", message: "Unexpected server error." }));
  },
);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Rebuild My City API  http://localhost:${port}/api/v1`);
  console.log(`Demo login            ${process.env.DEMO_EMAIL ?? "demo@city.dev"} / ${process.env.DEMO_PASSWORD ?? "rebuild-city"}`);
});
