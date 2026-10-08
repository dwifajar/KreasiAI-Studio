/**
 * KreasiAI Credit Economy — Phase 13A
 *
 * Single source of truth for internal credit pricing.
 *
 * IMPORTANT:
 * - Credits are an internal SaaS usage unit, not provider credits.
 * - Database plan data (kai_plans) remains authoritative for live plans.
 * - This module defines the application-side economy and safe defaults.
 * - Phase 13B will wire these provider-aware costs into the live routes.
 */

export const CREDIT_ECONOMY_VERSION = '1.0.0';

export type KaiResolution = '720p' | '1080p' | '4K';
export type KaiVideoProvider = 'local' | 'veo';
export type KaiVeoTier = 'fast' | 'standard';

export const CREDIT_ECONOMY = {
  version: CREDIT_ECONOMY_VERSION,
  planner: {
    generate: 1,
  },
  tts: {
    charactersPerCredit: 1000,
    minimumCredits: 1,
  },
  localVideo: {
    clipSeconds: 8,
    creditsPerClip: 2,
  },
  veo: {
    fast: {
      '720p': 15,
      '1080p': 20,
      '4K': 40,
    },
    standard: {
      '720p': 55,
      '1080p': 55,
      '4K': 90,
    },
  },
  productionRender: {
    blockSeconds: 30,
    '720p': 2,
    '1080p': 2,
    '4K': 4,
  },
  plans: {
    // Reference/default values. kai_plans in Supabase is authoritative.
    free: {
      monthlyCredits: 30,
      priceIdr: 0,
      maxResolution: '1080p' as KaiResolution,
      watermark: true,
      maxVideoDurationSeconds: 8,
    },
    creator: {
      monthlyCredits: 300,
      priceIdr: 99000,
      maxResolution: '4K' as KaiResolution,
      watermark: false,
      maxVideoDurationSeconds: 30,
    },
    pro: {
      monthlyCredits: 1200,
      priceIdr: 249000,
      maxResolution: '4K' as KaiResolution,
      watermark: false,
      maxVideoDurationSeconds: 60,
    },
    business: {
      monthlyCredits: 5000,
      priceIdr: 799000,
      maxResolution: '4K' as KaiResolution,
      watermark: false,
      maxVideoDurationSeconds: 120,
    },
  },
} as const;

export function plannerCreditCost() {
  return CREDIT_ECONOMY.planner.generate;
}

export function ttsCreditCost(text: string) {
  const chars = Math.max(0, String(text || '').length);
  return Math.max(
    CREDIT_ECONOMY.tts.minimumCredits,
    Math.ceil(chars / CREDIT_ECONOMY.tts.charactersPerCredit),
  );
}

export function localVideoCreditCost(durationSeconds: number) {
  const duration = Math.max(1, Number(durationSeconds) || 1);
  return Math.max(1, Math.ceil(duration / CREDIT_ECONOMY.localVideo.clipSeconds)) * CREDIT_ECONOMY.localVideo.creditsPerClip;
}

export function veoCreditCost(tier: KaiVeoTier, resolution: KaiResolution, durationSeconds: number) {
  const duration = Math.max(1, Number(durationSeconds) || 1);
  const rate = CREDIT_ECONOMY.veo[tier][resolution];
  return Math.max(1, Math.ceil(duration * rate));
}

export function videoCreditCost(args: {
  provider: KaiVideoProvider;
  resolution: KaiResolution;
  durationSeconds: number;
  veoTier?: KaiVeoTier;
}) {
  if (args.provider === 'local') return localVideoCreditCost(args.durationSeconds);
  return veoCreditCost(args.veoTier || 'fast', args.resolution, args.durationSeconds);
}

export function productionRenderCreditCost(resolution: KaiResolution, durationSeconds: number) {
  const duration = Math.max(1, Number(durationSeconds) || 1);
  const blocks = Math.max(1, Math.ceil(duration / CREDIT_ECONOMY.productionRender.blockSeconds));
  return blocks * CREDIT_ECONOMY.productionRender[resolution];
}

export function planCreditLimit(plan: string, plans?: Array<{ id: string; monthly_credits: number }>) {
  const found = plans?.find(p => p.id === plan);
  if (found) return found.monthly_credits;
  const fallback = CREDIT_ECONOMY.plans[plan as keyof typeof CREDIT_ECONOMY.plans];
  return fallback?.monthlyCredits ?? CREDIT_ECONOMY.plans.free.monthlyCredits;
}

export function planMaxResolution(plan: string): KaiResolution {
  const fallback = CREDIT_ECONOMY.plans[plan as keyof typeof CREDIT_ECONOMY.plans];
  return fallback?.maxResolution ?? CREDIT_ECONOMY.plans.free.maxResolution;
}

export function canUseResolution(plan: string, resolution: string) {
  const max = planMaxResolution(plan);
  const rank: Record<KaiResolution, number> = { '720p': 1, '1080p': 2, '4K': 3 };
  const requested = resolution as KaiResolution;
  if (!(requested in rank)) return false;
  return rank[requested] <= rank[max];
}

export function creditWarning(balance: number, cost: number) {
  if (balance < cost) return `Credit tidak cukup. Dibutuhkan ${cost} credit, saldo ${balance}.`;
  if (balance <= Math.max(3, Math.ceil(cost * 1.5))) return `Saldo credit rendah: ${balance} credit tersisa setelah estimasi penggunaan.`;
  return '';
}
