import crypto from 'node:crypto';

export type MidtransEnvironment = 'sandbox' | 'production';

type SnapResponse = {
  token?: string;
  redirect_url?: string;
  error_messages?: string[];
};

type StatusResponse = {
  status_code?: string;
  status_message?: string;
  transaction_id?: string;
  order_id?: string;
  transaction_status?: string;
  fraud_status?: string;
  gross_amount?: string;
  payment_type?: string;
  settlement_time?: string;
};

export function getMidtransEnvironment(): MidtransEnvironment {
  return process.env.MIDTRANS_ENV?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
}

function snapBaseUrl(env: MidtransEnvironment) {
  return env === 'production' ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
}

function apiBaseUrl(env: MidtransEnvironment) {
  return env === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
}

export function getMidtransServerKey() {
  const key = process.env.MIDTRANS_SERVER_KEY?.trim();
  if (!key) throw new Error('MIDTRANS_SERVER_KEY belum diatur di .env.local.');
  return key;
}

export function getMidtransPublicUrl() {
  const value = process.env.KAI_PUBLIC_URL?.trim().replace(/\/$/, '');
  if (!value) throw new Error('KAI_PUBLIC_URL belum diatur. Gunakan URL HTTPS publik aplikasi, misalnya https://app.domainanda.com.');
  const localSandbox = getMidtransEnvironment() === 'sandbox' && /^http:\/\/(localhost|127\.0\.1)(:\d+)?$/i.test(value);
  if (!/^https:\/\//i.test(value) && !localSandbox) throw new Error('KAI_PUBLIC_URL harus menggunakan HTTPS, kecuali localhost saat memakai sandbox.');
  return value;
}

function authHeader(serverKey: string) {
  return `Basic ${Buffer.from(`${serverKey}:`, 'utf8').toString('base64')}`;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

export function buildPaymentOrderId(orderId: string) {
  // Snap accepts letters/numbers plus dash/underscore/tilde/dot and a max length of 50.
  return `KAI-${orderId}`.slice(0, 50);
}

export async function createSnapTransaction(input: {
  orderId: string;
  amountIdr: number;
  planId: string;
  planName: string;
  credits: number;
  customer: { email?: string | null; name?: string | null };
}) {
  const env = getMidtransEnvironment();
  const serverKey = getMidtransServerKey();
  const publicUrl = getMidtransPublicUrl();
  const snapOrderId = buildPaymentOrderId(input.orderId);
  const finishUrl = `${publicUrl}/billing/finish?order_id=${encodeURIComponent(input.orderId)}`;
  const errorUrl = `${publicUrl}/billing/finish?order_id=${encodeURIComponent(input.orderId)}&result=error`;
  const payload = {
    transaction_details: {
      order_id: snapOrderId,
      gross_amount: Math.round(input.amountIdr),
    },
    item_details: [{
      id: input.planId,
      price: Math.round(input.amountIdr),
      quantity: 1,
      name: `KreasiAI ${input.planName}`.slice(0, 50),
      category: 'SaaS Subscription',
    }],
    customer_details: {
      email: input.customer.email || undefined,
      first_name: (input.customer.name || 'KreasiAI User').slice(0, 45),
    },
    callbacks: {
      finish: finishUrl,
      error: errorUrl,
    },
    expiry: {
      unit: 'hours',
      duration: Number(process.env.MIDTRANS_EXPIRY_HOURS || 24),
    },
  };

  const response = await fetch(`${snapBaseUrl(env)}/snap/v1/transactions`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authHeader(serverKey),
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const data = await readJson(response) as SnapResponse;
  if (!response.ok || !data.token || !data.redirect_url) {
    const details = data.error_messages?.join('; ') || (typeof (data as any).raw === 'string' ? (data as any).raw : `HTTP ${response.status}`);
    throw new Error(`Midtrans checkout gagal: ${details}`);
  }
  return {
    environment: env,
    snapOrderId,
    token: data.token,
    redirectUrl: data.redirect_url,
  };
}

export function calculateSignatureKey(orderId: string, statusCode: string, grossAmount: string, serverKey: string) {
  return crypto.createHash('sha512').update(`${orderId}${statusCode}${grossAmount}${serverKey}`, 'utf8').digest('hex');
}

export function safeSignatureEqual(expected: string, actual: string) {
  const left = Buffer.from(expected.trim().toLowerCase(), 'utf8');
  const right = Buffer.from(actual.trim().toLowerCase(), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function getMidtransTransactionStatus(orderId: string): Promise<StatusResponse> {
  const env = getMidtransEnvironment();
  const serverKey = getMidtransServerKey();
  const response = await fetch(`${apiBaseUrl(env)}/v2/${encodeURIComponent(orderId)}/status`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: authHeader(serverKey),
    },
    cache: 'no-store',
  });
  const data = await readJson(response) as StatusResponse;
  if (!response.ok) {
    const detail = typeof (data as any).status_message === 'string' ? (data as any).status_message : `HTTP ${response.status}`;
    throw new Error(`Midtrans status check gagal: ${detail}`);
  }
  return data;
}


export function midtransTimestampToIso(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    const iso = raw.replace(' ', 'T') + '+07:00';
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function isSuccessfulMidtransStatus(status: { transaction_status?: string; fraud_status?: string }) {
  const tx = String(status.transaction_status || '').toLowerCase();
  const fraud = status.fraud_status ? String(status.fraud_status).toLowerCase() : '';
  return (tx === 'settlement' || tx === 'capture') && (!fraud || fraud === 'accept');
}
