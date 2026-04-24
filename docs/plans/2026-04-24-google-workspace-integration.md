# Google Workspace Integration Design

## Overview

Add Google Workspace integration to Inside Assistant, following the same pattern as the existing Lark integration. Users connect via OAuth, control permissions via toggles, and set per-service default platforms. The AI uses Google services through tag-based commands from both web chat and WhatsApp.

## OAuth Flow & Token Storage

### Flow
1. User clicks "Connect Google" → `GET /api/integrations/google/start`
2. Redirects to Google OAuth consent with all scopes
3. User authorizes → Google redirects to `GET /api/integrations/google/callback`
4. Callback exchanges auth code for access_token + refresh_token
5. Stores in `user_integrations` table with `provider = 'google'`

### Token Storage (existing table, no migration)
- `provider`: `'google'`
- `access_token`: Google access token (~1 hour expiry)
- `refresh_token`: Google refresh token (long-lived, reusable)
- `expires_at`: token expiration
- `external_id`: Google email address
- `scopes`: array of granted scopes
- `config`: `{ name, avatar_url, permissions: {...}, defaults: {...} }`

### Env Vars
- `GOOGLE_CLIENT_ID`: `39095280084-1aba3hdetuemjtatvlhp1aed4mk5h6i4.apps.googleusercontent.com`
- `GOOGLE_CLIENT_SECRET`: (stored in Vercel env vars)
- `GOOGLE_REDIRECT_URI`: `https://inside-assistant.vercel.app/api/integrations/google/callback`

### OAuth Scopes Requested
- `calendar.events` + `calendar.freebusy` — full calendar CRUD + busy check
- `gmail.modify` — read, send, draft, label
- `drive` — full file access
- `documents` — docs CRUD
- `spreadsheets` — sheets CRUD
- `contacts.readonly` — read contacts
- `tasks` — tasks CRUD
- `meetings.space.created` — create Meet links
- `userinfo.email` + `userinfo.profile` — identity

## API Routes & File Structure

```
app/api/integrations/google/
  ├── start/route.ts          # Redirect to Google OAuth consent
  ├── callback/route.ts       # Exchange code for tokens, store in DB
  ├── connect/route.ts        # GET status, DELETE disconnect
  ├── permissions/route.ts    # GET/PUT permission toggles + defaults
  └── health/route.ts         # Test each Google API

lib/
  ├── google-token.ts         # getFreshGoogleToken() — auto-refresh
  └── google-tools.ts         # All Google API wrappers
```

## AI Tag System

### Google Tags
| Tag | Action |
|---|---|
| `[GOOGLE_DOC:Title]` | Create Google Doc |
| `[GOOGLE_SHEET:Title]` | Create Google Sheet |
| `[GOOGLE_EVENT:Summary\|start\|end\|attendees]` | Create calendar event |
| `[GOOGLE_EVENT_DELETE:eventId]` | Cancel event |
| `[GOOGLE_CAL_LIST:start\|end]` | List events |
| `[GOOGLE_MAIL:to\|subject]` | Send email (body = response) |
| `[GOOGLE_DRIVE:filename]` | Upload to Drive |
| `[GOOGLE_TASK:title]` | Create task |
| `[GOOGLE_MEET]` | Create Meet link |

### Platform Routing Logic
1. Check what platforms user has connected (Google, Lark, or both)
2. If only one connected for that service → use it, no question
3. If both connected → check user's default setting for that service
4. If user explicitly says "Google" or "Lark" → use that one
5. If ambiguous and no default → ask "Google or Lark?"

Existing Lark tags coexist unchanged.

## Settings UI

Google Workspace section shows when connected:
- Connected status (email, date)
- Permission toggles per service (calendar, freebusy, docs, sheets, drive, gmail, contacts, tasks, meet)
- Default Platform dropdown per service (only shown when both Google and Lark connected for that service)
- Health check button
- Disconnect button

Defaults stored in `config.defaults` (e.g. `{ calendar: 'google', docs: 'lark' }`).

## Permission Enforcement

Before executing any Google action:
1. Check `config.permissions[service]` — if false, show warning
2. Check token exists — if not, show "connect Google" message
3. Check token freshness — auto-refresh if expired
4. Execute API call

## Implementation Phases

### Phase 1 — OAuth & Settings UI
- Google OAuth flow (start → callback → connect)
- `getFreshGoogleToken()` refresh helper
- Settings page UI with connect/disconnect
- Permission toggles + default platform dropdowns
- Health check endpoint

### Phase 2 — Google Tools Library
- `google-tools.ts` with all API wrappers
- Calendar, Docs, Sheets, Drive, Gmail, Contacts, Tasks, Meet

### Phase 3 — Inside Assistant Chat Integration
- Add Google tags to `app/api/chat/route.ts`
- Platform routing logic
- Update system prompt
- Permission enforcement

### Phase 4 — WhatsApp AI Reply Integration
- Add Google tags to `ai-reply.ts` in webhook receiver
- Same routing + permission logic

## Coexistence with Lark

- Users can connect both Google and Lark simultaneously
- Per-service default platform setting controls which is used when ambiguous
- AI is context-aware: checks connections, defaults, and explicit user mentions
- If uncertain, AI always asks before acting
