import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export type LarkPermissions = {
  calendar: boolean;
  freebusy: boolean;
  docs: boolean;
  sheets: boolean;
  drive: boolean;
  tasks: boolean;
  wiki: boolean;
  im: boolean;
  whiteboard: boolean;
};

const DEFAULTS: LarkPermissions = {
  calendar: true,
  freebusy: true,
  docs: true,
  sheets: true,
  drive: true,
  tasks: true,
  wiki: true,
  im: true,
  whiteboard: true,
};

export async function GET() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("user_integrations")
    .select("config")
    .eq("user_id", user.id)
    .eq("provider", "lark_user")
    .single();

  if (!integration) return NextResponse.json({ error: "Lark not connected" }, { status: 404 });

  const config = integration.config as Record<string, unknown> | null;
  const permissions = { ...DEFAULTS, ...(config?.permissions as Partial<LarkPermissions> ?? {}) };

  return NextResponse.json({ permissions });
}

export async function PUT(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { permissions } = await request.json();
  if (!permissions || typeof permissions !== "object") {
    return NextResponse.json({ error: "Invalid permissions" }, { status: 400 });
  }

  const cleaned: LarkPermissions = {
    calendar: permissions.calendar !== false,
    freebusy: permissions.freebusy !== false,
    docs: permissions.docs !== false,
    sheets: permissions.sheets !== false,
    drive: permissions.drive !== false,
    tasks: permissions.tasks !== false,
    wiki: permissions.wiki !== false,
    im: permissions.im !== false,
    whiteboard: permissions.whiteboard !== false,
  };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("user_integrations")
    .select("config")
    .eq("user_id", user.id)
    .eq("provider", "lark_user")
    .single();

  if (!existing) return NextResponse.json({ error: "Lark not connected" }, { status: 404 });

  const config = (existing.config as Record<string, unknown>) ?? {};
  config.permissions = cleaned;

  await admin
    .from("user_integrations")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("provider", "lark_user");

  return NextResponse.json({ permissions: cleaned });
}
