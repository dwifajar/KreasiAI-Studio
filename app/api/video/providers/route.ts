import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVeoModel } from '@/lib/providers/veo';
import { getVideoProvider } from '@/lib/providers/video';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const veo = getVideoProvider('veo');
  const local = getVideoProvider('local');
  const smart = getVideoProvider('smart');
  return NextResponse.json({
    defaultProvider: 'smart',
    providers: [
      { id: smart.id, label: smart.label, configured: true, status: 'ready', nativeAudio: true, fallback: 'local' },
      { id: veo.id, label: veo.label, model: getVeoModel(), configured: veo.configured, status: veo.configured ? 'configured' : 'missing_key', nativeAudio: true, outputDurations: [4, 6, 8], maxResolution: '4K' },
      { id: local.id, label: local.label, configured: local.configured, status: 'ready', nativeAudio: false, outputDurations: [4, 6, 8], maxResolution: '4K' },
    ],
  });
}
