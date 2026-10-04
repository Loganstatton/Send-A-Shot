'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, useApi } from '@/lib/client/api';
import { DEFAULT_PARAMS } from '@/lib/defaults';
import type { AppSettings } from '@/lib/types';
import { ConnectionTester } from '@/components/ConnectionTester';
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, Slider, Toggle, toast } from '@/components/ui';

interface Payload {
  settings: AppSettings;
  env: { adultContentAllowed: boolean; authEnabled: boolean; envComfyUrl: string; hasApiKey: boolean; effectiveComfyUrl: string; mock: boolean };
}

export default function SettingsPage() {
  const { data, setData, reload } = useApi<Payload>('/api/settings');
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  if (!data) return null;
  const { settings, env } = data;

  async function patch(p: Partial<AppSettings>) {
    try {
      setData(await api<Payload>('/api/settings', { method: 'PUT', json: p }));
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  async function importFile(f: File | undefined) {
    if (!f) return;
    if (!confirm('Importing replaces your profile, presets, custom workflows and settings. Continue?')) return;
    setImporting(true);
    try {
      const bundle = JSON.parse(await f.text());
      const r = await api<{ workflows: number; presets: number }>('/api/import', { method: 'POST', json: bundle });
      toast(`Imported ${r.presets} presets, ${r.workflows} workflows`);
      reload();
    } catch (e: any) {
      toast(e instanceof SyntaxError ? 'Not a valid JSON file' : e.message, 'error');
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  return (
    <div className="pb-nav">
      <PageHeader title="Settings" />

      <SectionTitle right={<Badge tone={env.mock ? 'warn' : 'ok'}>{env.mock ? 'mock' : 'live'}</Badge>}>ComfyUI backend</SectionTitle>
      <Card className="space-y-3">
        <ConnectionTester initialUrl={settings.comfyUrl} envUrl={env.envComfyUrl} onSaved={() => reload()} />
        <p className="text-xs text-ink-400">
          Using: <span className="break-all text-ink-200">{env.effectiveComfyUrl}</span>
          {env.hasApiKey && ' · API key set via env'}
        </p>
        <Link href="/diagnostics">
          <Button variant="primary" className="w-full">
            Open diagnostics & first-generation test
          </Button>
        </Link>
      </Card>

      <SectionTitle>Generation defaults</SectionTitle>
      <Card className="space-y-4">
        <Toggle
          checked={settings.siennaLockDefault}
          onChange={(v) => patch({ siennaLockDefault: v })}
          label="Sienna Lock on by default"
          description="Applies on a new device / after clearing the draft."
        />
        <Toggle
          checked={settings.contentMode === 'adult'}
          disabled={!env.adultContentAllowed}
          onChange={(v) => patch({ contentMode: v ? 'adult' : 'sfw' })}
          label="Default to Adult 18+ mode"
          description={
            env.adultContentAllowed
              ? 'Only use if your model, LoRA and GPU provider permit adult content.'
              : 'Disabled by the server (ALLOW_ADULT_CONTENT is not “true”).'
          }
        />
        <Slider
          label="Default steps"
          value={settings.defaultParams.steps}
          min={4}
          max={80}
          step={1}
          onChange={(v) => patch({ defaultParams: { ...settings.defaultParams, steps: v } })}
        />
        <Slider
          label="Default CFG"
          value={settings.defaultParams.cfg}
          min={1}
          max={12}
          step={0.1}
          onChange={(v) => patch({ defaultParams: { ...settings.defaultParams, cfg: v } })}
        />
        <Slider
          label="Job timeout (seconds)"
          value={settings.generationTimeoutSec}
          min={60}
          max={3600}
          step={30}
          hint="cold GPUs can take minutes"
          onChange={(v) => patch({ generationTimeoutSec: v })}
        />
        <Button variant="ghost" className="w-full" onClick={() => patch({ defaultParams: DEFAULT_PARAMS })}>
          Reset generation defaults
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => {
            if (!confirm('Clear the Create screen draft on this device?')) return;
            try {
              localStorage.removeItem('sienna.draft.v1');
            } catch {}
            toast('Draft cleared');
          }}
        >
          Clear Create draft on this device
        </Button>
      </Card>

      <SectionTitle>Backup</SectionTitle>
      <Card className="space-y-3">
        <p className="text-xs text-ink-400">
          Export includes settings, Sienna profile + reference images, presets and custom workflows (not generated images).
        </p>
        <div className="grid grid-cols-2 gap-2">
          <a href="/api/export" download>
            <Button className="w-full">Export settings</Button>
          </a>
          <Button loading={importing} onClick={() => importRef.current?.click()}>
            Import settings
          </Button>
        </div>
        <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} />
      </Card>

      <SectionTitle>App</SectionTitle>
      <Card className="space-y-3">
        <Link href="/setup">
          <Button className="w-full">Run setup wizard again</Button>
        </Link>
        {env.authEnabled ? (
          <Button
            variant="ghost"
            className="w-full"
            onClick={async () => {
              await api('/api/auth/logout', { method: 'POST' });
              window.location.href = '/login';
            }}
          >
            Sign out
          </Button>
        ) : (
          <Notice kind="warn">No APP_PASSWORD set — anyone who can reach this server can use it. Set one before exposing it to the internet.</Notice>
        )}
        <p className="text-xs text-ink-400">
          Tip: in Safari tap Share → <b>Add to Home Screen</b> to run Sienna Studio full-screen like an app.
        </p>
      </Card>
    </div>
  );
}
