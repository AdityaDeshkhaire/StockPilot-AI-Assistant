// Single entry point for all LLM access. Posts to the serverless function in live
// mode, or returns canned mocks in mock mode. Every response is validated with zod;
// on failure the caller receives the rule-based fallback plus an error message.
import type { z } from 'zod';
import type { AgentKey } from './prompts';
import { DiscrepancyOutput, ExpeditingOutput, InsightsOutput, ProcurementOutput, ReplenishmentOutput } from './schemas';
import { mockDiscrepancy, mockExpediting, mockInsights, mockProcurement, mockReplenishment } from './mocks';
import type { DiscrepancyInput, ExpeditingInput, InsightsInput, ProcurementInput, ReplenishmentInput } from './inputs';

export type AgentMode = 'mock' | 'live';

export function getAgentMode(): AgentMode {
  try {
    const override = localStorage.getItem('agent_mode');
    if (override === 'live' || override === 'mock') return override;
  } catch {
    /* ignore */
  }
  return import.meta.env.VITE_AGENT_MODE === 'live' ? 'live' : 'mock';
}

export function setAgentMode(mode: AgentMode) {
  try {
    localStorage.setItem('agent_mode', mode);
  } catch {
    /* ignore */
  }
}

export interface AgentResult<T> {
  data: T;
  source: 'mock' | 'live' | 'fallback';
  error?: string;
}

/** Strip code fences and parse the first JSON object in a model reply. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object in agent reply');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callAgent<I, O>(agent: AgentKey, input: I, schema: z.ZodType<O>, fallback: (i: I) => O): Promise<AgentResult<O>> {
  if (getAgentMode() === 'mock') {
    await new Promise((r) => setTimeout(r, 350)); // feel like a real call
    return { data: schema.parse(fallback(input)), source: 'mock' };
  }
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, input }),
    });
    const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!res.ok) throw new Error(body.error ?? `Agent service returned HTTP ${res.status}`);
    const parsed = schema.safeParse(extractJson(body.text ?? ''));
    if (!parsed.success) throw new Error(`Agent JSON failed validation: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    return { data: parsed.data, source: 'live' };
  } catch (e) {
    return { data: fallback(input), source: 'fallback', error: e instanceof Error ? e.message : String(e) };
  }
}

export const agents = {
  replenishment: (i: ReplenishmentInput) => callAgent('replenishment', i, ReplenishmentOutput, mockReplenishment),
  procurement: (i: ProcurementInput) => callAgent('procurement', i, ProcurementOutput, mockProcurement),
  expediting: (i: ExpeditingInput) => callAgent('expediting', i, ExpeditingOutput, mockExpediting),
  discrepancy: (i: DiscrepancyInput) => callAgent('discrepancy', i, DiscrepancyOutput, mockDiscrepancy),
  insights: (i: InsightsInput) => callAgent('insights', i, InsightsOutput, mockInsights),
};
