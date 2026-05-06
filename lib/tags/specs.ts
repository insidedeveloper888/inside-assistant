/**
 * Tag specifications — single source of truth for what the AI can emit.
 *
 * ⚠️  KEEP THIS FILE BYTE-IDENTICAL between:
 *     - inside-assistant/lib/tags/specs.ts
 *     - whatsappanalysis/services/webhook-receiver/src/lib/tags/specs.ts
 *
 * The CI script `scripts/check-tags-sync.ts` runs `diff` between the two
 * copies on every PR. Any change must land in BOTH repos in the same PR.
 *
 * Adding a new tag:
 *   1. Add a TagSpec entry below (this file, both repos).
 *   2. Implement the handler in the local handlers.ts (web side or WA side
 *      depending on which channels listed below).
 *   3. The prompt + dispatcher + strip regex update automatically.
 *
 * Removing a tag: delete the entry from both repos in the same PR.
 */

import type { TagSpec } from "./types.js";

export const TAG_SPECS: TagSpec[] = [
  // ─────────────────────────────────────────────────────────────────────
  // MEMORY ROUTING (web + whatsapp; fires immediately, no Lark/Google deps)
  // ─────────────────────────────────────────────────────────────────────
  {
    name: "MEMORY",
    shape: "value",
    kind: "marker",
    channels: ["web", "whatsapp"],
    modes: ["personal", "company"],
    description: "Route this turn's content to a memory bucket",
    trigger:
      'AI decides where to persist a learned fact: "personal" for private notes, "company" for team-shared knowledge.',
    usage:
      "Emit at the END of your reply: [MEMORY:personal] OR [MEMORY:company]. " +
      "Personal mode is STRICT — even if you tag company, it stays personal. " +
      "Company mode respects your routing.",
    example: "[MEMORY:personal]",
  },
  {
    name: "DIRECTOR-ONLY",
    aliases: ["CONFIDENTIAL"],
    shape: "flag",
    kind: "marker",
    channels: ["web", "whatsapp"],
    modes: ["personal", "company"],
    description: "Mark stored memory as director-only / confidential",
    trigger:
      'User says "save as director-only" / "keep this confidential" / "保密". HR, finance, strategic decisions only.',
    usage:
      "Emit alongside [MEMORY:...] to gate the stored memory so non-directors cannot retrieve it. Use sparingly.",
    example: "[DIRECTOR-ONLY]",
  },

  // ─────────────────────────────────────────────────────────────────────
  // NOTIFICATION (web + whatsapp; pairs with FORWARD)
  // ─────────────────────────────────────────────────────────────────────
  {
    name: "NOTIFY",
    shape: "value",
    channels: ["web", "whatsapp"],
    description: "Ping a teammate via Lark + WhatsApp",
    trigger:
      'User asks to "ping / notify / tell" a teammate by name (or "Name:Phone" for WA-side roster).',
    usage:
      "Emit [NOTIFY:FirstName] (web) or [NOTIFY:Name:Phone] (WhatsApp). For long messages, " +
      "PAIR with [FORWARD:actual recipient-facing content] so the recipient sees a clean " +
      "message, not your reply to the sender. Multiple recipients = multiple [NOTIFY:] tags " +
      "sharing one [FORWARD:].",
    example: "[FORWARD:Hey Jacky, deploy is fixed][NOTIFY:Jacky]",
  },
  {
    name: "FORWARD",
    shape: "value",
    kind: "marker",
    channels: ["web", "whatsapp"],
    description: "The recipient-facing body to pair with [NOTIFY:...]",
    trigger:
      "Always pair with [NOTIFY:...] when the message you'd otherwise send to the user is " +
      "different from what the recipient should see (e.g. summarised, translated, addressed to them).",
    usage:
      "Place [FORWARD:body] BEFORE [NOTIFY:...]. Body may contain newlines and brackets — the " +
      "regex uses a lookahead, not a greedy match. Strip the [FORWARD:...] from your reply text " +
      "automatically (handled by dispatcher).",
  },

  // ─────────────────────────────────────────────────────────────────────
  // LARK CALENDAR (web + whatsapp; personal mode; requires Lark)
  // ─────────────────────────────────────────────────────────────────────
  {
    name: "LARK_EVENT",
    shape: "pipe",
    channels: ["web", "whatsapp"],
    requires: ["lark"],
    description: "Book a Lark calendar event with optional attendees",
    trigger:
      'User asks to schedule / book / create a calendar event ("schedule call with CK tomorrow 3pm").',
    usage:
      "Format: [LARK_EVENT:Summary|start_iso|end_iso|attendee_open_ids_csv]. Default timezone " +
      "Asia/Kuala_Lumpur. Attendee open_ids come from the team roster injected in your prompt. " +
      "If a teammate is mentioned by name, you MUST include their open_id — never leave attendees " +
      "empty when a name was mentioned. ASK before emitting if any field is ambiguous.",
    example:
      "[LARK_EVENT:Q2 review with CK|2026-04-22T15:00:00+08:00|2026-04-22T16:00:00+08:00|ou_61db38af2ed81422bd9a5fe6601c207d]",
  },
  {
    name: "LARK_EVENT_DELETE",
    shape: "value",
    channels: ["web", "whatsapp"],
    requires: ["lark"],
    description: "Cancel a previously-booked Lark event by event_id",
    trigger: 'User asks to cancel / delete an event you previously booked.',
    usage:
      "Find the event_id from a recent [LARK_EVENT] result in conversation history and emit " +
      "[LARK_EVENT_DELETE:event_id]. If you cannot find it, ASK which event by title + time " +
      "rather than guessing.",
    example: "[LARK_EVENT_DELETE:omc_20260422_xyz123]",
  },
  {
    name: "LARK_CAL_LIST",
    shape: "pipe",
    channels: ["web", "whatsapp"],
    requires: ["lark"],
    description: "Show user's Lark schedule for a date range",
    trigger:
      'User asks "what\'s on my calendar today / this week" / "am I free Thursday".',
    usage:
      "Read-only — fire IMMEDIATELY, no confirmation. Format: [LARK_CAL_LIST:start_iso|end_iso]. " +
      "System appends a bullet list of events with attendees and Meet links to your reply.",
    example: "[LARK_CAL_LIST:2026-04-21T00:00:00+08:00|2026-04-22T00:00:00+08:00]",
  },

  // ─────────────────────────────────────────────────────────────────────
  // LARK DOCS / WHITEBOARD (web only for whiteboard; both for docs)
  // ─────────────────────────────────────────────────────────────────────
  {
    name: "LARK_DOC",
    shape: "value",
    channels: ["web", "whatsapp"],
    requires: ["lark"],
    description: "Materialize this turn's reply as a Lark doc",
    trigger:
      'User EXPLICITLY asks to save / push / create a Lark doc ("save this as a Lark doc", "持久化到 Lark").',
    usage:
      "Emit only on the CONFIRMATION turn — never during drafting. The full reply body (markdown: " +
      "## headings, **bold**, lists, ```code blocks, mermaid diagrams) becomes the doc content " +
      "after tags are stripped. Pick a concise title ≤ 80 chars. System appends '📝 Saved to " +
      "Lark: URL' on success.",
    example: "[LARK_DOC:Q2 strategy notes]",
  },
  {
    name: "LARK_BOARD",
    shape: "value",
    channels: ["web"],
    requires: ["lark"],
    description: "Create an empty Lark whiteboard for the user to draw in",
    trigger:
      'User explicitly wants a freeform whiteboard ("create a whiteboard for sketching"). For ' +
      "diagrams describable in code, prefer LARK_DOC with a mermaid block — usually more useful.",
    usage:
      "Emit [LARK_BOARD:Title]. Creates an empty board under user's Drive and returns the URL — " +
      "they draw the content themselves in Lark.",
    example: "[LARK_BOARD:Brainstorm Q3 launch]",
  },

  // ─────────────────────────────────────────────────────────────────────
  // LARK TASKS (web + whatsapp)
  // ─────────────────────────────────────────────────────────────────────
  {
    name: "LARK_TASK_LIST",
    shape: "flag",
    channels: ["web", "whatsapp"],
    requires: ["lark"],
    description: "List the user's open Lark tasks (with GUIDs for follow-up)",
    trigger:
      'User asks "list my Lark tasks" / "show my todos" / "今天 task 有什么" / "what\'s pending".',
    usage:
      "Read-only — fire IMMEDIATELY on first ask. System appends a bullet list of open tasks with " +
      "their GUIDs (you'll need GUIDs to mark them complete later in the conversation).",
    example: "[LARK_TASK_LIST]",
  },
  {
    name: "LARK_TASK",
    shape: "value",
    channels: ["web", "whatsapp"],
    requires: ["lark"],
    description: "Create a Lark task with optional due date",
    trigger:
      'User asks to add a task ("remind me to ship X", "add task: review Y by Friday").',
    usage:
      "Format: [LARK_TASK:Title] OR [LARK_TASK:Title|due_iso]. Title only — no 'Task:' prefix or " +
      "quotes. Confirm interpretation before emitting if ambiguous.",
    example: "[LARK_TASK:Review PestSol PR|2026-04-30T17:00:00+08:00]",
  },
  {
    name: "LARK_TASK_COMPLETE",
    aliases: ["LARK_TASK_DONE"],
    shape: "value",
    channels: ["web", "whatsapp"],
    requires: ["lark"],
    description: "Mark a Lark task complete by GUID",
    trigger: 'User asks to mark a task done / complete / finished.',
    usage:
      "Find the task GUID from a recent [LARK_TASK_LIST] result in conversation history and emit " +
      "[LARK_TASK_COMPLETE:guid] (or [LARK_TASK_DONE:guid] — both accepted). If GUID isn't in " +
      "context, run [LARK_TASK_LIST] first and ask which task to complete.",
    example: "[LARK_TASK_COMPLETE:7234abc8d-...]",
  },

  // ─────────────────────────────────────────────────────────────────────
  // GOOGLE WORKSPACE (web + whatsapp; per-permission gated)
  // ─────────────────────────────────────────────────────────────────────
  {
    name: "GOOGLE_DOC",
    shape: "value",
    channels: ["web", "whatsapp"],
    requires: ["google"],
    googlePermission: "docs",
    description: "Create a Google Doc from this turn's reply body",
    trigger: 'User explicitly asks for a Google Doc ("save as Google doc", "create G doc titled X").',
    usage:
      "Emit [GOOGLE_DOC:Title]. The cleaned reply text becomes the doc body. Pick a concise " +
      "title. System appends a link to the new doc.",
    example: "[GOOGLE_DOC:Meeting notes 2026-04-22]",
  },
  {
    name: "GOOGLE_SHEET",
    shape: "pipe",
    channels: ["web", "whatsapp"],
    requires: ["google"],
    googlePermission: "sheets",
    description: "Create a Google Sheet with header columns",
    trigger: 'User asks for a Google Sheet ("create a sheet for tracking X").',
    usage:
      "Format: [GOOGLE_SHEET:Title|Header1,Header2,Header3]. Headers comma-separated.",
    example: "[GOOGLE_SHEET:Q2 leads tracker|Name,Phone,Stage,Score]",
  },
  {
    name: "GOOGLE_EVENT",
    shape: "pipe",
    channels: ["web", "whatsapp"],
    requires: ["google"],
    googlePermission: "calendar",
    description: "Create a Google Calendar event with auto Meet link",
    trigger: 'User asks for a Google Calendar event ("book G cal event", "schedule on Google").',
    usage:
      "Format: [GOOGLE_EVENT:Summary|start_iso|end_iso|attendee_emails_csv]. Auto-creates a " +
      "Meet link. Default timezone Asia/Kuala_Lumpur.",
    example:
      "[GOOGLE_EVENT:Sprint review|2026-04-25T10:00:00+08:00|2026-04-25T11:00:00+08:00|alice@inside.com,bob@inside.com]",
  },
  {
    name: "GOOGLE_EVENT_DELETE",
    shape: "value",
    channels: ["web", "whatsapp"],
    requires: ["google"],
    googlePermission: "calendar",
    description: "Cancel a Google Calendar event by ID",
    trigger: 'User asks to cancel a Google Calendar event you previously created.',
    usage: "Find the eventId from a prior [GOOGLE_EVENT] result and emit [GOOGLE_EVENT_DELETE:eventId].",
    example: "[GOOGLE_EVENT_DELETE:abc123def456]",
  },
  {
    name: "GOOGLE_CAL_LIST",
    shape: "pipe",
    channels: ["web", "whatsapp"],
    requires: ["google"],
    googlePermission: "calendar",
    description: "List Google Calendar events for a date range",
    trigger: 'User asks "what\'s on my Google calendar today / this week".',
    usage: "Format: [GOOGLE_CAL_LIST:start_iso|end_iso]. Read-only — fire immediately.",
    example: "[GOOGLE_CAL_LIST:2026-04-21T00:00:00+08:00|2026-04-22T00:00:00+08:00]",
  },
  {
    name: "GOOGLE_MAIL",
    shape: "pipe",
    channels: ["web", "whatsapp"],
    requires: ["google"],
    googlePermission: "gmail",
    description: "Send an email via the user's Gmail",
    trigger: 'User asks to email someone ("send email to X about Y").',
    usage:
      "Format: [GOOGLE_MAIL:to_email|subject|email body]. The 3rd part is the ACTUAL email " +
      "body addressed to the recipient — NOT your conversational confirmation. Write it cleanly " +
      "and professionally as if you were the user.",
    example: "[GOOGLE_MAIL:client@example.com|Q2 proposal|Hi Alice, attached is the Q2 proposal we discussed...]",
  },
  {
    name: "GOOGLE_TASK",
    shape: "value",
    channels: ["web", "whatsapp"],
    requires: ["google"],
    googlePermission: "tasks",
    description: "Create a Google Task",
    trigger: 'User asks to add a Google Task ("add to my Google tasks").',
    usage: "Emit [GOOGLE_TASK:Title]. Title only.",
    example: "[GOOGLE_TASK:Review monthly report]",
  },
  {
    name: "GOOGLE_MEET",
    shape: "flag",
    channels: ["web", "whatsapp"],
    requires: ["google"],
    googlePermission: "meet",
    description: "Generate a standalone Google Meet link",
    trigger: 'User asks for a Meet link without a calendar event ("just give me a Meet link").',
    usage:
      "Emit [GOOGLE_MEET]. Returns a one-shot Meet URL the user can share. For scheduled " +
      "meetings prefer [GOOGLE_EVENT:...] which auto-includes a Meet link.",
    example: "[GOOGLE_MEET]",
  },
];
