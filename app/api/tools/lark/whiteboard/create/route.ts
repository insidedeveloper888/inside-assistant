import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Create a blank Lark whiteboard under the user's Drive.
 * Returns the board URL for the user to open and edit.
 *
 * Lark whiteboards are created via the Drive API with type=board. Adding shapes
 * programmatically uses a separate /board/v1 API with a coordinate system — we
 * deliberately skip automated shape placement here because the DX is poor
 * (pixel coords, manual layout). Instead the AI produces a mermaid diagram
 * which LARK_DOC already renders natively; use that for most diagramming
 * needs. Use whiteboard when the user explicitly wants a free-form canvas
 * to edit themselves.
 */
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, folderToken } = await request.json();
  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("user_integrations")
    .select("access_token")
    .eq("user_id", user.id)
    .eq("provider", "lark_user")
    .single();
  if (!integration?.access_token) {
    return NextResponse.json({ error: "Lark not connected" }, { status: 400 });
  }

  const started = Date.now();
  const createRes = await fetch(
    "https://open.larksuite.com/open-apis/drive/v1/files/create_file",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integration.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_type: "board",
        name: title.slice(0, 80),
        parent_token: folderToken ?? undefined,
      }),
    }
  );
  const body = await createRes.json();

  await admin.from("tool_invocations").insert({
    user_id: user.id,
    tool_name: "lark_create_whiteboard",
    provider: "lark",
    input: { title, folderToken: folderToken ?? null },
    output: body.code === 0 ? { token: body.data?.token, url: body.data?.url } : null,
    status: body.code === 0 ? "success" : "error",
    error: body.code === 0 ? null : body.msg,
    duration_ms: Date.now() - started,
  });

  if (body.code !== 0) {
    return NextResponse.json({ error: body.msg ?? `code ${body.code}` }, { status: 500 });
  }

  const url = body.data?.url ?? `https://inside.sg.larksuite.com/wiki/${body.data?.token}`;
  return NextResponse.json({ token: body.data?.token, url });
}
