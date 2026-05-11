import { createAdminClient } from "@/lib/supabase-admin";
import { requireAuthContext, type AuthContext } from "@/lib/auth-context";
import type { ChatSession, SidebarUser } from "@/components/app-shell/sidebar";

/**
 * Data each authed layout needs to render the AppShell.
 * Cached per-request via React.cache inside requireAuthContext —
 * calling this from multiple sibling layouts is free.
 */
export async function getShellData(): Promise<{
  ctx: AuthContext;
  user: SidebarUser;
  sessions: ChatSession[];
}> {
  const ctx = await requireAuthContext();
  const admin = createAdminClient();

  const { data: sessions } = await admin
    .from("assistant_sessions")
    .select("id, title, mode, updated_at")
    .eq("user_id", ctx.userId)
    .order("updated_at", { ascending: false })
    .limit(50);

  return {
    ctx,
    user: {
      email: ctx.email,
      displayName: ctx.displayName,
      role: ctx.role,
      larkVerified: ctx.larkVerified,
    },
    sessions: (sessions ?? []) as ChatSession[],
  };
}
