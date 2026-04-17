import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

const CLAUDE_PROXY_URL = process.env.CLAUDE_PROXY_URL || "";
const CLAUDE_PROXY_API_KEY = process.env.CLAUDE_PROXY_API_KEY || "";
const PERSONAL_MEMORY_URL = process.env.PERSONAL_MEMORY_URL || ""; // mcp-memory-service.zeabur.app
const COMPANY_MEMORY_URL = process.env.COMPANY_MEMORY_URL || ""; // inside-assistant.zeabur.app

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, message, mode, userId, displayName, claudeMd, userRole } = body;

    if (!sessionId || !message) {
      return NextResponse.json({ error: "sessionId and message required" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Verify session
    const { data: session } = await supabase
      .from("assistant_sessions")
      .select("id, user_id, mode")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Fetch conversation history
    const { data: prevMessages } = await supabase
      .from("assistant_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(50);

    // Store user message
    await supabase.from("assistant_messages").insert({
      session_id: sessionId,
      role: "user",
      content: message.trim(),
    });

    // Build conversation history
    const history = (prevMessages ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Fetch relevant memories
    const memoryUrl = mode === "company" ? COMPANY_MEMORY_URL : PERSONAL_MEMORY_URL;
    let memoryContext = "";
    if (memoryUrl) {
      try {
        const memRes = await fetch(`${memoryUrl}/api/memories/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: message,
            tags: mode === "company" ? [`company:inside`] : [`user:${userId}`],
            limit: 5,
          }),
          signal: AbortSignal.timeout(3000),
        });
        if (memRes.ok) {
          const memData = await memRes.json();
          const memories = memData.memories || memData.results || [];
          if (memories.length > 0) {
            memoryContext = "\n\n--- RECALLED MEMORIES ---\n" +
              memories.map((m: { content?: string; text?: string }) => `- ${m.content || m.text}`).join("\n") +
              "\n--- END MEMORIES ---";
          }
        }
      } catch {}
    }

    // Build system prompt based on mode
    let systemPrompt: string;

    if (mode === "company") {
      systemPrompt = `You are Inside Assistant, the AI brain for Inside Advisory Group. You have access to shared company knowledge and memories.

The person chatting with you is: ${displayName} (role: ${userRole}).

IMPORTANT RULES:
- You represent the company's collective knowledge
- Be helpful but respect information hierarchy
- If the user's role is "member", do not share sensitive financial details, salary information, or strategic plans unless explicitly allowed
- If the user's role is "director" or "manager", they have broader access
- Always be professional and helpful
- Store important decisions and facts to memory for future reference${memoryContext}`;
    } else {
      systemPrompt = `You are Inside Assistant, a personal AI assistant for ${displayName}.

This is a private session. Memories from this session are only accessible to ${displayName}.

Be helpful, conversational, and remember context from previous conversations.${memoryContext}`;
    }

    // Inject user's claude.md if set
    if (claudeMd) {
      systemPrompt += `\n\n--- USER INSTRUCTIONS (claude.md) ---\n${claudeMd}`;
    }

    // Call Claude proxy
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (CLAUDE_PROXY_API_KEY) headers["X-API-Key"] = CLAUDE_PROXY_API_KEY;

    const claudeRes = await fetch(`${CLAUDE_PROXY_URL}/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        systemPrompt,
        messages: [...history, { role: "user", content: message.trim() }],
        sessionId,
        userId,
        companyId: mode === "company" ? "inside" : undefined,
      }),
    });

    if (!claudeRes.ok) {
      return NextResponse.json({ error: "AI service unavailable" }, { status: 502 });
    }

    const claudeData = await claudeRes.json();
    const aiContent = claudeData.content ?? "I'm having trouble responding.";

    // Store AI response
    await supabase.from("assistant_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: aiContent,
    });

    // Update session title (first message only) and timestamp
    const isFirstMessage = (prevMessages?.length ?? 0) === 0;
    const updateData: Record<string, string> = {
      updated_at: new Date().toISOString(),
    };
    if (isFirstMessage) {
      updateData.title = message.trim().slice(0, 50) + (message.length > 50 ? "..." : "");
    }
    await supabase.from("assistant_sessions").update(updateData).eq("id", sessionId);

    // Store to memory (async, non-blocking)
    if (memoryUrl) {
      const tags = mode === "company"
        ? ["conversation", "company:inside", `session:${sessionId}`]
        : ["conversation", `user:${userId}`, `session:${sessionId}`];

      fetch(`${memoryUrl}/api/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `${displayName} asked: "${message.slice(0, 200)}". Assistant replied: "${aiContent.slice(0, 300)}"`,
          tags,
          metadata: { sessionId, userId, timestamp: new Date().toISOString() },
        }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    }

    return NextResponse.json({ content: aiContent });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
