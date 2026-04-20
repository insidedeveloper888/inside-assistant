import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

// Temporary debug endpoint — verifies env vars are present in the runtime
// without leaking values. Delete after Lark issue resolved.
export async function GET() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const lens: Record<string, number> = {};
  for (const key of [
    "LARK_APP_ID",
    "LARK_APP_SECRET",
    "CLAUDE_PROXY_URL",
    "CLAUDE_PROXY_API_KEY",
    "COMPANY_MEMORY_URL",
    "COMPANY_MEMORY_API_KEY",
    "PERSONAL_MEMORY_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    lens[key] = (process.env[key] || "").length;
  }

  // Also test Lark token fetch directly
  let larkTokenTest = "not attempted";
  if (lens.LARK_APP_ID > 0 && lens.LARK_APP_SECRET > 0) {
    try {
      const res = await fetch("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: process.env.LARK_APP_ID,
          app_secret: process.env.LARK_APP_SECRET,
        }),
      });
      const body = await res.json();
      larkTokenTest = `status=${res.status} code=${body.code} msg=${body.msg} has_token=${!!body.tenant_access_token}`;
    } catch (err) {
      larkTokenTest = `fetch error: ${err instanceof Error ? err.message : err}`;
    }
  }

  return NextResponse.json({ env_lengths: lens, lark_token_test: larkTokenTest });
}
