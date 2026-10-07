# KreasiAI Studio — PHASE 10: SaaS Billing, Credit Metering & Admin Control

Phase 10 menambahkan fondasi monetisasi yang aman tanpa menganggap pembayaran berhasil sebelum provider mengonfirmasi melalui webhook server-side.

## Fitur
- Billing order table (`kai_billing_orders`) dengan status pending/paid/failed/cancelled/expired/refunded.
- Payment event log (`kai_billing_events`) dengan unique provider event ID untuk idempotency.
- Checkout intent endpoint `/api/billing/checkout`.
- Order history di Billing workspace.
- Plan/credit dashboard tetap menggunakan `kai_profiles`, `kai_plans`, `kai_subscriptions`, `kai_credit_ledger`.
- Admin SaaS dashboard untuk users, subscription, revenue, credit outstanding, job counts, plan distribution, dan recent billing orders.
- Admin access melalui `KAI_ADMIN_USER_IDS` atau profile plan `admin`.
- Tidak ada checkout palsu; provider adapter belum aktif sampai kredensial dan webhook diverifikasi.

## Migration
Jalankan satu migration baru di Supabase BANI MAD KAMARI:
`supabase/migrations/0003_kai_billing.sql`

Migration ini additive dan tidak menghapus tabel KreasiAI yang sudah ada.

## Environment
```env
KAI_ADMIN_USER_IDS=
KAI_BILLING_MODE=production
KAI_PAYMENT_PROVIDER=
NEXT_PUBLIC_KAI_BILLING_MODE=production
```

Untuk admin, isi `KAI_ADMIN_USER_IDS` dengan auth user UUID yang ingin diberi akses Admin SaaS. Jangan masukkan password atau secret di file yang dibagikan publik.

## Checkout behavior sekarang
`/api/billing/checkout` membuat order `pending`. Bila payment provider belum dikonfigurasi, UI hanya memberi pesan bahwa checkout belum tersedia. Plan dan credit TIDAK berubah.

Tahap provider berikutnya akan menambahkan adapter + signed webhook verification + idempotent fulfillment.
