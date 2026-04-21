/**
 * Markdown to Lark docx block tree converter.
 *
 * Scope (what AI actually emits):
 *  - Headings H1-H6 (block_type 3-8)
 *  - Paragraphs with inline bold / italic / code / links (block_type 2)
 *  - Bullet list items (block_type 12)
 *  - Numbered list items (block_type 13)
 *  - Code blocks with language (block_type 14)
 *  - Mermaid code fences become Diagram block (block_type 43)
 *  - Blockquotes (block_type 15)
 *  - Horizontal rule --- (block_type 21)
 *
 * Out of scope (fall back to plain text for now):
 *  - Native docx tables (block_type 31) - nested block structure is expensive
 *  - Images (need upload first, then insert; separate flow).
 */

export type LarkBlock = {
  block_type: number;
  [key: string]: unknown;
};

type TextStyle = {
  bold?: boolean;
  italic?: boolean;
  inline_code?: boolean;
  link?: { url: string };
};

type TextElement = {
  text_run: {
    content: string;
    text_element_style?: TextStyle;
  };
};

const CODE_LANG_MAP: Record<string, number> = {
  plaintext: 1, bash: 7, shell: 7, sh: 7,
  csharp: 8, c: 10, cpp: 9, "c++": 9,
  css: 12, dart: 14, dockerfile: 17, docker: 17,
  go: 22, golang: 22, html: 26, java: 31,
  javascript: 32, js: 32, json: 33, kotlin: 35,
  lua: 40, makefile: 41, markdown: 42, md: 42,
  mermaid: 44, nginx: 45,
  python: 55, py: 55, r: 56, ruby: 61, rb: 61,
  rust: 62, rs: 62, scala: 64, scss: 66,
  sql: 68, swift: 70,
  typescript: 71, ts: 71, tsx: 71,
  xml: 78, yaml: 79, yml: 79,
};

function parseInline(text: string): TextElement[] {
  if (!text) return [];
  const elements: TextElement[] = [];

  const tokens: { re: RegExp; style: TextStyle; extract: (m: RegExpExecArray) => string }[] = [
    { re: /`([^`]+)`/, style: { inline_code: true }, extract: (m) => m[1] },
    { re: /\*\*([^*]+)\*\*/, style: { bold: true }, extract: (m) => m[1] },
    { re: /__([^_]+)__/, style: { bold: true }, extract: (m) => m[1] },
    { re: /\*([^*]+)\*/, style: { italic: true }, extract: (m) => m[1] },
    { re: /_([^_]+)_/, style: { italic: true }, extract: (m) => m[1] },
    { re: /\[([^\]]+)\]\(([^)]+)\)/, style: {}, extract: (m) => m[1] },
  ];

  let remaining = text;
  while (remaining.length > 0) {
    let earliestIdx = -1;
    let earliestLen = 0;
    let earliestContent = "";
    let earliestStyle: TextStyle = {};
    let earliestIsLink = false;
    let earliestUrl = "";

    for (const tok of tokens) {
      const m = tok.re.exec(remaining);
      if (!m) continue;
      if (earliestIdx === -1 || m.index < earliestIdx) {
        earliestIdx = m.index;
        earliestLen = m[0].length;
        earliestContent = tok.extract(m);
        earliestStyle = { ...tok.style };
        earliestIsLink = tok.re.source.includes("]\\(");
        if (earliestIsLink) earliestUrl = m[2];
      }
    }

    if (earliestIdx === -1) {
      elements.push({ text_run: { content: remaining } });
      break;
    }

    if (earliestIdx > 0) {
      elements.push({ text_run: { content: remaining.slice(0, earliestIdx) } });
    }

    if (earliestIsLink) {
      elements.push({
        text_run: { content: earliestContent, text_element_style: { link: { url: earliestUrl } } },
      });
    } else {
      elements.push({ text_run: { content: earliestContent, text_element_style: earliestStyle } });
    }

    remaining = remaining.slice(earliestIdx + earliestLen);
  }

  return elements;
}

function blockTypeToKey(blockType: number): string {
  switch (blockType) {
    case 2: return "text";
    case 3: return "heading1";
    case 4: return "heading2";
    case 5: return "heading3";
    case 6: return "heading4";
    case 7: return "heading5";
    case 8: return "heading6";
    case 12: return "bullet";
    case 13: return "ordered";
    case 15: return "quote";
    default: return "text";
  }
}

function textBlock(blockType: number, content: string): LarkBlock {
  const key = blockTypeToKey(blockType);
  return {
    block_type: blockType,
    [key]: {
      elements: parseInline(content),
      style: {},
    },
  };
}

export function markdownToLarkBlocks(markdown: string): LarkBlock[] {
  const lines = markdown.split("\n");
  const blocks: LarkBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      // Lark divider block. Some tenants restrict creating dividers via children API —
      // if it fails we silently drop the divider (fall through to blank line) rather
      // than fail the whole doc. For now use block_type 22 per Lark docx spec.
      blocks.push({ block_type: 22, divider: {} });
      i++;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim().toLowerCase();
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        bodyLines.push(lines[i]);
        i++;
      }
      i++;
      const body = bodyLines.join("\n");

      // Mermaid renders natively in Lark when the code block language is
      // set to 'mermaid' (language code 44). The standalone Diagram block
      // (type 43) expects a different enum shape we don't have docs for,
      // so we use the code-block path which Lark's web+desktop clients
      // auto-render as a live diagram.
      blocks.push({
        block_type: 14,
        code: {
          elements: [{ text_run: { content: body } }],
          style: { language: CODE_LANG_MAP[lang] ?? 1, wrap: false },
        },
      });
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(textBlock(2 + level, headingMatch[2]));
      i++;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(textBlock(15, quoteLines.join("\n")));
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      while (i < lines.length) {
        const m = /^[-*]\s+(.+)$/.exec(lines[i].trim());
        if (!m) break;
        blocks.push(textBlock(12, m[1]));
        i++;
      }
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      while (i < lines.length) {
        const m = /^\d+\.\s+(.+)$/.exec(lines[i].trim());
        if (!m) break;
        blocks.push(textBlock(13, m[1]));
        i++;
      }
      continue;
    }

    const paraLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next) break;
      if (/^(#{1,6})\s+/.test(next)) break;
      if (/^[-*]\s+/.test(next)) break;
      if (/^\d+\.\s+/.test(next)) break;
      if (next.startsWith(">")) break;
      if (next.startsWith("```")) break;
      if (/^(-{3,}|_{3,}|\*{3,})$/.test(next)) break;
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(textBlock(2, paraLines.join(" ")));
  }

  return blocks;
}
