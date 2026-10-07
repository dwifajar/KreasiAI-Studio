# KreasiAI Studio — PHASE 9: SaaS Workspace

Phase 9 menambahkan lapisan workspace SaaS di atas studio yang sudah berjalan.

## Fitur
- Project Dashboard: list, search, open editor, rename, duplicate, delete.
- Saat project dihapus, API server mencoba membersihkan object Storage `kai-media` yang terkait.
- Media Library: video, audio, image, subtitle, dan asset lain; preview + signed URL untuk asset yang dapat dipratinjau.
- Render Queue: memantau `kai_generation_jobs` dengan refresh otomatis saat ada job queued/processing.
- Billing workspace: plan, credit, subscription, dan credit ledger.
- Tidak ada payment provider palsu; tombol upgrade hanya memberi informasi bahwa checkout belum dikonfigurasi.
- Project detail dapat dibuka kembali langsung ke Content Studio dari dashboard.
- Tidak perlu migration SQL baru karena menggunakan `kai_*` tables yang sudah ada.

## Jalankan
```cmd
npm install
npm run check:ffmpeg
npm run dev
```

## Pengujian
1. Buka Dashboard.
2. Gunakan Projects untuk membuka project lama.
3. Rename dan Duplicate.
4. Buat render lalu cek Queue.
5. Cek hasil video/audio di Media.
6. Cek plan, credit, dan ledger di Billing.
7. Hapus project uji jika diperlukan.

## Catatan
- Checkout pembayaran belum diaktifkan. Ini sengaja dibuat transparan sampai payment provider dipilih.
- Asset library menampilkan maksimal 80 asset terbaru.
- Signed URL bersifat sementara dan dibuat ulang saat halaman Media dibuka.
