# PHASE 7 — Real AI Video Scene

Phase 7 upgrades KreasiAI Studio from scene-card rendering to a real AI video scene pipeline with Google Veo 3.1.

## Fitur
- Video provider abstraction (`lib/providers/video.ts`).
- Google Veo 3.1 sebagai provider pertama.
- Provider readiness endpoint: `GET /api/video/providers`.
- Per-scene real AI video generation.
- 16:9 / 9:16.
- 720p / 1080p / 4K.
- Veo clip duration: 4 / 6 / 8 seconds.
- 1080p dan 4K dipaksa menggunakan 8-second clips by provider rules.
- Provider/model/operation disimpan di `kai_generation_jobs`.
- Video hasil di-upload ke private `kai-media` dan dicatat di `kai_assets`.
- Project `content_plan.scenes[]` otomatis di-update ketika job selesai.
- Friendly errors untuk missing key, permission, dan quota/billing.
- Production renderer dapat menggunakan native audio dari AI video scene ketika ElevenLabs voice tidak tersedia.

## Environment
```env
GOOGLE_API_KEY=
VEO_MODEL=veo-3.1-generate-preview
```

No new SQL migration is required.

## Important
Veo generation can consume Google quota/billing. Generate one scene at a time during testing.
The final FFmpeg renderer can trim a generated 4/6/8 second clip to the timeline duration, or loop it when the timeline scene is longer.
