import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "app.session";
const DEFAULT_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  email: string;
  /** User UUID from public.users, used for created_by/modified_by */
  userId?: string;
  exp: number;
};

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set and at least 32 characters (e.g. openssl rand -base64 32)"
    );
  }
  return secret;
}

function encodeBase64Url(b: Buffer): string {
  return b.toString("base64url");
}

function decodeBase64Url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function signSession(payload: Omit<SessionPayload, "exp">): string {
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + DEFAULT_MAX_AGE;
  const data: SessionPayload = { ...payload, exp };
  const raw = JSON.stringify(data);
  const payloadB64 = encodeBase64Url(Buffer.from(raw, "utf8"));
  const sig = createHmac("sha256", secret)
    .update(payloadB64)
    .digest();
  return `${payloadB64}.${encodeBase64Url(sig)}`;
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const secret = getSecret();
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return null;
    const expected = createHmac("sha256", secret).update(payloadB64).digest();
    const actual = decodeBase64Url(sigB64);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return null;
    }
    const raw = Buffer.from(payloadB64, "base64url").toString("utf8");
    const data = JSON.parse(raw) as SessionPayload;
    if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (typeof data.email !== "string") return null;
    const userId = data.userId;
    return {
      email: data.email,
      userId: typeof userId === "string" ? userId : undefined,
      exp: data.exp,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const cookie = store.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  return verifySession(cookie.value);
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: DEFAULT_MAX_AGE,
  };
}
