# KreasiAI Studio — Phase 7B: Smart Video Provider Fallback

Phase 7B adds a provider strategy that keeps video generation usable when Google Veo quota or access is unavailable.

## Providers
- `smart` (default): try Google Veo when configured; on quota, billing, permission, authentication, or temporary provider failures, refund reserved credits and automatically create a local scene clip with FFmpeg.
- `veo`: Google Veo only. If unavailable, the API returns the provider error and refunds reserved credits.
- `local`: local FFmpeg scene preview. No Google quota and no external AI provider usage.

## Local fallback
The local clip is intentionally labeled as a **Local Scene Preview**. It is not AI-generated imagery. It is useful for testing the complete pipeline without consuming external video-provider quota.

## UI
The Video Provider selector now includes:
- Smart Auto
- Google Veo 3.1
- Local Scene Preview

Smart Auto is selected by default.

## Database / migration
No SQL migration is required. Phase 7B uses the existing `kai_projects`, `kai_assets`, `kai_generation_jobs`, and `kai-media` bucket.

## Testing
1. Run `npm install`
2. Run `npm run check:ffmpeg`
3. Run `npm run dev`
4. Open Dashboard → AI Content Planner.
5. Create a Content Plan.
6. Keep Provider = Smart Auto.
7. Generate one scene.

If Google quota is unavailable, the UI should show a fallback message and the scene should still receive a playable local MP4.
