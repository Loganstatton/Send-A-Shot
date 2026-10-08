import { authEnabled } from '@/lib/auth';
import { isMockUrl } from '@/lib/comfy/client';
import { settingsPatchSchema } from '@/lib/schemas';
import { handle, json, parseBody } from '@/lib/server/http';
import { adultContentAllowed, experimentsEnabled, getComfyUrl, getSettings, updateSettings } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

async function payload() {
  const [settings, effectiveUrl] = await Promise.all([getSettings(), getComfyUrl()]);
  return {
    settings,
    env: {
      adultContentAllowed: adultContentAllowed(),
      experiments: experimentsEnabled(),
      authEnabled: authEnabled(),
      envComfyUrl: process.env.COMFYUI_URL || '',
      hasApiKey: !!process.env.COMFYUI_API_KEY,
      effectiveComfyUrl: effectiveUrl,
      mock: isMockUrl(effectiveUrl),
    },
  };
}

export const GET = handle(async () => json(await payload()));

export const PUT = handle(async (req: Request) => {
  const patch = await parseBody(req, settingsPatchSchema);
  if (patch.contentMode === 'adult' && !adultContentAllowed()) patch.contentMode = 'sfw';
  await updateSettings(patch as any);
  return json(await payload());
});
