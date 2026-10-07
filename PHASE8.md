# KreasiAI Studio — PHASE 8: Advanced Video Editor

Phase 8 menambahkan lapisan editor sebelum Production Render.

## Fitur
- Drag & drop urutan scene di timeline.
- Trim start/end per scene.
- Transition: Cut, Fade, Dissolve.
- Subtitle style: ukuran, posisi, background.
- Background music upload ke bucket `kai-media` (maks. 30 MB) + volume.
- Watermark teks, posisi, opacity.
- Master volume.
- Pengaturan editor disimpan di `kai_projects.settings.content_plan.editor`.
- Production Render FFmpeg membaca trim, transition, subtitle style, watermark, master volume, dan background music.
- Tidak perlu migration SQL baru.

## Menjalankan
```cmd
npm install
npm run dev
```
Pastikan FFmpeg tersedia di PATH atau set `FFMPEG_PATH`.

## Pengujian yang disarankan
1. Buat Content Plan.
2. Drag Scene 2 ke posisi Scene 1.
3. Pilih scene dan ubah Trim.
4. Pilih Fade/Dissolve.
5. Atur subtitle dan watermark.
6. Upload musik.
7. Klik `Simpan Edit`.
8. Jalankan `Render MP4 Production`.

## Catatan
Efek Fade/Dissolve pada versi ini diterapkan sebagai fade-in/fade-out per scene pada compositor FFmpeg. Crossfade antar dua clip penuh akan menjadi peningkatan berikutnya.
