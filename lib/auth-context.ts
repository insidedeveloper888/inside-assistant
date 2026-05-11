import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * Shared per-request user + settings resolver.
 *
 * React's `cache()` dedupes calls within a single render pass so the
 * root AppShell + the page body both call this but hit Supabase only
 * once. Keep this lean — runs on EVERY page load.
 */

export type AuthState =
  | { state: "unauthenticated" }
  | {
      state: "ready";
      userId: string;
      email: string;
      displayName: string;
      larkName: string | null;
      larkVerified: boolean;
      larkOpenId: string | null;
      role: "director" | "manager" | "member";
      phone: string | null;
    };

export type AuthContext = Extract<AuthState, { state: "ready" }>;

export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr && userErr.message && !/session/i.test(userErr.message)) {
    throw new Error(`Supabase auth error: ${userErr.message}`);
  }
  const user = userData?.user;
  if (!user || !user.email) return { state: "unauthenticated" };

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("assistant_user_settings")
    .select("display_name, lark_name, lark_verified, lark_open_id, role, phone")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    state: "ready",
    userId: user.id,
    email: user.email,
    displayName:
      (settings?.lark_name as string | null) ??
      (settings?.display_name as string | null) ??
      user.email.split("@")[0],
    larkName: (settings?.lark_name as string | null) ?? null,
    larkVerified: !!settings?.lark_verified,
    larkOpenId: (settings?.lark_open_id as string | null) ?? null,
    role: ((settings?.role as string | null) ?? "member") as AuthContext["role"],
    phone: (settings?.phone as string | null) ?? null,
  };
});

/** Redirect to /login if no session, otherwise return the AuthContext. */
export async function requireAuthContext(): Promise<AuthContext> {
  const s = await getAuthState();
  if (s.state === "unauthenticated") redirect("/login");
  return s;
}

/** Director-only gate. Redirects to / if user is not a director. */
export async function requireDirector(): Promise<AuthContext> {
  const ctx = await requireAuthContext();
  if (ctx.role !== "director") redirect("/");
  return ctx;
}

export type Role = AuthContext["role"];

export function isDirector(role: string | undefined | null): boolean {
  return role === "director";
}
