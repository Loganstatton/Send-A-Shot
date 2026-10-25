import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { aiCost, maxCallCost, CHECK_SYSTEM, CHECK_SYSTEM_LEAN, CheckSchema, checkUser, gradeCheck, readerSystem, readerUser, ReadSchema, type CheckResult, type Graded, type ReadResult } from '../ai-prompts';
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
/** AI_MONTHLY_BUDGET_USD may be 0 (no AI spending); only unset or invalid falls back to $5. */
const budget = () => {
  const v = process.env.AI_MONTHLY_BUDGET_USD;
  return v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 5;
};
// Calls in flight reserve their maximum cost, and ledger writes are serialised: two photos checked at once could
// otherwise both pass the budget check on the same spend, and one write could overwrite the other's cost.
let reserved = 0;
let ledgerLock: Promise<unknown> = Promise.resolve();
const withLedger = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = ledgerLock.then(fn, fn);
  ledgerLock = run.catch(() => {});
  return run;
};

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
function record(usd: number) {
  return withLedger(async () => {
    const s = await spent();
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${LEDGER}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ month: s.month, usd: Math.round((s.usd + usd) * 10000) / 10000 }));
    await fs.rename(tmp, LEDGER);
  });
}
export async function aiSpend() {
  const s = await spent();
  return { ...s, budgetUsd: budget(), enabled: aiEnabled(), model: MODEL };
}

type Answer<T> = { ok: true; value: T; usd: number } | { ok: false; reason: string };

async function ask<T>(
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
  schema: Parameters<typeof betaZodOutputFormat>[0],
  effort: 'low' | 'medium',
  maxTokens = 4000,
  capUsd?: number,
): Promise<Answer<T>> {
  if (!aiEnabled()) return { ok: false, reason: 'the AI is not set up (no ANTHROPIC_API_KEY)' };
  // reserve the call's maximum cost first: never start a call that could take spending past a limit
  const reserve = maxCallCost(system, content, maxTokens);
  if (capUsd !== undefined && reserve > capUsd) return { ok: false, reason: `this call could cost up to $${reserve.toFixed(3)}, more than the $${capUsd.toFixed(3)} allowed for it` };
  // check and reserve together, so concurrent calls see each other's reservations
  const refusal = await withLedger(async () => {
    const used = (await spent()).usd + reserved;
    if (used + reserve > budget()) return `this call could cost up to $${reserve.toFixed(3)}, which could take this month's AI spending past its $${budget()} budget ($${used.toFixed(2)} used or reserved)`;
    reserved += reserve;
    return null;
  });
  if (refusal) return { ok: false, reason: refusal };
  let released = false;
  const release = () => {
    if (!released) reserved = Math.max(0, reserved - reserve);
    released = true;
  };
  try {
    const res = await api().beta.messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    });
    const usd = aiCost(res.model || MODEL, res.usage);
    await record(usd);
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
    return { ok: true, value: res.parsed_output as T, usd };
  } catch (e) {
    const reason =
      e instanceof Anthropic.AuthenticationError ? 'the ANTHROPIC_API_KEY was rejected'
      : e instanceof Anthropic.RateLimitError ? 'the AI is rate limited'
      : e instanceof Anthropic.APIError ? `AI API error ${e.status}`
      : `AI request failed (${(e as Error).message})`;
    console.error(`AI: ${reason}`);
    return { ok: false, reason };
  } finally {
    release();
  }
}

/** The description read into prompt fields, packs and a pose preset (null = use the rule-based reader). */
export async function aiRead(
  description: string,
  reference: 'none' | 'pose' | 'edit' | 'edit+pose',
  adultAllowed: boolean,
  guides: readonly string[] = [],
  limits: { maxTokens?: number; capUsd?: number } = {},
): Promise<ReadResult | null> {
  const a = await ask<ReadResult>(readerSystem(adultAllowed, guides), [{ type: 'text', text: readerUser(description, reference) }], ReadSchema, 'low', limits.maxTokens ?? 4000, limits.capUsd);
  return a.ok ? a.value : null;
}

export type CheckOutcome = { status: 'pass' | 'fail'; graded: Graded; usd: number } | { status: 'unavailable'; reason: string };

/** Checker effort: medium unless SIENNA_AI_CHECK_EFFORT says low (cheaper; see the 22 Oct comparison). */
const checkEffort = (): 'low' | 'medium' => (process.env.SIENNA_AI_CHECK_EFFORT === 'low' ? 'low' : 'medium');

/**
 * The finished photo graded against each requirement of the request. Three outcomes: pass (nothing wrong or missing),
 * fail (with the misses and how to fix them), or unavailable with the reason — never a silent pass.
 */
export async function aiCheck(
  request: string,
  image: Buffer,
  mime: string,
  effort: 'low' | 'medium' = checkEffort(),
  lean = false,
  limits: { maxTokens?: number; capUsd?: number } = {},
  rules: readonly string[] = [],
): Promise<CheckOutcome> {
  const media = (['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? mime : 'image/png') as 'image/png' | 'image/jpeg' | 'image/webp';
  const a = await ask<CheckResult>(
    lean ? CHECK_SYSTEM_LEAN : CHECK_SYSTEM,
    [
      { type: 'image', source: { type: 'base64', media_type: media, data: image.toString('base64') } },
      { type: 'text', text: checkUser(request, rules) },
    ],
    CheckSchema,
    effort,
    // one entry per requirement: a long request needs room
    limits.maxTokens ?? 8000,
    limits.capUsd,
  );
  if (!a.ok) return { status: 'unavailable', reason: a.reason };
  const r = a.value;
  if (r.cannot_judge) return { status: 'unavailable', reason: `the AI could not judge it${r.cannot_judge_reason ? ` (${r.cannot_judge_reason})` : ''}` };
  if (!r.requirements.length) return { status: 'unavailable', reason: 'the AI listed no requirements to check' };
  const graded = gradeCheck(r);
  return { status: graded.status, graded, usd: a.usd };
}
