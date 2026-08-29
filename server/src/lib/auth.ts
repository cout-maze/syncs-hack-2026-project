import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { PUBLIC_PATHS } from "@rmc/shared";
import { store } from "./store";
import { HttpError } from "./errors";

export type AuthUser = { id: string; email: string; displayName: string; createdAt: string };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const secret = () => process.env.JWT_SECRET ?? "rebuild-my-city-dev-secret-change-me";

export function signToken(user: { id: string; email: string }) {
  return jwt.sign({ sub: user.id, email: user.email }, secret(), { expiresIn: "24h" });
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const path = req.path.replace(/\/$/, "") || req.path;
  if (req.method === "GET" && (path === "/catalog/block-types" || path === "/catalog/personas")) {
    return next();
  }
  if (PUBLIC_PATHS.includes(path)) return next();

  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, "UNAUTHORIZED", "Missing bearer token."));

  try {
    const payload = jwt.verify(token, secret()) as { sub: string; email: string };
    const user = store.read().users.find((row) => row.id === payload.sub);
    if (!user) return next(new HttpError(401, "UNAUTHORIZED", "Invalid bearer token."));
    req.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
    };
    next();
  } catch {
    next(new HttpError(401, "UNAUTHORIZED", "Invalid or expired bearer token."));
  }
}

export function requireUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, "UNAUTHORIZED", "Missing bearer token.");
  return req.user;
}
