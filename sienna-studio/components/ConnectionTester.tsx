'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { Button, Notice, TextInput } from './ui';

interface TestResult {
  ok: boolean;
  backend: 'comfyui' | 'mock';
  comfyuiVersion?: string;
  devices: { name: string; type: string; vramTotal?: number; vramFree?: number }[];
  latencyMs: number;
}

/** URL field + Test + Save for the ComfyUI server. */
export function ConnectionTester({
  initialUrl,
  envUrl,
  onSaved,
}: {
  initialUrl: string;
  envUrl?: string;
  onSaved?: (url: string, ok: boolean) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setUrl(initialUrl), [initialUrl]);

  const effective = url.trim() || envUrl || 'mock';

  async function test() {
    setTesting(true);
    setResult(null);
    setError(null);
    try {
      setResult(await api<TestResult>('/api/comfy/test', { method: 'POST', json: { url: effective } }));
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const ok = await test();
      await api('/api/settings', { method: 'PUT', json: { comfyUrl: url.trim().replace(/\/+$/, '') } });
      onSaved?.(effective, ok);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <TextInput
        label="ComfyUI server URL"
        hint={envUrl ? `blank = env (${envUrl})` : 'or “mock” for offline test mode'}
        placeholder="https://your-comfyui-host:8188"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" onClick={() => setUrl('mock')}>
          Use mock mode
        </Button>
        <Button className="flex-1" loading={testing} onClick={test}>
          Test
        </Button>
        <Button variant="primary" className="flex-1" loading={saving} onClick={save}>
          Save
        </Button>
      </div>
      {result && (
        <Notice kind={result.backend === 'mock' ? 'warn' : 'ok'}>
          {result.backend === 'mock' ? (
            <>Mock mode: the app works end-to-end but makes placeholder images. Switch to a real ComfyUI URL when your GPU is ready.</>
          ) : (
            <>
              ✓ Connected to ComfyUI {result.comfyuiVersion ?? ''} in {result.latencyMs} ms
              {result.devices.map((d) => (
                <span key={d.name} className="block text-xs">
                  {d.name}
                  {d.vramTotal ? ` · ${(d.vramTotal / 1024 ** 3).toFixed(0)} GB VRAM` : ''}
                </span>
              ))}
            </>
          )}
        </Notice>
      )}
      {error && (
        <Notice kind="error">
          {error}
          <span className="mt-1 block text-xs opacity-80">
            The app server (not your phone) connects to this URL. Check the pod is running, port 8188 is exposed, and the URL has no
            trailing path.
          </span>
        </Notice>
      )}
    </div>
  );
}
