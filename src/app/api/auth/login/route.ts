import { NextResponse } from "next/server";
import {
  createSessionToken,
  passwordMatches,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/auth/session";

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const state = attempts.get(ip);
  if (state && state.resetAt > now && state.count >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
  if (!(await passwordMatches(password))) {
    const next =
      !state || state.resetAt <= now
        ? { count: 1, resetAt: now + WINDOW_MS }
        : { ...state, count: state.count + 1 };
    attempts.set(ip, next);
    return NextResponse.json({ error: "Invalid prototype password." }, { status: 401 });
  }
  attempts.delete(ip);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await createSessionToken(),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
