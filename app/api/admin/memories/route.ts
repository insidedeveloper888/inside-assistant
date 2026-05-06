import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { storeVectorMemory, searchVectorMemories } from "@/lib/vector-memory";

export const runtime = "nodejs";

async function requireDirector() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("assistant_user_settings")
    .select("role, display_name")
    .eq("user_id", user.id)
    .single();
  if (!settings || settings.role !== "director") {
    return { error: NextResponse.json({ error: "Directors only" }, { status: 403 }) };
  }
  return { user, admin, settings };
}

// LIST + SEARCH memories
export async function GET(request: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const params = request.nextUrl.searchParams;
  const scope = params.get("scope") ?? "company";
  const search = params.get("q")?.trim();
  const tag = params.get("tag")?.trim();
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(10, parseInt(params.get("limit") ?? "30", 10)));

  if (search) {
    // Use hybrid search with limit
    const results = await searchVectorMemories(admin, {
      query: search,
      scope: scope as "personal" | "company",
      tags: tag ? [tag] : undefined,
      limit,
    });
    return NextResponse.json({
      memories: results.map((r) => ({
        id: r.id,
        content: r.content,
        tags: r.tags,
        metadata: r.metadata,
        created_at: r.created_at,
        similarity: r.similarity,
        keyword_rank: r.keyword_rank,
      })),
      total: results.length,
      page: 1,
      limit,
      mode: "search",
    });
  }

  // Browse mode: chronological with optional tag filter
  let q = admin
    .from("memory_vectors")
    .select("id, content, tags, metadata, source, created_at, updated_at, scope, user_id, tenant_id", { count: "exact" })
    .eq("scope", scope)
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (tag) q = q.contains("tags", [tag]);

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    memories: data ?? [],
    total: count ?? 0,
    page,
    limit,
    mode: "browse",
  });
}

// CREATE a new memory manually
export async function POST(request: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { admin, user } = auth;

  const body = await request.json();
  const { scope, content, tags, metadata } = body;

  if (!content || content.length < 5) {
    return NextResponse.json({ error: "content required (min 5 chars)" }, { status: 400 });
  }
  if (scope !== "personal" && scope !== "company") {
    return NextResponse.json({ error: "scope must be personal or company" }, { status: 400 });
  }

  const id = await storeVectorMemory(admin, {
    scope,
    content,
    userId: scope === "personal" ? user.id : null,
    tags: Array.isArray(tags) ? tags : [],
    metadata: typeof metadata === "object" && metadata ? metadata : {},
    source: "manual-admin",
  });

  if (!id) {
    return NextResponse.json({ error: "Failed to embed/store" }, { status: 500 });
  }
  return NextResponse.json({ success: true, id });
}

// UPDATE memory (content + tags + metadata)
// Note: editing content re-embeds it
export async function PUT(request: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const body = await request.json();
  const { id, content, tags, metadata } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // If content changed, re-embed
  if (typeof content === "string" && content.length > 0) {
    // Get scope/user_id first
    const { data: existing } = await admin
      .from("memory_vectors")
      .select("scope, user_id, tenant_id, source")
      .eq("id", id)
      .single();
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Delete old, store new (storeVectorMemory uses upsert by content_hash)
    await admin.from("memory_vectors").delete().eq("id", id);
    const newId = await storeVectorMemory(admin, {
      scope: existing.scope as "personal" | "company",
      content,
      userId: existing.user_id as string | null,
      tenantId: existing.tenant_id as string | null,
      tags: Array.isArray(tags) ? tags : undefined,
      metadata: typeof metadata === "object" && metadata ? metadata : undefined,
      source: (existing.source as string) ?? "manual-admin",
    });
    return NextResponse.json({ success: true, id: newId });
  }

  // Tags/metadata only — no re-embedding needed
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (Array.isArray(tags)) updateData.tags = tags;
  if (typeof metadata === "object" && metadata) updateData.metadata = metadata;

  const { error } = await admin.from("memory_vectors").update(updateData).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, id });
}

// DELETE memory
export async function DELETE(request: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await admin.from("memory_vectors").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
