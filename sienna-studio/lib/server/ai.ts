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

type Answer<T> = { ok: true; value: T } | { ok: false; reason: string };

async function ask<T>(
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
  schema: Parameters<typeof betaZodOutputFormat>[0],
  effort: 'low' | 'medium',
): Promise<Answer<T>> {
  if (!aiEnabled()) return { ok: false, reason: 'the AI is not set up (no ANTHROPIC_API_KEY)' };
  if ((await spent()).usd >= budget()) return { ok: false, reason: `this month's AI budget ($${budget()}) is used up` };
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
    if (res.stop_reason === 'refusal') {
      const why = res.stop_details?.category ? ` (${res.stop_details.category})` : '';
      console.warn(`AI: declined${why}`);
      return { ok: false, reason: `the AI declined to assess it${why}` };
    }
    if (res.stop_reason === 'max_tokens') {
      console.warn('AI: answer cut off');
      return { ok: false, reason: 'the AI answer was cut off' };
    }
    // an empty or malformed answer is never a pass
    if (!res.parsed_output) {
      console.warn('AI: answer did not match the expected shape');
      return { ok: false, reason: 'the AI gave no usable answer' };
    }
    return { ok: true, value: res.parsed_output as T };
  } catch (e) {
    const reason =
      e instanceof Anthropic.AuthenticationError ? 'the ANTHROPIC_API_KEY was rejected'
      : e instanceof Anthropic.RateLimitError ? 'the AI is rate limited'
      : e instanceof Anthropic.APIError ? `AI API error ${e.status}`
      : `AI request failed (${(e as Error).message})`;
    console.error(`AI: ${reason}`);
    return { ok: false, reason };
  }
}

/** The description read into prompt fields, packs and a pose preset (null = use the rule-based reader). */
export async function aiRead(description: string, reference: 'none' | 'pose' | 'edit' | 'edit+pose', adultAllowed: boolean, guides: readonly string[] = []): Promise<ReadResult | null> {
  const a = await ask<ReadResult>(readerSystem(adultAllowed, guides), [{ type: 'text', text: readerUser(description, reference) }], ReadSchema, 'low');
  return a.ok ? a.value : null;
}

export type CheckOutcome = { status: 'pass' | 'fail'; result: CheckResult } | { status: 'unavailable'; reason: string };

/**
 * The finished photo compared with the request. Three outcomes: pass, fail (with what's wrong and how to fix it), or
 * unavailable with the reason — never a silent pass.
 */
export async function aiCheck(request: string, image: Buffer, mime: string): Promise<CheckOutcome> {
  const media = (['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? mime : 'image/png') as 'image/png' | 'image/jpeg' | 'image/webp';
  const a = await ask<CheckResult>(
    CHECK_SYSTEM,
    [
      { type: 'image', source: { type: 'base64', media_type: media, data: image.toString('base64') } },
      { type: 'text', text: checkUser(request) },
    ],
    CheckSchema,
    'medium',
  );
  if (!a.ok) return { status: 'unavailable', reason: a.reason };
  const r = a.value;
  if (r.verdict === 'cannot_judge') return { status: 'unavailable', reason: `the AI could not judge it${r.cannot_judge_reason ? ` (${r.cannot_judge_reason})` : ''}` };
  // a "pass" that lists a major issue is a fail
  return { status: r.verdict === 'pass' && !r.issues.some((i) => i.major) ? 'pass' : 'fail', result: r };
}
