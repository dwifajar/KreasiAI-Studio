# KreasiAI Studio — Phase 3

Phase 3 adds the content-planning layer without requiring Veo billing:

- AI Content Planner UI
- Idea → script → scene breakdown
- platform, duration, and tone controls
- visual prompt + camera + transition per scene
- saves each plan as a `kai_projects` record
- optional Gemini planner via `CONTENT_AI_PROVIDER=google`
- zero-cost local fallback if Gemini is unavailable

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000 and choose **AI Content Planner**.

## Optional Gemini mode

If your Google key has text-model quota, set:

```env
CONTENT_AI_PROVIDER=google
CONTENT_AI_MODEL=gemini-2.5-flash
```

The app automatically falls back to the local planner if the Gemini request fails. This phase does not call Veo.

## Next

Phase 4 will turn the scene list into a production pipeline:

1. TTS per scene
2. subtitle/timing data
3. video provider abstraction
4. final FFmpeg render
5. 1080p/4K export
