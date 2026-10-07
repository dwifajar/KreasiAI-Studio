import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { cleanupProductionRender, renderProductionVideo, type RenderScene } from '@/lib/render/production';

export const runtime = 'nodejs';
export const maxDuration = 300;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Production render gagal.';
}

function getAspectRatio(platform: string) {
  return ['YouTube Shorts', 'TikTok', 'Instagram Reels'].includes(platform) ? '9:16' as const : '16:9' as const;
}

async function getVoiceFiles(admin: ReturnType<typeof createAdminClient>, userId: string, projectId: string, scenes: RenderScene[], enabled: boolean) {
  if (!enabled) return new Map<number, string>();
  const assetIds = scenes.map(s => s.voice_asset_id).filter(Boolean) as string[];
  const result = new Map<number, string>();
  if (!assetIds.length) return result;
  const { data: assets, error } = await admin.from('kai_assets').select('id,storage_path').in('id', assetIds).eq('project_id', projectId).eq('user_id', userId);
  if (error) throw new Error(`Voice asset lookup: ${error.message}`);
  for (const scene of scenes) {
    if (!scene.voice_asset_id) continue;
    const asset = assets?.find(a => a.id === scene.voice_asset_id);
    if (!asset?.storage_path) continue;
    const signed = await admin.storage.from('kai-media').createSignedUrl(asset.storage_path, 60 * 60);
    if (signed.error || !signed.data?.signedUrl) continue;
    const response = await fetch(signed.data.signedUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Voice scene ${scene.scene}: gagal mengambil audio (${response.status}).`);
    const tmp = `${os.tmpdir()}/kreasiai-voice-${crypto.randomUUID()}.mp3`;
    await fs.writeFile(tmp, Buffer.from(await response.arrayBuffer()));
    result.set(Number(scene.scene), tmp);
  }
  return result;
}

async function getSceneVideoFiles(admin: ReturnType<typeof createAdminClient>, userId: string, projectId: string, scenes: RenderScene[], enabled: boolean) {
  const result = new Map<number, string>();
  if (!enabled) return result;
  const assetIds = scenes.map(s => (s as any).video_asset_id).filter(Boolean) as string[];
  if (!assetIds.length) return result;
  const { data: assets, error } = await admin.from('kai_assets').select('id,storage_path').in('id', assetIds).eq('project_id', projectId).eq('user_id', userId);
  if (error) throw new Error(`Video asset lookup: ${error.message}`);
  for (const scene of scenes) {
    const assetId = (scene as any).video_asset_id as string | undefined;
    if (!assetId) continue;
    const asset = assets?.find(a => a.id === assetId);
    if (!asset?.storage_path) continue;
    const signed = await admin.storage.from('kai-media').createSignedUrl(asset.storage_path, 60 * 60);
    if (signed.error || !signed.data?.signedUrl) continue;
    const response = await fetch(signed.data.signedUrl, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error(`Video scene ${scene.scene}: gagal mengambil video (${response.status}).`);
    const tmp = `${os.tmpdir()}/kreasiai-video-${crypto.randomUUID()}.mp4`;
    await fs.writeFile(tmp, Buffer.from(await response.arrayBuffer()));
    result.set(Number(scene.scene), tmp);
  }
  return result;
}

async function getMusicFile(admin: ReturnType<typeof createAdminClient>, userId: string, projectId: string, assetId: string | null) {
  if (!assetId) return null;
  const { data: asset, error } = await admin.from('kai_assets').select('id,storage_path').eq('id', assetId).eq('project_id', projectId).eq('user_id', userId).single();
  if (error || !asset?.storage_path) throw new Error(`Music asset lookup: ${error?.message || 'Asset musik tidak ditemukan.'}`);
  const signed = await admin.storage.from('kai-media').createSignedUrl(asset.storage_path, 60 * 60);
  if (signed.error || !signed.data?.signedUrl) throw new Error(`Music signed URL: ${signed.error?.message || 'URL musik tidak tersedia.'}`);
  const response = await fetch(signed.data.signedUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Music download gagal (${response.status}).`);
  const ext = String(asset.storage_path.split('.').pop() || 'audio').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'audio';
  const tmp = `${os.tmpdir()}/kreasiai-music-${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(tmp, Buffer.from(await response.arrayBuffer()));
  return tmp;
}

export async function POST(req: Request) {
  const createdFiles: string[] = [];
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const projectId = String(body.projectId || '');
    const resolution = String(body.resolution || '1080p') as '720p' | '1080p' | '4K';
    const fps = Number(body.fps || 30) as 24 | 30 | 60;
    const includeVoice = body.includeVoice !== false;
    const burnSubtitles = body.burnSubtitles !== false;
    const useSceneVideos = body.useSceneVideos !== false;
    const useSceneAudio = body.useSceneAudio !== false;
    if (!projectId) return NextResponse.json({ error: 'Project wajib diisi.' }, { status: 400 });
    if (!['720p', '1080p', '4K'].includes(resolution)) return NextResponse.json({ error: 'Resolusi tidak valid.' }, { status: 400 });
    if (![24, 30, 60].includes(fps)) return NextResponse.json({ error: 'FPS tidak valid.' }, { status: 400 });

    const admin = createAdminClient();
    const { data: project, error: projectError } = await admin.from('kai_projects').select('id,settings').eq('id', projectId).eq('user_id', user.id).single();
    if (projectError || !project) return NextResponse.json({ error: 'Project tidak ditemukan.' }, { status: 404 });
    const plan = (project.settings as any)?.content_plan;
    const scenes = Array.isArray(plan?.scenes) ? plan.scenes as RenderScene[] : [];
    if (!scenes.length) return NextResponse.json({ error: 'Project belum memiliki scene.' }, { status: 400 });
    const editor = (plan?.editor || {}) as any;
    const musicAssetId = editor?.music?.assetId ? String(editor.music.assetId) : null;

    const voiceFiles = await getVoiceFiles(admin, user.id, projectId, scenes, includeVoice);
    for (const p of voiceFiles.values()) createdFiles.push(p);
    const videoFiles = await getSceneVideoFiles(admin, user.id, projectId, scenes, useSceneVideos);
    for (const p of videoFiles.values()) createdFiles.push(p);
    const musicFile = await getMusicFile(admin, user.id, projectId, musicAssetId);
    if (musicFile) createdFiles.push(musicFile);

    const result = await renderProductionVideo(scenes, {
      resolution,
      fps,
      aspectRatio: getAspectRatio(String(plan.platform || 'YouTube')),
      includeVoice,
      burnSubtitles,
      useSceneVideos,
      useSceneAudio,
      editor,
    }, voiceFiles, videoFiles, musicFile || undefined);
    createdFiles.push(result.outputPath, result.subtitlePath);

    const videoBuffer = await fs.readFile(result.outputPath);
    const base = crypto.randomUUID();
    const videoPath = `${user.id}/projects/${projectId}/renders/production-${base}.mp4`;
    const videoUpload = await admin.storage.from('kai-media').upload(videoPath, videoBuffer, { contentType: 'video/mp4', upsert: true });
    if (videoUpload.error) throw new Error(`Storage video upload: ${videoUpload.error.message}`);
    const videoSigned = await admin.storage.from('kai-media').createSignedUrl(videoPath, 60 * 60 * 24 * 30);
    if (videoSigned.error || !videoSigned.data?.signedUrl) throw new Error(`Video signed URL: ${videoSigned.error?.message || 'URL tidak tersedia'}`);

    let subtitleAssetId: string | null = null;
    if (burnSubtitles) {
      const subtitleBuffer = await fs.readFile(result.subtitlePath);
      const subtitlePath = `${user.id}/projects/${projectId}/subtitles/production-${base}.srt`;
      const subtitleUpload = await admin.storage.from('kai-media').upload(subtitlePath, subtitleBuffer, { contentType: 'application/x-subrip', upsert: true });
      if (!subtitleUpload.error) {
        const subtitleAsset = await admin.from('kai_assets').insert({
          user_id: user.id, project_id: projectId, kind: 'subtitle', storage_path: subtitlePath, mime_type: 'application/x-subrip',
          metadata: { provider: 'ffmpeg', format: 'srt', resolution, fps, source: 'production-render' },
        }).select().single();
        if (!subtitleAsset.error && subtitleAsset.data) subtitleAssetId = subtitleAsset.data.id;
      }
    }

    const videoAsset = await admin.from('kai_assets').insert({
      user_id: user.id, project_id: projectId, kind: 'video', storage_path: videoPath, mime_type: 'video/mp4',
      metadata: { provider: 'ffmpeg-local', resolution, fps, aspect_ratio: getAspectRatio(String(plan.platform || 'YouTube')), duration_seconds: result.durationSeconds, scene_count: result.sceneCount, scene_videos_used: videoFiles.size, scene_audio_used: useSceneAudio, music_asset_id: musicAssetId, editor_applied: true, subtitle_asset_id: subtitleAssetId },
    }).select().single();
    if (videoAsset.error || !videoAsset.data) throw new Error(`Asset database: ${videoAsset.error?.message || 'Asset tidak tersimpan'}`);

    const job = await admin.from('kai_generation_jobs').insert({
      user_id: user.id, project_id: projectId, type: 'render', provider: 'ffmpeg-local', prompt: 'Production MP4 render', status: 'completed',
      output_url: videoSigned.data.signedUrl, output_asset_id: videoAsset.data.id, credits_reserved: 0,
      settings: { resolution, fps, aspectRatio: getAspectRatio(String(plan.platform || 'YouTube')), includeVoice, burnSubtitles, useSceneVideos, useSceneAudio, musicAssetId, editorApplied: true, sceneVideosUsed: videoFiles.size, subtitleAssetId },
      started_at: new Date().toISOString(), completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).select().single();
    if (job.error) throw new Error(`Render job database: ${job.error.message}`);

    const settings = { ...(project.settings || {}) } as any;
    const contentPlan = { ...(settings.content_plan || {}) } as any;
    contentPlan.production_render = {
      asset_id: videoAsset.data.id,
      job_id: job.data?.id || null,
      url: videoSigned.data.signedUrl,
      storage_path: videoPath,
      resolution,
      fps,
      duration_seconds: result.durationSeconds,
      subtitle_asset_id: subtitleAssetId,
      provider: 'ffmpeg-local',
      scene_videos_used: videoFiles.size,
      scene_audio_used: useSceneAudio,
      music_asset_id: musicAssetId,
      editor_applied: true,
      created_at: new Date().toISOString(),
    };
    settings.content_plan = contentPlan;
    const update = await admin.from('kai_projects').update({ settings, updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', user.id);
    if (update.error) throw new Error(`Project update: ${update.error.message}`);

    return NextResponse.json({ ok: true, url: videoSigned.data.signedUrl, assetId: videoAsset.data.id, jobId: job.data?.id || null, subtitleAssetId, format: 'mp4', resolution, fps, durationSeconds: result.durationSeconds });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  } finally {
    await Promise.all(createdFiles.map(p => fs.rm(p, { force: true }).catch(() => undefined)));
    const output = createdFiles.find(p => p.endsWith('.mp4'));
    if (output) await cleanupProductionRender(output);
  }
}
