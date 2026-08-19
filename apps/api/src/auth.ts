import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyRequest } from "fastify";
import type { Store } from "./store/types.js";

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

/** Opaque bearer token; only its sha256 is ever stored. */
export function mintToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function userFromRequest(req: FastifyRequest, store: Store): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const raw = header.slice(7).trim();
  if (!/^[a-f0-9]{64}$/.test(raw)) return null;
  return store.resolveToken(hashToken(raw));
}
