# KreasiAI Studio — Phase 4

Phase 4 extends Phase 3 into a content production workflow:

- AI Content Studio UI
- Voice generation per scene using the existing ElevenLabs integration
- Generate all scene voices sequentially
- Audio preview per scene
- Scene start/end timing for subtitle preparation
- Scene-level video generation button using the existing Google Veo provider
- Project content plan updated with generated voice asset URLs
- Uses existing `kai_projects`, `kai_assets`, `kai_generation_jobs`, and `kai-media`; no new SQL migration required.

## Environment
Keep the existing `.env.local` values from Phase 3. For the planner, use:

```env
CONTENT_AI_PROVIDER=local
```

ElevenLabs must remain configured as in the working Phase 2/3 project.

Google Veo remains optional. If its quota is unavailable, scene video generation will report the provider error; planning and voice generation still work.

## Run

```cmd
npm install
npm run dev
```

Open `http://localhost:3000/dashboard` and use **AI Content Planner**.
