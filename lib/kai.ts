export function videoCreditCost(resolution: string) {
  return resolution === '4K' ? 20 : 10;
}

export function ttsCreditCost(text: string) {
  return Math.max(1, Math.ceil(text.length / 1200));
}

export function planCreditLimit(plan: string, plans?: Array<{id:string;monthly_credits:number}>) {
  const found = plans?.find(p => p.id === plan);
  if (found) return found.monthly_credits;
  return plan === 'business' ? 5000 : plan === 'pro' ? 1200 : plan === 'creator' ? 300 : 30;
}
