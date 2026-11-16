/**
 * A turn played through claude.ai's `sample` capability: the page asks Claude on the player's
 * own account, offering the engine's actions as page tools. Claude remembers nothing between
 * calls, so every call carries the rules, a summary of the past, recent exchanges and the state.
 */
import type { Campaign, Entry } from '../engine/campaign';
import type { Rng } from '../engine/dice';
import { SYSTEM, playerMessage, splitChoices, startMessage } from './prompt';
import { TOOL_LIST, runTool } from './tools';

/** The slice of `claude.use("sample")` a turn needs. */
export interface SampleTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; [key: string]: unknown };
  execute(input: Record<string, unknown>): unknown;
}
export interface SampleOptions {
  onText?: (u: { text: string; delta: string }) => void;
  signal?: AbortSignal;
  tools?: SampleTool[];
  modelTier?: 'quick' | 'default' | 'complex';
  cache?: boolean;
}
export type SampleTurn = { role: 'user' | 'assistant'; content: string };
export type SampleFn = (input: string | SampleTurn[], options?: SampleOptions) => Promise<{ text: string; truncated: boolean }>;
/** What `sample` rejects with. */
export interface SampleError {
  code: string;
  message: string;
  text?: string;
}
export const isSampleError = (e: unknown): e is SampleError => typeof e === 'object' && e !== null && typeof (e as SampleError).code === 'string';

/** Exchanges kept word for word; older ones are folded into the summary. */
export const KEEP_EXCHANGES = 14;
const FOLD = 8;
const CLIP = 2400;

const clip = (s: string, n = CLIP) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function buildInput(c: Campaign, playerText: string | null): SampleTurn[] {
  const rules = c.summary ? `${SYSTEM}\n\n[ЧТО БЫЛО РАНЬШЕ]\n${c.summary}` : SYSTEM;
  const turns: SampleTurn[] = [{ role: 'user', content: rules }];
  for (const t of c.transcript) {
    turns.push({ role: 'user', content: `[ИГРОК]\n${t.player}` });
    if (t.gm.trim()) turns.push({ role: 'assistant', content: t.gm });
  }
  turns.push({ role: 'user', content: playerText === null ? startMessage(c) : playerMessage(c, playerText) });
  return turns;
}

const rollLine = (e: Entry) => (e.kind === 'roll' ? `[${e.title}: ${e.detail}]` : e.kind === 'system' ? `[${e.text}]` : '');

export interface SampleHooks {
  onText?: (delta: string) => void;
  onEntry?: (entry: Entry) => void;
  signal?: AbortSignal;
}

/** Plays one turn; on any failure the campaign is put back as it was. */
export async function playTurnSample(sample: SampleFn, c: Campaign, playerText: string | null, rng: Rng, hooks: SampleHooks = {}): Promise<void> {
  const before = structuredClone(c);
  const turnEntries: Entry[] = [];
  const entry = (e: Entry) => {
    c.feed.push(e);
    turnEntries.push(e);
    hooks.onEntry?.(e);
  };
  let full = '';
  let flushed = 0;
  /** Narration written so far becomes a feed entry before the dice it led to. */
  const flush = (final: boolean) => {
    const segment = full.slice(flushed).trim();
    flushed = full.length;
    if (!segment) return;
    const { story, choices } = final ? splitChoices(segment) : { story: segment, choices: [] };
    if (story || choices.length) entry({ kind: 'gm', text: story, choices });
  };
  try {
    const input = buildInput(c, playerText);
    if (playerText !== null) entry({ kind: 'player', text: playerText });
    const tools: SampleTool[] = TOOL_LIST.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.schema as SampleTool['inputSchema'],
      execute: (args) => {
        flush(false);
        const out = runTool(c, t.name, args, rng);
        out.entries.forEach(entry);
        if (out.error) throw new Error(String((out.result as { error?: unknown }).error ?? 'ошибка'));
        return out.result;
      },
    }));
    const result = await sample(input, {
      tools,
      modelTier: 'complex',
      signal: hooks.signal,
      onText: ({ text, delta }) => {
        full = text;
        hooks.onText?.(delta);
      },
    });
    full = result.text;
    flush(true);
    const gm = turnEntries.map((e) => (e.kind === 'gm' ? e.text + (e.choices.length ? `\n${e.choices.map((x) => `▸ ${x}`).join('\n')}` : '') : rollLine(e))).filter(Boolean).join('\n\n');
    c.transcript.push({ player: clip(playerText ?? '[СТАРТ]', 800), gm: clip(gm) });
  } catch (err) {
    for (const key of Object.keys(c) as (keyof Campaign)[]) delete (c as Partial<Campaign>)[key];
    Object.assign(c, before);
    throw err;
  }
}

/**
 * Folds the oldest exchanges into the summary once there are too many to send each turn.
 * Returns whether the campaign changed; a failure leaves everything for the next try.
 */
export async function foldTranscript(sample: SampleFn, c: Campaign): Promise<boolean> {
  if (c.transcript.length <= KEEP_EXCHANGES) return false;
  const old = c.transcript.slice(0, FOLD);
  const prompt = `Ты ведёшь летопись текстовой ролевой кампании. Обнови краткое изложение прошлых событий, добавив к нему новые сцены.
Сохрани: имена, роли и отношение NPC; места; задания и их ход; долги, обещания, врагов и союзников персонажа; важные решения игрока и их последствия. Механику (хиты, деньги, предметы) не пересказывай.
Пиши по-русски, сжато, в прошедшем времени, не длиннее 2500 знаков. Ответь только самим изложением.

[ИЗЛОЖЕНИЕ ДО СИХ ПОР]
${c.summary || '(начало кампании)'}

[НОВЫЕ СЦЕНЫ]
${old.map((t) => `Игрок: ${t.player}\nМастер: ${t.gm}`).join('\n\n')}`;
  try {
    const { text } = await sample(prompt, { modelTier: 'default', cache: false });
    if (!text.trim()) return false;
    c.summary = clip(text.trim(), 3500);
    c.transcript.splice(0, FOLD);
    return true;
  } catch {
    return false;
  }
}
