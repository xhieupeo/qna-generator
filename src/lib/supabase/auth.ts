import { NextRequest } from "next/server";
import { getServerSupabase } from "./server";

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

/**
 * Extracts and verifies the authenticated Supabase user from the request.
 * Prioritizes the Bearer token in the Authorization header, with a fallback to auth cookies.
 */
export async function getAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser | null> {
  const supabase = getServerSupabase();
  if (!supabase) return null;

  // 1. Check Authorization header (Bearer <token>)
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data?.user) {
          return {
            id: data.user.id,
            email: data.user.email,
          };
        }
      } catch (err) {
        console.warn("Failed to verify bearer token:", err);
      }
    }
  }

  // 2. Fallback to Supabase auth cookies
  try {
    const allCookies = req.cookies.getAll();
    const authCookie = allCookies.find(
      (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
    );
    if (authCookie) {
      let parsed: any;
      try {
        parsed = JSON.parse(authCookie.value);
      } catch {
        parsed = authCookie.value;
      }
      if (Array.isArray(parsed) && parsed[0]) {
        parsed = parsed[0];
      }
      const token = parsed?.access_token || (typeof parsed === "string" ? parsed : null);
      if (token) {
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data?.user) {
          return {
            id: data.user.id,
            email: data.user.email,
          };
        }
      }
    }
  } catch {
    // Cookie parsing failure
  }

  return null;
}
