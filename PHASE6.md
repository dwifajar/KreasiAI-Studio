# Phase 6 — Production Renderer + Video Provider

Phase 6 adds a server-side FFmpeg production renderer that exports MP4/H.264/AAC, burns subtitles, uses stored voice assets when available, saves the final video to `kai-media`, and records the render in `kai_assets` + `kai_generation_jobs`.

## Windows prerequisite
Install FFmpeg and make sure this works in Command Prompt:

```cmd
ffmpeg -version
```

If `ffmpeg` is not in PATH, set `FFMPEG_PATH` in `.env.local` to the full `ffmpeg.exe` path.

Example:

```env
FFMPEG_PATH=C:\\ffmpeg\\bin\\ffmpeg.exe
```

You can optionally set a `.ttf` font:

```env
KAI_FONT_FILE=C:\\Windows\\Fonts\\arial.ttf
```

## What Phase 6 does
- Production MP4 render on the machine running Next.js (synchronous request in Phase 6).
- H.264 video + AAC audio.
- 720p / 1080p / 4K.
- 24 / 30 / 60 FPS.
- 16:9 or 9:16 inferred from platform.
- Uses ElevenLabs audio assets already stored in Supabase.
- Burns narration as subtitles when enabled.
- Saves an SRT asset when subtitle burn-in is enabled.
- Stores the production render as a private Supabase Storage asset.
- Uses already-generated scene video clips automatically when their `video_asset_id` exists; otherwise falls back to the cinematic scene card.
- Adds a `production_render` block into `kai_projects.settings.content_plan`.

## Video provider architecture
`/api/generate/video` now starts the existing Veo provider as an asynchronous job and `/api/jobs/:id` polls and finalizes completed Veo output. The Content Studio scene button passes project/scene information so a completed Veo clip can be attached to its scene.

If Google/Veo quota is unavailable, the production renderer remains usable because it does not call Veo.

## Important
The production render endpoint is synchronous for this phase. For long 4K renders and a commercial SaaS deployment, the next architecture should move FFmpeg work into a worker/queue while the dashboard polls a persistent job.

The Phase 6 FFmpeg renderer is a production compositor. It uses real scene video clips when available (for example, a completed Veo job); when a scene has no generated clip it falls back to the current cinematic scene card. This lets the same renderer work before and after an AI video provider is enabled.

## Run
```cmd
npm install
npm run dev
```

Open `http://localhost:3000/dashboard` → **AI Content Planner** → create a plan → scroll to **Production Render — FFmpeg**.
