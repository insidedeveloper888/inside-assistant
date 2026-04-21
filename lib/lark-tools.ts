/**
 * Lark user-scoped tools. Every function takes the authenticated user's own token —
 * callers MUST pass the token fetched server-side from user_integrations keyed by
 * the session user_id. Never accept a user_id from a request body and use it to
 * look up a token; that'd let one user act as another.
 *
 * API host: open.larksuite.com (international / Lark). Switch to open.feishu.cn
 * for China / Feishu tenants.
 */

const API = "https://open.larksuite.com";

type LarkResponse<T> = { code: number; msg: string; data?: T };

async function lark<T>(
  path: string,
  init: RequestInit & { token: string }
): Promise<{ ok: true; data: T } | { ok: false; error: string; code?: number }> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(headers as Record<string, string> | undefined),
    },
  });
  const body = (await res.json()) as LarkResponse<T>;
  if (body.code !== 0) {
    return { ok: false, error: body.msg ?? `code ${body.code}`, code: body.code };
  }
  return { ok: true, data: body.data as T };
}

/**
 * Create a new Lark doc and write markdown-ish content as the opening block(s).
 * Docs created via docx/v1/documents are owned by the user whose token is used.
 *
 * For MVP we insert the content as a single text block. Proper markdown → block
 * tree conversion (headings, lists, code blocks) is Phase 2 — for now the user
 * can edit the doc after creation if they want richer formatting.
 */
export async function larkCreateDoc(args: {
  token: string;
  title: string;
  content: string;
  folderToken?: string; // optional: create inside a specific folder
}): Promise<{ ok: true; documentId: string; url: string } | { ok: false; error: string }> {
  // Step 1 — create an empty doc
  const createRes = await lark<{ document: { document_id: string } }>(
    "/open-apis/docx/v1/documents",
    {
      token: args.token,
      method: "POST",
      body: JSON.stringify({
        title: args.title.slice(0, 80),
        ...(args.folderToken ? { folder_token: args.folderToken } : {}),
      }),
    }
  );
  if (!createRes.ok) return { ok: false, error: `create failed: ${createRes.error}` };

  const documentId = createRes.data.document.document_id;

  // Step 2 — append the content as a text block under the root block.
  // Fetch the root block first (it's the document itself; its id equals documentId).
  const appendRes = await lark<unknown>(
    `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children?document_revision_id=-1`,
    {
      token: args.token,
      method: "POST",
      body: JSON.stringify({
        index: 0,
        children: [
          {
            block_type: 2, // text
            text: {
              elements: [{ text_run: { content: args.content.slice(0, 20000) } }],
              style: {},
            },
          },
        ],
      }),
    }
  );
  if (!appendRes.ok) {
    return { ok: false, error: `append failed: ${appendRes.error}` };
  }

  return {
    ok: true,
    documentId,
    url: `https://inside.sg.larksuite.com/docx/${documentId}`,
  };
}

/**
 * Append a text block to an existing doc. Caller owns the doc (token must be the
 * owner's or someone with edit access).
 */
export async function larkAppendDoc(args: {
  token: string;
  documentId: string;
  content: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await lark<unknown>(
    `/open-apis/docx/v1/documents/${args.documentId}/blocks/${args.documentId}/children?document_revision_id=-1`,
    {
      token: args.token,
      method: "POST",
      body: JSON.stringify({
        children: [
          {
            block_type: 2,
            text: {
              elements: [{ text_run: { content: args.content.slice(0, 20000) } }],
              style: {},
            },
          },
        ],
      }),
    }
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

/**
 * Fetch doc content (all blocks flattened to plain text). Useful for letting the
 * AI read an existing doc before amending it.
 */
export async function larkReadDoc(args: {
  token: string;
  documentId: string;
}): Promise<{ ok: true; title: string; content: string } | { ok: false; error: string }> {
  const metaRes = await lark<{ document: { title: string } }>(
    `/open-apis/docx/v1/documents/${args.documentId}`,
    { token: args.token, method: "GET" }
  );
  if (!metaRes.ok) return { ok: false, error: metaRes.error };

  const blocksRes = await lark<{ items: { block_type: number; text?: { elements: { text_run?: { content: string } }[] } }[] }>(
    `/open-apis/docx/v1/documents/${args.documentId}/blocks?page_size=500`,
    { token: args.token, method: "GET" }
  );
  if (!blocksRes.ok) return { ok: false, error: blocksRes.error };

  const content = blocksRes.data.items
    .filter((b) => b.block_type === 2 && b.text?.elements)
    .map((b) => b.text!.elements.map((e) => e.text_run?.content ?? "").join(""))
    .join("\n\n");

  return { ok: true, title: metaRes.data.document.title, content };
}
