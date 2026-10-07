# KreasiAI Studio — Phase 11
## Midtrans Snap + Verified Webhook + Auto Subscription + Auto Credit

Phase 11 adds a real Midtrans Snap checkout adapter, a public payment notification endpoint, server-side signature verification, transaction-status verification, idempotent billing-event processing, 30-day subscription activation, and automatic credit allocation.

### Payment flow

1. User selects a paid plan in Billing.
2. `/api/billing/checkout` creates a `kai_billing_orders` row with `pending` status.
3. Server creates a Midtrans Snap token/redirect using the Midtrans Server Key. The Server Key never goes to the browser.
4. User pays on Midtrans-hosted checkout.
5. Midtrans calls `/api/billing/midtrans/notification`.
6. Server verifies the `signature_key` and confirms the transaction through Midtrans Status API.
7. `kai_process_midtrans_event(...)` atomically marks the order paid, adds the plan credits, and activates/extends the user's subscription period.
8. Repeated notifications are safe: billing events are idempotent and a paid order cannot grant credits twice.
9. Customer can return to `/billing/finish?order_id=...`, which polls the order until the webhook has activated the account.

### Important subscription model

Phase 11 uses a one-time monthly purchase model: a successful payment grants the selected plan for one month and adds its monthly credits. It does not silently start a recurring card charge. True automatic recurring billing can be added later with a provider feature that supports recurring/subscription charging.

### Environment

Required for Midtrans:

```env
KAI_PAYMENT_PROVIDER=midtrans
MIDTRANS_ENV=sandbox
MIDTRANS_SERVER_KEY=...
KAI_PUBLIC_URL=https://your-public-domain.example.com
```

Use `MIDTRANS_ENV=production` and the production Server Key only after sandbox testing succeeds.

### Supabase migration

Run:

`supabase/migrations/0004_kai_midtrans.sql`

No existing `kai_*` tables are removed. The migration adds an idempotent processor function and a unique index for provider references.

### Midtrans dashboard setup

Set **Payment Notification URL** to:

`https://YOUR_DOMAIN/api/billing/midtrans/notification`

Set Finish/Error URLs to:

`https://YOUR_DOMAIN/billing/finish`

For local development, Midtrans cannot reach `localhost`; use a public HTTPS deployment/temporary tunnel for webhook testing.

### Verification rules

The webhook checks:

- `signature_key = SHA512(order_id + status_code + gross_amount + ServerKey)`
- current transaction status via the Midtrans Status API
- order ID match
- gross amount match
- successful status = `settlement` or `capture` and acceptable fraud status

### Security notes

- Server Key is server-side only.
- Webhook is unauthenticated by user session but protected with Midtrans signature verification and a server-to-server status check.
- Billing event processing is idempotent.
- Credit is added only after successful verification.
- Creating a checkout order never activates a plan.
