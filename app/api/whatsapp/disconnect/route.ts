import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || "").trim();
const EVOLUTION_API_KEY = (process.env.EVOLUTION_API_KEY || "").trim();
const ASSISTANT_TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: settings } = await admin
    .from("assistant_user_settings")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!settings || settings.role !== "director") {
    return NextResponse.json({ error: "Directors only" }, { status: 403 });
  }

  const { data: session } = await admin
    .from("wa_sessions")
    .select("instance_name")
    .eq("tenant_id", ASSISTANT_TENANT_ID)
    .single();

  if (session?.instance_name) {
    await fetch(`${EVOLUTION_API_URL}/instance/logout/${session.instance_name}`, {
      method: "DELETE", headers: { apikey: EVOLUTION_API_KEY },
    }).catch(() => {});
    await fetch(`${EVOLUTION_API_URL}/instance/delete/${session.instance_name}`, {
      method: "DELETE", headers: { apikey: EVOLUTION_API_KEY },
    }).catch(() => {});
  }

  await admin.from("wa_sessions").update({
    status: "disconnected",
    qr_code_base64: null,
    phone_number: null,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", ASSISTANT_TENANT_ID);

  return NextResponse.json({ status: "disconnected" });
}
