import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const LARK_APP_ID = (process.env.LARK_APP_ID || "").trim();
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://inside-assistant.vercel.app";

/**
 * Start Lark OAuth — redirects user to Lark's consent screen.
 * Lark will show a QR for desktop login or auto-detect session if the user
 * is already signed into larksuite.com. After consent, Lark redirects back to
 * /api/integrations/lark-user/callback with a short-lived code.
 *
 * We pass a CSRF-ish `state` (the user's id) so the callback can verify the
 * response belongs to this session. Lark echoes state back unchanged.
 */
export async function GET(_request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!LARK_APP_ID) return NextResponse.json({ error: "LARK_APP_ID not configured" }, { status: 500 });

  const redirectUri = `${APP_URL}/api/integrations/lark-user/callback`;
  const params = new URLSearchParams({
    app_id: LARK_APP_ID,
    redirect_uri: redirectUri,
    state: user.id, // Lark echoes this back; callback verifies it matches the session user
  });

  return NextResponse.redirect(
    `https://open.larksuite.com/open-apis/authen/v1/index?${params.toString()}`
  );
}
