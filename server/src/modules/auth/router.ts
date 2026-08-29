import { Router } from "express";
import bcrypt from "bcryptjs";
import { loginBodySchema, registerBodySchema } from "@rmc/shared";
import { requireUser, signToken } from "../../lib/auth";
import { HttpError } from "../../lib/errors";
import { id, nowIso } from "../../lib/ids";
import { store } from "../../lib/store";

export const authRouter = Router();

function toUser(row: { id: string; email: string; displayName: string; createdAt: string }) {
  return { id: row.id, email: row.email, displayName: row.displayName, createdAt: row.createdAt };
}

authRouter.post("/auth/register", (req, res) => {
  const body = registerBodySchema.parse(req.body);
  const email = body.email.toLowerCase();
  if (store.read().users.some((user) => user.email === email)) {
    throw new HttpError(409, "EMAIL_TAKEN", "An account with this email already exists.");
  }
  const user = {
    id: id("usr"),
    email,
    passwordHash: bcrypt.hashSync(body.password, 10),
    displayName: body.displayName,
    createdAt: nowIso(),
  };
  store.write((data) => {
    data.users.push(user);
  });
  res.status(201).json({ token: signToken(user), user: toUser(user) });
});

authRouter.post("/auth/login", (req, res) => {
  const body = loginBodySchema.parse(req.body);
  const user = store.read().users.find((row) => row.email === body.email.toLowerCase());
  if (!user || !bcrypt.compareSync(body.password, user.passwordHash)) {
    throw new HttpError(401, "UNAUTHORIZED", "Invalid email or password.");
  }
  res.json({ token: signToken(user), user: toUser(user) });
});

authRouter.get("/auth/me", (req, res) => {
  res.json(requireUser(req));
});
