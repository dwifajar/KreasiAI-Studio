# KreasiAI Studio — Phase 4 Quota Guard

This build adds ElevenLabs quota-aware UX and browser Voice Preview.

## Important
- ElevenLabs quota is provider-side and is separate from KreasiAI credits.
- The app estimates required characters from narration text.
- When ElevenLabs returns a `quota_exceeded` error, the remaining quota is parsed and remembered in the browser.
- Future generation attempts are blocked when the last-known remaining quota is lower than the requested narration character count.
- `🔊 Preview Voice` uses the browser's SpeechSynthesis API and consumes no ElevenLabs quota.
- No new Supabase migration is required.

## Environment
Keep the existing `.env.local` values. Do not paste secrets into chat.
