import { describe, expect, it } from 'vitest';
import { createCharacter } from '../src/engine/character';
import { newCampaign } from '../src/engine/campaign';
import { seeded } from '../src/engine/dice';
import { TOOL_LIST, runTool, validate } from '../src/gm/tools';
import { splitChoices, stateBlock } from '../src/gm/prompt';
import { revive } from '../src/storage';

describe('the master’s tools', () => {
  it('every schema is strict: all properties required, nothing extra', () => {
    for (const t of TOOL_LIST) {
      const s = t.schema as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
      expect(s.additionalProperties).toBe(false);
      expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
    }
  });

  it('validates enums and nested objects', () => {
    const schema = TOOL_LIST.find((t) => t.name === 'start_combat')!.schema;
    expect(validate(schema, { enemies: [{ kind: 'thug', name: '' }], surprise: false })).toBeNull();
    expect(validate(schema, { enemies: [{ kind: 'dragon', name: '' }], surprise: false })).toContain('kind');
    expect(validate(schema, { enemies: [], surprise: false, extra: 1 })).toContain('extra');
  });

  it('bad input comes back as an error instead of changing anything', () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    expect(runTool(c, 'change_gear', { add: ['x'], credits: 'много' }, seeded(1)).error).toBe(true);
    expect(c.character.credits).toBe(150);
    expect(runTool(c, 'nuke_city', {}, seeded(1)).error).toBe(true);
  });
});

describe('prompt and saves', () => {
  it('the state block names what the master needs and the choices are split off', () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    const s = stateBlock(c);
    for (const part of ['Хиты', 'КД', 'Взлом [hacking]', '[pistol]', 'Перегрузка', 'Место']) expect(s).toContain(part);
    expect(splitChoices('Текст.\n\n▸ Раз\n▸ Два\n')).toEqual({ story: 'Текст.', choices: ['Раз', 'Два'] });
    expect(splitChoices('Без вариантов.')).toEqual({ story: 'Без вариантов.', choices: [] });
  });

  it('an old save loads with the new fields and without the API ones', () => {
    const old = { ...newCampaign(createCharacter('Ноль', 'netrunner')), messages: [{ role: 'user', content: 'x' }], usage: { dollars: 1 } } as Record<string, unknown>;
    delete old.transcript;
    delete old.summary;
    const c = revive(JSON.parse(JSON.stringify(old)))!;
    expect(c.transcript).toEqual([]);
    expect(c.summary).toBe('');
    expect('messages' in c).toBe(false);
    expect('usage' in c).toBe(false);
    expect(revive({ version: 2 })).toBeNull();
  });
});
