export const CREDIT_PRICING = {
  video: { standard: 10, '4K': 20 },
  render: { standardPer30s: 2, '4KPer30s': 4 },
} as const;

export type KaiResolution = '720p' | '1080p' | '4K';

export function videoCreditCost(resolution: string) {
  return resolution === '4K' ? CREDIT_PRICING.video['4K'] : CREDIT_PRICING.video.standard;
}

export function ttsCreditCost(text: string) {
  return Math.max(1, Math.ceil(String(text || '').length / 1200));
}

export function productionRenderCreditCost(resolution: string, durationSeconds: number) {
  const duration = Math.max(1, Number(durationSeconds) || 1);
  const blocks = Math.max(1, Math.ceil(duration / 30));
  const perBlock = resolution === '4K' ? CREDIT_PRICING.render['4KPer30s'] : CREDIT_PRICING.render.standardPer30s;
  return blocks * perBlock;
}

export function planCreditLimit(plan: string, plans?: Array<{id:string;monthly_credits:number}>) {
  const found = plans?.find(p => p.id === plan);
  if (found) return found.monthly_credits;
  return plan === 'business' ? 5000 : plan === 'pro' ? 1200 : plan === 'creator' ? 300 : 30;
}

export function planMaxResolution(plan: string): KaiResolution {
  if (plan === 'business' || plan === 'pro' || plan === 'creator') return '4K';
  return '1080p';
}

export function canUseResolution(plan: string, resolution: string) {
  const max = planMaxResolution(plan);
  const rank: Record<KaiResolution, number> = { '720p': 1, '1080p': 2, '4K': 3 };
  return rank[(resolution as KaiResolution)] <= rank[max];
}

export function creditWarning(balance: number, cost: number) {
  if (balance < cost) return `Credit tidak cukup. Dibutuhkan ${cost} credit, saldo ${balance}.`;
  if (balance <= Math.max(3, Math.ceil(cost * 1.5))) return `Saldo credit rendah: ${balance} credit tersisa setelah estimasi penggunaan.`;
  return '';
}
