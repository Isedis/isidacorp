/**
 * One turn of play: the player's words go to the model with the current state, the model
 * narrates and calls tools, the engine answers, until the turn is back with the player.
 */
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageStreamParams,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Campaign, Entry } from '../engine/campaign';
import type { Rng } from '../engine/dice';
import { API_TOOLS, runTool } from './tools';
import { SYSTEM, playerMessage, splitChoices, startMessage } from './prompt';

export type ModelId = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export type Effort = 'low' | 'medium' | 'high';

export const MODELS: { id: ModelId; name: string; note: string; price: { input: number; output: number; cacheRead: number } }[] = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', note: 'лучший рассказчик', price: { input: 4, output: 20, cacheRead: 0.2 } },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', note: 'вдвое дешевле', price: { input: 2, output: 10, cacheRead: 0.1 } },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', note: 'дёшево, но проще', price: { input: 0.1, output: 0.5, cacheRead: 0.01 } },
];

export interface Settings {
  model: ModelId;
  effort: Effort;
}

/** The part of the SDK client a turn uses, so tests can stand in for the API. */
export interface StreamLike {
  on(event: 'text', listener: (delta: string) => void): unknown;
  finalMessage(): Promise<BetaMessage>;
}
export interface GmClient {
  beta: { messages: { stream(params: BetaMessageStreamParams): StreamLike } };
}

export interface TurnHooks {
  /** The model's narration as it streams in. */
  onText?: (delta: string) => void;
  /** A new feed entry: a roll, a system note, a finished block of narration. */
  onEntry?: (entry: Entry) => void;
}

export class RefusedError extends Error {}
export class TruncatedError extends Error {}

/** A turn that keeps calling tools without handing back is cut off here. */
const MAX_STEPS = 16;

/** What the summary must keep when the server compacts a long campaign. */
const COMPACT_INSTRUCTIONS =
  'Это текстовая ролевая кампания. Сохрани: имена, роли и отношение всех NPC; места; задания и их ход; долги, обещания, враги и союзники персонажа; важные решения игрока и их последствия; текущую сцену подробно. Механику (хиты, предметы, деньги) не пересказывай — её присылает движок.';

export function requestFor(c: Campaign, s: Settings): BetaMessageStreamParams {
  // Server-side fallback on a refusal for the Opus and Sonnet models; Haiku has none.
  const fallback = s.model !== 'claude-haiku-5-5';
  return {
    model: s.model,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM }],
    tools: API_TOOLS,
    messages: c.messages,
    // Caches the whole growing conversation: each turn pays full price only for what is new.
    cache_control: { type: 'ephemeral' },
    // A game update can change the prompt or tools under an old campaign: thinking blocks made
    // before it are dropped instead of failing the request.
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    output_config: { effort: s.effort },
    // Long campaigns are summarised on the server; the history stays append-only on our side.
    context_management: { edits: [{ type: 'compact_20260112', instructions: COMPACT_INSTRUCTIONS }] },
    betas: ['compact-2026-01-12', 'thinking-binding-controls-2026-08-01', ...(fallback ? ['server-side-fallback-2026-07-01' as const] : [])],
    ...(fallback ? { fallbacks: 'default' as const } : {}),
  };
}

/**
 * After a mid-output fallback, the blocks before the last fallback marker that belong to the
 * declined model are not echoed back and its tool calls are not run.
 */
export function keptContent(content: BetaContentBlock[]): BetaContentBlock[] {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  if (boundary < 0) return content;
  const dropped = new Set(['thinking', 'redacted_thinking', 'tool_use']);
  const known = new Set(['text', 'fallback', 'compaction', 'server_tool_use', 'web_search_tool_result', 'web_fetch_tool_result']);
  return content.filter((b, i) => i >= boundary || (!dropped.has(b.type) && known.has(b.type)));
}

function addUsage(c: Campaign, m: BetaMessage, s: Settings): void {
  const price = MODELS.find((x) => x.id === s.model)!.price;
  const u = m.usage;
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  c.usage.input += input;
  c.usage.output += output;
  c.usage.cacheRead += read;
  c.usage.cacheWrite += write;
  c.usage.dollars += (input * price.input + write * price.input * 1.25 + read * price.cacheRead + output * price.output) / 1e6;
}

/**
 * Plays one turn. On any failure the campaign is put back exactly as it was before the turn,
 * so the player can simply try again.
 */
export async function playTurn(client: GmClient, c: Campaign, playerText: string | null, s: Settings, rng: Rng, hooks: TurnHooks = {}): Promise<void> {
  const before = structuredClone(c);
  const entry = (e: Entry) => {
    c.feed.push(e);
    hooks.onEntry?.(e);
  };
  try {
    const text = playerText === null ? startMessage(c) : playerMessage(c, playerText);
    if (playerText !== null) entry({ kind: 'player', text: playerText });
    c.messages.push({ role: 'user', content: [{ type: 'text', text }] });

    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = client.beta.messages.stream(requestFor(c, s));
      stream.on('text', (d) => hooks.onText?.(d));
      const message = await stream.finalMessage();
      addUsage(c, message, s);
      if (message.stop_reason === 'refusal') throw new RefusedError('refusal');

      const content = keptContent(message.content);
      const toolUses = content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
      if (message.stop_reason === 'max_tokens' && toolUses.length) throw new TruncatedError('max_tokens');

      c.messages.push({ role: 'assistant', content: content as BetaContentBlockParam[] });
      const narration = content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n\n').trim();
      if (narration) {
        const { story, choices } = splitChoices(narration);
        entry({ kind: 'gm', text: story, choices });
      }

      if (message.stop_reason === 'pause_turn') continue;
      if (toolUses.length === 0) return;

      // Every result goes back in one message, errors included, so parallel calls stay paired.
      const results: BetaToolResultBlockParam[] = toolUses.map((use) => {
        const out = runTool(c, use.name, use.input, rng);
        out.entries.forEach(entry);
        return { type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out.result), ...(out.error ? { is_error: true } : {}) };
      });
      c.messages.push({ role: 'user', content: results });
    }
    // Too many steps: the next player message continues from here.
    entry({ kind: 'system', text: 'Мастер задумался слишком надолго. Напиши, что делаешь дальше.' });
  } catch (err) {
    // Restore in place: the UI holds a reference to this object.
    for (const key of Object.keys(c) as (keyof Campaign)[]) delete (c as Partial<Campaign>)[key];
    Object.assign(c, before);
    throw err;
  }
}
