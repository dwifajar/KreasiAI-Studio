import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function clampScenes(duration: number) {
  if (duration <= 15) return 3;
  if (duration <= 30) return 5;
  if (duration <= 60) return 7;
  return 10;
}

function localPlan(idea: string, duration: number, platform: string, tone: string) {
  const count = clampScenes(duration);
  const per = Math.max(3, Math.round(duration / count));
  const hooks = [
    `Pernah bertanya-tanya tentang ${idea.toLowerCase()}?`,
    `Inilah cara sederhana memahami ${idea.toLowerCase()}.`,
    `Bayangkan jika ${idea.toLowerCase()} bisa dibuat lebih menarik.`
  ];
  const scenes = Array.from({ length: count }, (_, i) => {
    const role = i === 0 ? 'Hook' : i === count - 1 ? 'CTA' : i === 1 ? 'Context' : 'Main Point';
    const narration = i === 0
      ? hooks[i % hooks.length]
      : i === count - 1
        ? `Jika Anda menyukai konten seperti ini, ikuti KreasiAI untuk ide berikutnya.`
        : `Tampilkan bagian ${i} dari cerita tentang ${idea.toLowerCase()}, dengan gaya ${tone.toLowerCase()} dan visual yang mudah dipahami.`;
    return {
      scene: i + 1,
      role,
      duration_seconds: per,
      narration,
      visual_prompt: `Cinematic ${tone.toLowerCase()} scene about ${idea}. Scene ${i + 1}, natural lighting, detailed environment, smooth camera movement, no text, no watermark.`,
      camera: i === 0 ? 'slow push-in' : i % 2 ? 'tracking shot' : 'medium cinematic pan',
      transition: i === count - 1 ? 'fade out' : 'cut',
    };
  });
  return {
    title: idea.length > 60 ? `${idea.slice(0, 57)}...` : idea,
    platform,
    tone,
    duration_seconds: duration,
    hook: hooks[0],
    script: scenes.map(s => s.narration).join(' '),
    scenes,
    provider: 'local-fallback',
  };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const idea = String(body.idea || '').trim();
  const duration = Math.min(120, Math.max(10, Number(body.duration || 30)));
  const platform = String(body.platform || 'YouTube Shorts');
  const tone = String(body.tone || 'cinematic');
  if (!idea) return NextResponse.json({ error: 'Ide video wajib diisi.' }, { status: 400 });

  let plan: any = null;
  const useGoogle = process.env.CONTENT_AI_PROVIDER === 'google' && !!process.env.GOOGLE_API_KEY;
  if (useGoogle) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! });
      const response = await ai.models.generateContent({
        model: process.env.CONTENT_AI_MODEL || 'gemini-2.5-flash',
        contents: `Anda adalah penulis naskah video profesional berbahasa Indonesia. Buat JSON valid saja untuk video ${duration} detik di ${platform}, tone ${tone}. Ide: ${idea}. Format JSON: {"title":string,"hook":string,"script":string,"scenes":[{"scene":number,"role":string,"duration_seconds":number,"narration":string,"visual_prompt":string,"camera":string,"transition":string}]}. Jumlah durasi scene harus mendekati ${duration} detik. Jangan menggunakan markdown.`,
      });
      const text = response.text?.trim() || '';
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      plan = JSON.parse(cleaned);
      plan.platform = platform; plan.tone = tone; plan.duration_seconds = duration; plan.provider = 'google-gemini';
    } catch {
      plan = null;
    }
  }
  if (!plan) plan = localPlan(idea, duration, platform, tone);

  const { data: project, error } = await supabase.from('kai_projects').insert({
    user_id: user.id,
    name: plan.title || idea,
    description: plan.script || idea,
    settings: { content_plan: plan },
  }).select('id,name,description,settings,created_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ project, plan });
}
