import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export async function hasValidSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}
