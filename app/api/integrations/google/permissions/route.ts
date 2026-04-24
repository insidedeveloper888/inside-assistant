import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export type GooglePermissions = {
  calendar: boolean;
  freebusy: boolean;
  gmail: boolean;
  drive: boolean;
  docs: boolean;
  sheets: boolean;
  contacts: boolean;
  tasks: boolean;
  meet: boolean;
};

export type PlatformDefaults = {
  calendar?: "google" | "lark";
  docs?: "google" | "lark";
  sheets?: "google" | "lark";
  drive?: "google" | "lark";
  freebusy?: "google" | "lark";
};

const DEFAULT_PERMS: GooglePermissions = {
  calendar: true,
  freebusy: true,
  gmail: true,
  drive: true,
  docs: true,
  sheets: true,
  contacts: true,
  tasks: true,
  meet: true,
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
    .eq("provider", "google")
    .single();

  if (!integration) return NextResponse.json({ error: "Google not connected" }, { status: 404 });

  const config = integration.config as Record<string, unknown> | null;
  const permissions = { ...DEFAULT_PERMS, ...(config?.permissions as Partial<GooglePermissions> ?? {}) };
  const defaults = (config?.defaults as PlatformDefaults) ?? {};

  return NextResponse.json({ permissions, defaults });
}

export async function PUT(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { permissions, defaults } = body;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("user_integrations")
    .select("config")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .single();

  if (!existing) return NextResponse.json({ error: "Google not connected" }, { status: 404 });

  const config = (existing.config as Record<string, unknown>) ?? {};

  if (permissions && typeof permissions === "object") {
    config.permissions = {
      calendar: permissions.calendar !== false,
      freebusy: permissions.freebusy !== false,
      gmail: permissions.gmail !== false,
      drive: permissions.drive !== false,
      docs: permissions.docs !== false,
      sheets: permissions.sheets !== false,
      contacts: permissions.contacts !== false,
      tasks: permissions.tasks !== false,
      meet: permissions.meet !== false,
    };
  }

  if (defaults && typeof defaults === "object") {
    config.defaults = defaults;
  }

  await admin
    .from("user_integrations")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("provider", "google");

  return NextResponse.json({
    permissions: config.permissions,
    defaults: config.defaults,
  });
}
