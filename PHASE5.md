# KreasiAI Studio — Phase 5: Video Composition & Final Render

Phase 5 adds a browser-based final render pipeline on top of the Phase 4 Timeline build.

## New capabilities
- Final Render Studio inside AI Content Studio.
- 16:9 or 9:16 output inferred from platform.
- 720p, 1080p, and experimental 4K browser rendering.
- 24/30/60 FPS options.
- Scene cards rendered into a real video stream with animated progress.
- Subtitle/narration overlay, scene number, timing, camera, and transition metadata rendered into the video.
- Optional inclusion of already-generated ElevenLabs voice clips when browser CORS allows them.
- Browser output format follows MediaRecorder support: MP4 when H.264/AAC is supported, otherwise WebM.
- Upload final video to the private `kai-media` Supabase bucket and register it in `kai_assets` and `kai_generation_jobs`.
- Save the final render metadata under `kai_projects.settings.content_plan.render`.
- No new SQL migration required.

## Important scope
This phase is a composition/staging renderer. It does not generate AI video imagery. The scene visual prompt is represented as a cinematic text-driven scene card so the full pipeline can be tested without Veo quota.

Universal FFmpeg MP4 export, real AI video scene assets, transitions between clips, and full 4K production rendering are subsequent enhancements.

## Test
1. Copy the existing `.env.local` into the Phase 5 folder.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `/dashboard`.
5. Open **AI Content Planner** and generate a plan.
6. Scroll to **Final Render Studio**.
7. Start with **720p, 30 fps**, no voice if you do not have any ElevenLabs audio yet.
8. Click **Render Video Final**.
9. Wait for the browser render to complete and verify the saved video preview.
