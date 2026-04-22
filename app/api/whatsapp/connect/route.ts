import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || "").trim();
const EVOLUTION_API_KEY = (process.env.EVOLUTION_API_KEY || "").trim();
const WEBHOOK_RECEIVER_URL = (process.env.WEBHOOK_RECEIVER_URL || "").trim();
const ASSISTANT_TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const INSTANCE_NAME = "tenant-61c2f8b0-97b0-4311-8302-3dc683ac9a26";

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

  const { data: existing } = await admin
    .from("wa_sessions")
    .select("status, phone_number")
    .eq("tenant_id", ASSISTANT_TENANT_ID)
    .single();

  if (existing?.status === "connected") {
    return NextResponse.json({ status: "connected", phoneNumber: existing.phone_number });
  }

  // Clean up stale instance before creating fresh QR
  await fetch(`${EVOLUTION_API_URL}/instance/logout/${INSTANCE_NAME}`, {
    method: "DELETE", headers: { apikey: EVOLUTION_API_KEY },
  }).catch(() => {});
  await fetch(`${EVOLUTION_API_URL}/instance/delete/${INSTANCE_NAME}`, {
    method: "DELETE", headers: { apikey: EVOLUTION_API_KEY },
  }).catch(() => {});

  const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({
      instanceName: INSTANCE_NAME,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      rejectCall: false,
      groupsIgnore: true,
    }),
  });

  let qrBase64: string | null = null;

  if (createRes.ok) {
    const data = await createRes.json();
    qrBase64 = data?.qrcode?.base64 ?? null;
  } else {
    const connectRes = await fetch(`${EVOLUTION_API_URL}/instance/connect/${INSTANCE_NAME}`, {
      method: "GET", headers: { apikey: EVOLUTION_API_KEY },
    });
    if (connectRes.ok) {
      const data = await connectRes.json();
      qrBase64 = data?.base64 ?? null;
    }
  }

  await fetch(`${EVOLUTION_API_URL}/webhook/set/${INSTANCE_NAME}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: `${WEBHOOK_RECEIVER_URL}/webhook`,
        webhookByEvents: false,
        webhookBase64: true,
        events: ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "SEND_MESSAGE"],
      },
    }),
  });

  await admin.from("wa_sessions").upsert({
    tenant_id: ASSISTANT_TENANT_ID,
    instance_name: INSTANCE_NAME,
    status: "qr_pending",
    qr_code_base64: qrBase64,
    webhook_url: `${WEBHOOK_RECEIVER_URL}/webhook`,
    purpose: "assistant",
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id" });

  return NextResponse.json({ status: "qr_pending", qrCode: qrBase64 });
}
