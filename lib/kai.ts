/**
 * Backward-compatible billing exports.
 *
 * New Phase 13 code should import from '@/lib/billing/credit-economy'.
 * Existing Phase 12 callers keep working unchanged until Phase 13B wires
 * provider-aware costs into the live generation routes.
 */

export {
  CREDIT_ECONOMY,
  CREDIT_ECONOMY_VERSION,
  plannerCreditCost,
  ttsCreditCost,
  localVideoCreditCost,
  veoCreditCost,
  videoCreditCost as economyVideoCreditCost,
  productionRenderCreditCost,
  planCreditLimit,
  planMaxResolution,
  canUseResolution,
  creditWarning,
} from '@/lib/billing/credit-economy';

export type {
  KaiResolution,
  KaiVideoProvider,
  KaiVeoTier,
} from '@/lib/billing/credit-economy';

// Phase 12 compatibility values. Do not remove until Phase 13B is applied.
export const CREDIT_PRICING = {
  video: { standard: 10, '4K': 20 },
  render: { standardPer30s: 2, '4KPer30s': 4 },
} as const;

export function videoCreditCost(resolution: string) {
  return resolution === '4K' ? CREDIT_PRICING.video['4K'] : CREDIT_PRICING.video.standard;
}
