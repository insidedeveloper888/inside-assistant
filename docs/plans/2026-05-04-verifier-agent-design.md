# Level 2 Verifier Agent Design

## Overview
A verification layer that checks every AI reply BEFORE sending to WhatsApp.
Prevents identity hallucination, data leakage, and other quality issues.

## Flow
1. Claude Proxy generates reply (attempt 1)
2. Verifier checks 5 rules via Claude Proxy (fast, ~300 token prompt)
3. PASS → send to WhatsApp
4. FAIL → send fix_instructions back to Claude Proxy (attempt 2)
5. PASS → send | FAIL → safe fallback message

## Checks
1. IDENTITY — addresses correct person?
2. DATA_LEAKAGE — contains other contacts' personal data?
3. TAG_FORMAT — all tags properly formatted?
4. LANGUAGE_MATCH — reply language matches user's message?
5. HALLUCINATED_CAPABILITIES — promises actions without tags?

## Retry
- Max 1 retry (2 total attempts)
- Fix instructions sent as follow-up to Claude Proxy
- Fallback: "Hey {name} 👋 Sorry, could you say that again?"

## Logging
- Only failures logged to verifier_log table
- Captures: original reply, failures, fix instructions, outcome

## Skips
- System commands (switch mode, whoami, new session)
- Empty AI responses

## Files
- NEW: services/webhook-receiver/src/lib/verifier.ts
- MODIFY: services/webhook-receiver/src/handlers/ai-reply.ts
- DB: CREATE TABLE verifier_log

## Edge Cases
- Claude Proxy down during verify → skip verify, send unverified (log warning)
- Verifier itself hallucinates (false positive) → retry handles it, fallback is safe
- Very long replies → truncate to 1000 chars for verifier input
- Tags in reply confuse verifier → strip tags before verifying content
- Concurrent messages from same user → each verified independently
- Unicode/emoji in names → verifier prompt includes exact name string
