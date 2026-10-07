# KreasiAI Studio – Vercel Font Fix

The Vercel renderer can now use a bundled Inter TTF supplied by the `@fontsource/inter` npm package, instead of relying on a Windows font path.

Minimal patch:
- lib/render/production.ts
- lib/providers/local-video.ts
- next.config.mjs
- add one dependency line to the existing package.json: `"@fontsource/inter": "5.3.0"`

Do NOT upload `.env.local` or any secret. Do not replace the rest of the repository.

After updating GitHub, Vercel will reinstall dependencies and redeploy.
