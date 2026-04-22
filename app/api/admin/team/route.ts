import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { findAllLarkUsers } from "@/lib/lark";
import { WA_TENANT_ID } from "@/lib/tenant";

export const runtime = "nodejs";
export const maxDuration = 30;

// Normalize Malaysian / international phone numbers to canonical E.164-ish digits.
// Input variants: "0162454204", "60162454204", "+60 16-245 4204", "162454204"
// Output: "60162454204" (Malaysia) or the digits as given with country code preserved.
// Default country code 60 (Malaysia) if input starts with 0 or is 9-10 digits.
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = "60" + digits.slice(1);
  if (digits.length <= 10 && !digits.startsWith("60")) digits = "60" + digits;
  return digits;
}

export async function GET() {
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

  // Fetch all team members from assistant_user_settings
  const { data: members } = await admin
    .from("assistant_user_settings")
    .select("*")
    .order("display_name");

  // Fetch WhatsApp AI whitelist
  const { data: whitelist } = await admin
    .from("ai_reply_whitelist")
    .select("*")
    .eq("tenant_id", WA_TENANT_ID);

  // Fetch Lark users (non-blocking, skip if slow)
  let larkUsers: Awaited<ReturnType<typeof findAllLarkUsers>> = [];
  try {
    larkUsers = await Promise.race([
      findAllLarkUsers(),
      new Promise<typeof larkUsers>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
  } catch {
    console.log("[admin] Lark users fetch timed out, skipping");
  }

  // Fetch auth emails
  const userIds = (members ?? []).map((m) => m.user_id);
  let authEmails: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: authUsers } = await admin
      .from("auth.users" as string)
      .select("id, email");
    // Fallback: query directly
    if (!authUsers) {
      // auth.users might not be accessible via PostgREST, use the email from settings
    } else {
      for (const u of authUsers) {
        authEmails[u.id] = u.email;
      }
    }
  }

  return NextResponse.json({
    members: members ?? [],
    whitelist: whitelist ?? [],
    larkUsers,
  });
}

export async function POST(request: NextRequest) {
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

  const body = await request.json();
  const { action } = body;

  // Update a team member's linked identities
  if (action === "update-member") {
    const { userId, displayName, phone, email, larkOpenId, larkName, role } = body;
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (displayName !== undefined) updateData.display_name = displayName;
    if (phone !== undefined) updateData.phone = normalizePhone(phone);
    if (email !== undefined) updateData.email = email;
    if (larkOpenId !== undefined) {
      updateData.lark_open_id = larkOpenId;
      updateData.lark_verified = !!larkOpenId;
    }
    if (larkName !== undefined) updateData.lark_name = larkName;
    if (role !== undefined) updateData.role = role;

    await admin.from("assistant_user_settings").update(updateData).eq("user_id", userId);

    // Also sync to WhatsApp whitelist if phone is set
    if (phone) {
      const cleanPhone = normalizePhone(phone);
      if (cleanPhone) {
        await admin.from("ai_reply_whitelist").upsert({
          tenant_id: WA_TENANT_ID,
          phone: cleanPhone,
          name: displayName || larkName || "Unknown",
          lark_open_id: larkOpenId || null,
          mode: "personal",
          is_enabled: false,
        }, { onConflict: "tenant_id,phone" });
      }
    }

    return NextResponse.json({ success: true });
  }

  // Add a new team member (pre-register before they sign up)
  if (action === "add-member") {
    const { displayName, phone, email, larkOpenId, larkName, role } = body;

    // Check if user already exists by email
    if (email) {
      const { data: existingAuth } = await admin.auth.admin.listUsers();
      const existingUser = existingAuth?.users?.find((u) => u.email === email);

      if (existingUser) {
        // Update existing user's settings
        await admin.from("assistant_user_settings").upsert({
          user_id: existingUser.id,
          display_name: displayName,
          phone: normalizePhone(phone),
          email,
          lark_open_id: larkOpenId || null,
          lark_name: larkName || null,
          lark_verified: !!larkOpenId,
          role: role || "member",
        }, { onConflict: "user_id" });
      }
    }

    // Add to WhatsApp whitelist if phone provided
    if (phone) {
      const cleanPhone = normalizePhone(phone);
      if (cleanPhone) {
        await admin.from("ai_reply_whitelist").upsert({
          tenant_id: WA_TENANT_ID,
          phone: cleanPhone,
          name: displayName || larkName || "Unknown",
          lark_open_id: larkOpenId || null,
          mode: "personal",
          is_enabled: false,
        }, { onConflict: "tenant_id,phone" });
      }
    }

    return NextResponse.json({ success: true });
  }

  // Remove member from team rosters (KEEP auth user — they can still log in)
  if (action === "remove-member") {
    const { userId, phone, email } = body;
    if (userId) {
      await admin.from("assistant_user_settings").delete().eq("user_id", userId);
    } else if (email) {
      await admin.from("assistant_user_settings").delete().eq("email", email);
    }
    if (phone) {
      const cleanPhone = normalizePhone(phone);
      if (cleanPhone) {
        await admin.from("ai_reply_whitelist")
          .delete()
          .eq("phone", cleanPhone)
          .eq("tenant_id", WA_TENANT_ID);
      }
    }
    return NextResponse.json({ success: true });
  }

  // Toggle WhatsApp AI for a member
  if (action === "toggle-whatsapp") {
    const { phone, isEnabled } = body;
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone) return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
    await admin.from("ai_reply_whitelist")
      .update({ is_enabled: isEnabled })
      .eq("phone", cleanPhone)
      .eq("tenant_id", WA_TENANT_ID);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
