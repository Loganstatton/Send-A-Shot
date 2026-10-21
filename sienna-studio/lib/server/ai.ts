import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { aiCost, CHECK_SYSTEM, CheckSchema, checkUser, readerSystem, readerUser, ReadSchema, type CheckResult, type ReadResult } from '../ai-prompts';
import { DATA_DIR } from './store';

/**
 * Simple Mode's AI reader and checker (Claude). On only when ANTHROPIC_API_KEY is set; every failure — no key,
 * budget used up, refusal, network — returns null and the studio carries on with its rule-based reader and GPU
 * checks. Spend is capped per calendar month (AI_MONTHLY_BUDGET_USD, default $5).
 */
const MODEL = process.env.SIENNA_AI_MODEL || 'claude-opus-5-5';
const LEDGER = path.join(DATA_DIR, 'ai-spend.json');

export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.SIENNA_AI !== 'off';
}
const budget = () => Number(process.env.AI_MONTHLY_BUDGET_USD) || 5;

let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic({ timeout: 90_000, maxRetries: 1 }));

async function spent(): Promise<{ month: string; usd: number }> {
  const month = new Date().toISOString().slice(0, 7);
  try {
    const j = JSON.parse(await fs.readFile(LEDGER, 'utf8'));
    return j.month === month ? { month, usd: Number(j.usd) || 0 } : { month, usd: 0 };
  } catch {
    return { month, usd: 0 };
  }
}
async function record(usd: number) {
  const s = await spent();
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LEDGER, JSON.stringify({ month: s.month, usd: Math.round((s.usd + usd) * 10000) / 10000 }));
}
export async function aiSpend() {
  const s = await spent();
  return { ...s, budgetUsd: budget(), enabled: aiEnabled(), model: MODEL };
}

async function ask<T>(
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
  schema: Parameters<typeof betaZodOutputFormat>[0],
  effort: 'low' | 'medium',
): Promise<T | null> {
  if (!aiEnabled()) return null;
  if ((await spent()).usd >= budget()) return null;
  try {
    const res = await api().beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    });
    await record(aiCost(res.model || MODEL, res.usage));
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return null;
    return (res.parsed_output as T) ?? null;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.error('AI: ANTHROPIC_API_KEY was rejected');
    else if (e instanceof Anthropic.RateLimitError) console.error('AI: rate limited');
    else if (e instanceof Anthropic.APIError) console.error(`AI: API error ${e.status}: ${e.message}`);
    else console.error('AI:', (e as Error).message);
    return null;
  }
}

/** The description read into prompt fields, packs and a pose preset (null = use the rule-based reader). */
export function aiRead(description: string, reference: 'none' | 'pose' | 'edit' | 'edit+pose', adultAllowed: boolean): Promise<ReadResult | null> {
  return ask<ReadResult>(readerSystem(adultAllowed), [{ type: 'text', text: readerUser(description, reference) }], ReadSchema, 'low');
}

/** The finished photo compared with the request (null = no verdict). */
export function aiCheck(request: string, image: Buffer, mime: string): Promise<CheckResult | null> {
  const media = (['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? mime : 'image/png') as 'image/png' | 'image/jpeg' | 'image/webp';
  return ask<CheckResult>(
    CHECK_SYSTEM,
    [
      { type: 'image', source: { type: 'base64', media_type: media, data: image.toString('base64') } },
      { type: 'text', text: checkUser(request) },
    ],
    CheckSchema,
    'medium',
  );
}
