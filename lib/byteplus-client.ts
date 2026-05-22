/**
 * BytePlus ModelArk client for the Inside Assistant web app.
 *
 * Mirrors services/webhook-receiver/src/lib/byteplus-client.ts but lives
 * in the Next.js app since it's a separate package. If a third consumer
 * appears, extract to a workspace package — for now duplication keeps
 * deploys independent.
 *
 * The web /chat route uses BytePlus as PRIMARY with Claude proxy as
 * automatic fallback (see chatWithFallback). Different pattern than the
 * WA handler, which uses a hard env flag. Web users expect a reply, so
 * silent provider failover is preferable to a 502.
 */

const BASE = process.env.BYTEPLUS_ENDPOINT ?? "https://ark.ap-southeast.bytepluses.com/api/v3";
const API_KEY = process.env.BYTEPLUS_API_KEY ?? "";
const MODEL = process.env.BYTEPLUS_MODEL_AI_REPLY ?? "deepseek-v3-2-251201";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class BytePlusError extends Error {
  constructor(message: string, public status: number, public body: string) {
    super(message);
    this.name = "BytePlusError";
  }
}

export async function bytePlusChat(args: {
  systemPrompt: string;
  messages: ChatMessage[];
  timeoutMs?: number;
  temperature?: number;
}): Promise<{ content: string; model: string }> {
  if (!API_KEY) throw new Error("BYTEPLUS_API_KEY not set");

  const messages: ChatMessage[] = [
    { role: "system", content: args.systemPrompt },
    ...args.messages.filter((m) => m.role !== "system"),
  ];

  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
  };
  if (args.temperature !== undefined) body.temperature = args.temperature;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 90_000);

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BytePlusError(
        `BytePlus ${res.status}`,
        res.status,
        text.slice(0, 1000),
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      model: data.model ?? MODEL,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call BytePlus first; on any failure (network, 5xx, timeout) fall back to
 * Claude proxy so web users still get a reply. Returns which provider
 * actually responded so callers can log it.
 */
export async function chatWithFallback(args: {
  systemPrompt: string;
  messages: ChatMessage[];
  sessionId: string;
  userId: string;
  companyId?: string;
}): Promise<{ content: string; provider: "byteplus" | "claude_proxy"; model: string }> {
  const byteplusConfigured = !!API_KEY;
  const useByteplus = (process.env.AI_PROVIDER ?? "byteplus").toLowerCase() === "byteplus" && byteplusConfigured;

  if (useByteplus) {
    try {
      const result = await bytePlusChat({
        systemPrompt: args.systemPrompt,
        messages: args.messages,
      });
      if (result.content) {
        return { content: result.content, provider: "byteplus", model: result.model };
      }
      // Empty content — treat as failure, fall through to Claude
      console.warn("[chat] BytePlus returned empty content, falling back to Claude proxy");
    } catch (err) {
      const e = err as { status?: number; body?: string; message?: string };
      console.warn(
        `[chat] BytePlus failed (${e.status ?? "transport"}: ${(e.body ?? e.message ?? "").slice(0, 200)}), falling back to Claude proxy`,
      );
    }
  }

  // Claude proxy fallback (or primary if AI_PROVIDER=claude_proxy)
  const claudeUrl = process.env.CLAUDE_PROXY_URL ?? "";
  const claudeKey = process.env.CLAUDE_PROXY_API_KEY ?? "";
  if (!claudeUrl) {
    throw new Error("Both BytePlus and Claude proxy are unavailable");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (claudeKey) headers["X-API-Key"] = claudeKey;

  const res = await fetch(`${claudeUrl}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      systemPrompt: args.systemPrompt,
      messages: args.messages,
      sessionId: args.sessionId,
      userId: args.userId,
      companyId: args.companyId,
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude proxy ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    content: data.content ?? "",
    provider: "claude_proxy",
    model: "claude-proxy",
  };
}
