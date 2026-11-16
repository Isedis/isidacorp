import { describe, expect, it } from 'vitest';
import { createCharacter } from '../src/engine/character';
import { newCampaign } from '../src/engine/campaign';
import { seeded } from '../src/engine/dice';
import * as act from '../src/engine/actions';
import { KEEP_EXCHANGES, buildInput, foldTranscript, playTurnSample, type SampleFn, type SampleOptions } from '../src/gm/sampleSession';

/** A stand-in for claude.ai's `sample`: streams text, calls the page tools it is told to, answers. */
function fakeSample(script: (opts: SampleOptions, say: (t: string) => void) => unknown) {
  const calls: { input: unknown; opts: SampleOptions }[] = [];
  const fn: SampleFn = async (input, opts = {}) => {
    calls.push({ input, opts });
    let text = '';
    const say = (t: string) => {
      text += t;
      opts.onText?.({ text, delta: t });
    };
    await script(opts, say);
    return { text, truncated: false };
  };
  return { fn, calls };
}

describe('a turn through claude.ai', () => {
  it('runs the page tools through the engine and puts the dice between the narration', async () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    const { fn, calls } = fakeSample((opts, say) => {
      say('Замок мигает красным.');
      const check = opts.tools!.find((t) => t.name === 'ability_check')!;
      check.execute({ skill: 'hacking', ability: 'int', dc: 12, advantage: 'none', reason: 'вскрыть замок' });
      say('\n\nДверь уходит в стену.\n▸ Войти\n▸ Осмотреться');
    });
    await playTurnSample(fn, c, 'Ломаю замок', seeded(3));
    expect(c.feed.map((e) => e.kind)).toEqual(['player', 'gm', 'roll', 'gm']);
    expect(c.feed[3]).toMatchObject({ text: 'Дверь уходит в стену.', choices: ['Войти', 'Осмотреться'] });
    expect(calls[0].opts.modelTier).toBe('complex');
    // The transcript keeps the dice for the next call, which remembers nothing.
    expect(c.transcript).toHaveLength(1);
    expect(c.transcript[0].gm).toContain('Взлом');
  });

  it('a tool error reaches Claude as a thrown error and changes nothing', async () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    let thrown = '';
    const { fn } = fakeSample((opts, say) => {
      try {
        opts.tools!.find((t) => t.name === 'change_gear')!.execute({ add: [], remove: [], credits: -9999, reason: 'покупка' });
      } catch (e) {
        thrown = (e as Error).message;
      }
      say('Денег не хватает.');
    });
    await playTurnSample(fn, c, 'Покупаю всё', seeded(1));
    expect(thrown).toContain('Не хватает денег');
    expect(c.character.credits).toBe(150);
  });

  it('a failed call puts everything back, tool effects included', async () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    const before = JSON.stringify(c);
    const fn: SampleFn = async (_input, opts) => {
      opts!.tools!.find((t) => t.name === 'change_gear')!.execute({ add: ['Золото'], remove: [], credits: 500, reason: 'находка' });
      throw { code: 'rate_limited', message: 'slow down' };
    };
    await expect(playTurnSample(fn, c, 'Беру', seeded(1))).rejects.toMatchObject({ code: 'rate_limited' });
    expect(JSON.stringify(c)).toBe(before);
  });

  it('every call starts with the rules and ends with the state and the player’s words', () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    c.summary = 'Ноль задолжал Маме Цзи.';
    c.transcript.push({ player: 'Иду в доки', gm: 'Доки воняют рыбой.' });
    const turns = buildInput(c, 'Ищу склад');
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toContain('ЧТО БЫЛО РАНЬШЕ');
    expect(turns[0].content).toContain('Маме Цзи');
    expect(turns.map((t) => t.role)).toEqual(['user', 'user', 'assistant', 'user']);
    expect(turns.at(-1)!.content).toContain('[СОСТОЯНИЕ]');
    expect(turns.at(-1)!.content).toContain('Ищу склад');
  });

  it('old exchanges fold into the summary once there are too many', async () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    for (let i = 0; i < KEEP_EXCHANGES + 1; i++) c.transcript.push({ player: `ход ${i}`, gm: `ответ ${i}` });
    const { fn, calls } = fakeSample((_o, say) => say('Ноль ходил по докам.'));
    expect(await foldTranscript(fn, c)).toBe(true);
    expect(c.summary).toBe('Ноль ходил по докам.');
    expect(c.transcript).toHaveLength(KEEP_EXCHANGES + 1 - 8);
    expect(String(calls[0].input)).toContain('ход 0');
    // Short transcripts are left alone, without a call.
    expect(await foldTranscript(fn, c)).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('combat turns', () => {
  it('pass on by themselves after an attack by whoever holds the turn', () => {
    const c = newCampaign(createCharacter('Рейн', 'solo'));
    act.startCombat(c, { enemies: [{ kind: 'thug', name: null }], surprise: false }, seeded(5));
    const combat = c.combat!;
    const first = combat.order[combat.turn].id;
    const thug = combat.enemies[0].id;
    const out = first === 'player'
      ? act.playerAttack(c, { weapon: 'rifle', target: thug, advantage: 'none' }, seeded(2))
      : act.enemyAttack(c, { enemy: thug, advantage: 'none' }, seeded(2));
    const next = (out.result as { next_turn: string | null }).next_turn;
    expect(next).not.toBe(first);
    expect(combat.order[combat.turn].id).toBe(next);
  });
});
