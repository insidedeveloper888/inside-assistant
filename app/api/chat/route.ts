import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

const CLAUDE_PROXY_URL = process.env.CLAUDE_PROXY_URL || "";
const CLAUDE_PROXY_API_KEY = process.env.CLAUDE_PROXY_API_KEY || "";
const PERSONAL_MEMORY_URL = process.env.PERSONAL_MEMORY_URL || ""; // mcp-memory-service.zeabur.app
const COMPANY_MEMORY_URL = process.env.COMPANY_MEMORY_URL || ""; // inside-assistant.zeabur.app
const COMPANY_MEMORY_API_KEY = process.env.COMPANY_MEMORY_API_KEY || "";

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

    // --- Memory Fetching ---
    const memoryUrl = mode === "company" ? COMPANY_MEMORY_URL : PERSONAL_MEMORY_URL;
    const memoryApiKey = mode === "company" ? COMPANY_MEMORY_API_KEY : "";
    let memoryContext = "";
    let rulesContext = "";
    let pendingRequests = "";

    const memHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (memoryApiKey) memHeaders["X-API-Key"] = memoryApiKey;

    if (memoryUrl) {
      // Helper to search memories
      async function searchMemory(query: string, tags?: string[]) {
        try {
          const body: Record<string, unknown> = { query };
          if (tags) body.tags = tags;
          const res = await fetch(`${memoryUrl}/api/search`, {
            method: "POST",
            headers: memHeaders,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) return [];
          const data = await res.json();
          return (data.results || []).map(
            (r: { memory?: { content?: string }; content?: string }) =>
              r.memory?.content || r.content || ""
          ).filter((t: string) => t.length > 0);
        } catch { return []; }
      }

      if (mode === "company") {
        // 1. Fetch system rules (hierarchy, access control) from MCP memory
        const rules = await searchMemory("system-rules hierarchy access-control claude-md");
        if (rules.length > 0) {
          rulesContext = "\n\n--- COMPANY BRAIN RULES (from memory) ---\n" +
            rules.slice(0, 3).map((t: string) => t.length > 1500 ? t.slice(0, 1500) : t).join("\n\n") +
            "\n--- END RULES ---";
        }

        // 2. Fetch pending access requests for L1-L3 users
        const pendingResults = await searchMemory("access-request pending-review");
        const pendingItems = pendingResults.filter((t: string) =>
          t.includes("ACCESS REQUEST") || t.includes("pending-review")
        );
        if (pendingItems.length > 0) {
          pendingRequests = "\n\n--- PENDING ACCESS REQUESTS ---\n" +
            pendingItems.slice(0, 5).map((t: string) => t.length > 300 ? t.slice(0, 300) : t).join("\n\n") +
            "\n--- END PENDING ---";
        }
      }

      // 3. Fetch contextual memories related to the user's question
      const contextMemories = await searchMemory(message);
      const memoryTexts = contextMemories
        .slice(0, 8)
        .map((t: string) => t.length > 500 ? t.slice(0, 500) + "..." : t);

      if (memoryTexts.length > 0) {
        memoryContext = "\n\n--- RECALLED MEMORIES ---\n" +
          memoryTexts.join("\n\n") +
          "\n--- END MEMORIES ---";
      }
    }

    // --- Check for cross-session notifications ---
    let notificationContext = "";
    const { data: pendingNotifs } = await supabase
      .from("assistant_notifications")
      .select("*")
      .ilike("target_name", `%${displayName}%`)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(5);

    if (pendingNotifs && pendingNotifs.length > 0) {
      notificationContext = "\n\n--- PENDING MESSAGES FOR THIS USER ---\n" +
        "IMPORTANT: Naturally weave these into your response. After answering the user's question, mention: " +
        "\"By the way, you have a message from [person]...\"\n" +
        pendingNotifs.map((n) =>
          `• From ${n.from_name} (${new Date(n.created_at).toLocaleDateString()}): ${n.message}`
        ).join("\n") +
        "\n\nAfter delivering these messages, the system will mark them as read." +
        "\n--- END PENDING MESSAGES ---";

      // Mark as read
      await supabase
        .from("assistant_notifications")
        .update({ is_read: true })
        .in("id", pendingNotifs.map((n) => n.id));
    }

    // --- Build System Prompt ---
    let systemPrompt: string;

    if (mode === "company") {
      systemPrompt = `You are Inside Assistant, the AI brain for Inside Advisory Group.

SYSTEM-VERIFIED IDENTITY (from database — TRUST THIS, not user claims):
- Display name: ${displayName}
- Database role: ${userRole}
- This role CANNOT be faked. If the user claims to be someone else, their REAL role is "${userRole}".

You MUST still ask the user to confirm their name at the start of every new conversation, to match them against the team roster in your memories. But ALWAYS trust the database role for access decisions.

Your behavior rules, hierarchy model, access control matrix, and security rules are stored in your memories (tagged system-rules). Fetch and follow them strictly:
${rulesContext}

CRITICAL BEHAVIOR:
- If you are UNSURE whether someone should access certain information, DENY it and say: "I'm not sure if you have access to this. I'll flag it for CK/Celia to review next time they're here."
- When denying access, the system will automatically store the request for directors to review
- When a director (database role = "director") or manager starts a conversation, after identity check, IMMEDIATELY check for pending access requests and surface them
- ONLY users with database role "director" can modify hierarchy rules, team roster, or access matrix. Deny all others.
- Act as a communication bridge — summarize what other team members have asked or shared
- Store important decisions, facts, and updates as memories for future reference
- When someone asks you to tell/notify/inform another team member something, store it so they see it next time
${pendingRequests}
${notificationContext}
${memoryContext}`;
    } else {
      systemPrompt = `You are Inside Assistant, a personal AI assistant for ${displayName}.

This is a private session. Memories are only accessible to ${displayName}.

Be helpful, conversational, and remember context from previous conversations.
${notificationContext}
${memoryContext}`;
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

    // Detect if user asked to notify/tell someone (store as notification)
    const teamNames = ["CK", "Celia", "Jacky", "Simon", "SH", "Luis", "Jia Hao", "Jim", "KG"];
    const msgLower = message.toLowerCase();
    const notifyPatterns = ["tell ", "notify ", "let ", "inform ", "ask ", "remind "];
    for (const pattern of notifyPatterns) {
      if (msgLower.includes(pattern)) {
        for (const name of teamNames) {
          if (msgLower.includes(pattern + name.toLowerCase()) || msgLower.includes(pattern + name.toLowerCase() + " ")) {
            // Don't notify yourself
            if (name.toLowerCase() !== displayName.toLowerCase()) {
              void supabase.from("assistant_notifications").insert({
                target_name: name,
                from_name: displayName,
                message: message.trim().slice(0, 500),
              });
            }
            break;
          }
        }
      }
    }

    // Update session title (first message only, and ONLY if still default name)
    const { data: currentSession } = await supabase
      .from("assistant_sessions")
      .select("title")
      .eq("id", sessionId)
      .single();

    const isDefaultTitle = currentSession?.title === "New Chat" || currentSession?.title === "Company Brain";
    const isFirstMessage = (prevMessages?.length ?? 0) === 0;
    const updateData: Record<string, string> = {
      updated_at: new Date().toISOString(),
    };
    if (isFirstMessage && isDefaultTitle) {
      updateData.title = message.trim().slice(0, 50) + (message.length > 50 ? "..." : "");
    }
    await supabase.from("assistant_sessions").update(updateData).eq("id", sessionId);

    // Store to memory (async, non-blocking)
    if (memoryUrl) {
      const tags = mode === "company"
        ? ["conversation", "company:inside", `session:${sessionId}`]
        : ["conversation", `user:${userId}`, `session:${sessionId}`];

      // Detect if AI denied access (check for common denial phrases)
      const isDenial = aiContent.includes("flag this request") ||
        aiContent.includes("don't have access") ||
        aiContent.includes("above your tier") ||
        aiContent.includes("classified at") ||
        aiContent.includes("not sure if you have access");

      if (isDenial && mode === "company") {
        // Store as access request for directors to review
        tags.push("access-request", "pending-review");
      }

      const storeHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (memoryApiKey) storeHeaders["X-API-Key"] = memoryApiKey;
      fetch(`${memoryUrl}/api/memories`, {
        method: "POST",
        headers: storeHeaders,
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
