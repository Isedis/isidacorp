import { describe, expect, it } from 'vitest';
import type { BetaContentBlock, BetaMessage, BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { createCharacter } from '../src/engine/character';
import { newCampaign } from '../src/engine/campaign';
import { seeded } from '../src/engine/dice';
import { RefusedError, keptContent, playTurn, requestFor, type GmClient } from '../src/gm/session';
import { API_TOOLS, runTool, validate } from '../src/gm/tools';
import { splitChoices, stateBlock } from '../src/gm/prompt';

const message = (content: unknown[], stop: BetaMessage['stop_reason']): BetaMessage =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 50 } }) as unknown as BetaMessage;

/** A fake API that answers each request with the next scripted message and records what it was sent. */
function fake(script: BetaMessage[]) {
  const sent: BetaMessageStreamParams[] = [];
  const client: GmClient = {
    beta: {
      messages: {
        stream(params) {
          sent.push(structuredClone(params));
          const next = script.shift();
          return {
            on(_e, listener) {
              for (const b of next?.content ?? []) if (b.type === 'text') listener(b.text);
            },
            finalMessage: () => (next ? Promise.resolve(next) : Promise.reject(new Error('network down'))),
          };
        },
      },
    },
  };
  return { client, sent };
}

const settings = { model: 'claude-opus-5-5' as const, effort: 'medium' as const };

describe('a turn of play', () => {
  it('runs the model’s tool calls through the engine and returns the results in one message', async () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    const { client, sent } = fake([
      message([
        { type: 'text', text: 'Дверь склада заперта.' },
        { type: 'tool_use', id: 't1', name: 'ability_check', input: { skill: 'hacking', ability: 'int', dc: 12, advantage: 'none', reason: 'вскрыть замок' } },
        { type: 'tool_use', id: 't2', name: 'remember', input: { fact: 'Склад 9 принадлежит банде «Шрамы»', location: 'Ржавые доки, склад 9' } },
      ], 'tool_use'),
      message([{ type: 'text', text: 'Замок щёлкает.\n▸ Войти\n▸ Осмотреться' }], 'end_turn'),
    ]);
    const streamed: string[] = [];
    await playTurn(client, c, 'Взламываю дверь', settings, seeded(2), { onText: (d) => streamed.push(d) });

    expect(sent).toHaveLength(2);
    const results = c.messages[2];
    expect(results.role).toBe('user');
    expect((results.content as { type: string }[]).map((b) => b.type)).toEqual(['tool_result', 'tool_result']);
    expect(c.location).toBe('Ржавые доки, склад 9');
    expect(c.facts).toContain('Склад 9 принадлежит банде «Шрамы»');
    expect(c.feed.map((e) => e.kind)).toEqual(['player', 'gm', 'roll', 'gm']);
    expect(c.feed[3]).toMatchObject({ text: 'Замок щёлкает.', choices: ['Войти', 'Осмотреться'] });
    expect(streamed.join('')).toContain('Дверь склада');
    expect(c.usage.dollars).toBeGreaterThan(0);
  });

  it('keeps the conversation append-only: each request extends the previous one', async () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    const { client, sent } = fake([
      message([{ type: 'text', text: 'Начало.' }], 'end_turn'),
      message([{ type: 'text', text: 'Дальше.' }], 'end_turn'),
    ]);
    await playTurn(client, c, null, settings, seeded(1));
    await playTurn(client, c, 'Иду', settings, seeded(1));
    const [a, b] = sent;
    expect(b.messages.slice(0, a.messages.length)).toEqual(a.messages);
    expect(b.system).toEqual(a.system);
    expect(b.tools).toEqual(a.tools);
  });

  it('puts the campaign back exactly as it was when the request fails or is refused', async () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    const before = JSON.stringify(c);
    await expect(playTurn(fake([]).client, c, 'Привет', settings, seeded(1))).rejects.toThrow('network down');
    expect(JSON.stringify(c)).toBe(before);
    const refused = fake([
      message([{ type: 'tool_use', id: 't1', name: 'change_gear', input: { add: ['Золото'], remove: [], credits: 500, reason: 'находка' } }], 'tool_use'),
      message([], 'refusal'),
    ]);
    await expect(playTurn(refused.client, c, 'Беру', settings, seeded(1))).rejects.toBeInstanceOf(RefusedError);
    expect(JSON.stringify(c)).toBe(before);
  });

  it('bad tool input comes back to the model as an error instead of changing anything', async () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    const out = runTool(c, 'change_gear', { add: ['x'], credits: 'много' }, seeded(1));
    expect(out.error).toBe(true);
    expect(c.character.credits).toBe(150);
    expect(runTool(c, 'nuke_city', {}, seeded(1)).error).toBe(true);
  });

  it('after a mid-output fallback, the declined model’s thinking and tool calls are dropped', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'a' },
      { type: 'text', text: 'Начало' },
      { type: 'tool_use', id: 'x', name: 'roll_dice', input: {} },
      { type: 'fallback', from: {}, to: {} },
      { type: 'thinking', thinking: '', signature: 'b' },
      { type: 'text', text: 'Продолжение' },
    ] as unknown as BetaContentBlock[];
    expect(keptContent(content).map((b) => b.type)).toEqual(['text', 'fallback', 'thinking', 'text']);
  });
});

describe('prompt and tools', () => {
  it('every tool schema is strict: all properties required, nothing extra', () => {
    for (const t of API_TOOLS) {
      const s = t.input_schema as unknown as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
      expect(s.additionalProperties).toBe(false);
      expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
      expect(t.strict).toBe(true);
    }
  });

  it('validates enums and nested objects', () => {
    const schema = API_TOOLS.find((t) => t.name === 'start_combat')!.input_schema as never;
    expect(validate(schema, { enemies: [{ kind: 'thug', name: '' }], surprise: false })).toBeNull();
    expect(validate(schema, { enemies: [{ kind: 'dragon', name: '' }], surprise: false })).toContain('kind');
    expect(validate(schema, { enemies: [], surprise: false, extra: 1 })).toContain('extra');
  });

  it('the request turns on caching, compaction and the refusal fallback (not for Haiku)', () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    const r = requestFor(c, settings);
    expect(r.cache_control).toEqual({ type: 'ephemeral' });
    expect(r.betas).toContain('compact-2026-01-12');
    expect(r.fallbacks).toBe('default');
    expect(r.thinking).toEqual({ type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
    expect(r.betas).toContain('thinking-binding-controls-2026-08-01');
    const h = requestFor(c, { model: 'claude-haiku-5-5', effort: 'low' });
    expect(h.fallbacks).toBeUndefined();
    expect(h.betas).not.toContain('server-side-fallback-2026-07-01');
  });

  it('the state block names what the model needs and the choices are split off', () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    const s = stateBlock(c);
    for (const part of ['Хиты', 'КД', 'Взлом [hacking]', '[pistol]', 'Перегрузка', 'Место']) expect(s).toContain(part);
    expect(splitChoices('Текст.\n\n▸ Раз\n▸ Два\n')).toEqual({ story: 'Текст.', choices: ['Раз', 'Два'] });
    expect(splitChoices('Без вариантов.')).toEqual({ story: 'Без вариантов.', choices: [] });
  });
});
