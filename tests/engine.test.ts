import { describe, expect, it } from 'vitest';
import { parseFormula, roll, rollD20, seeded } from '../src/engine/dice';
import { armorClass, createCharacter, hurt, levelUp, modifier, skillBonus, weaponAttack } from '../src/engine/character';
import { newCampaign } from '../src/engine/campaign';
import * as act from '../src/engine/actions';
import { CLASSES } from '../src/engine/content';

/** A generator that returns these d20 faces in order (for dice of other sizes too: face/sides). */
const faces = (...values: number[]) => {
  let i = 0;
  return () => (values[i++ % values.length] - 0.5) / 20;
};

describe('dice', () => {
  it('parses and rolls formulas within bounds', () => {
    expect(parseFormula('2d6+3')).toEqual([{ sign: 1, count: 2, sides: 6 }, { sign: 1, count: 3, sides: 0 }]);
    expect(parseFormula('d20')).toEqual([{ sign: 1, count: 1, sides: 20 }]);
    expect(parseFormula('1d8 - 1')).toHaveLength(2);
    expect(parseFormula('2d')).toBeNull();
    expect(parseFormula('rm -rf')).toBeNull();
    const rng = seeded(1);
    for (let i = 0; i < 200; i++) {
      const r = roll('2d6+3', rng)!;
      expect(r.total).toBeGreaterThanOrEqual(5);
      expect(r.total).toBeLessThanOrEqual(15);
    }
    // A critical hit doubles the dice, not the modifier.
    expect(roll('1d8+2', seeded(3), true)!.dice).toHaveLength(2);
  });

  it('keeps the higher die with advantage and the lower with disadvantage', () => {
    expect(rollD20('advantage', faces(4, 17)).kept).toBe(17);
    expect(rollD20('disadvantage', faces(4, 17)).kept).toBe(4);
  });
});

describe('characters', () => {
  it('builds every class from the standard array with sane numbers', () => {
    for (const def of CLASSES) {
      const c = createCharacter('Тест', def.id);
      expect(Object.values(c.abilities).sort((a, b) => b - a)).toEqual([15, 14, 13, 12, 10, 8]);
      expect(c.abilities[def.priority[0]]).toBe(15);
      expect(c.maxHp).toBe(def.hitDie + modifier(c.abilities.con));
      expect(armorClass(c)).toBeGreaterThanOrEqual(11);
      for (const w of c.weapons) expect(weaponAttack(c, w)).not.toBeNull();
    }
  });

  it('adds proficiency only to trained skills', () => {
    const c = createCharacter('Ноль', 'netrunner');
    expect(skillBonus(c, 'hacking')).toBe(modifier(15) + 2);
    expect(skillBonus(c, 'athletics')).toBe(modifier(8));
  });

  it('falls at 0 hit points and dies from massive damage', () => {
    const c = createCharacter('Хрупкий', 'netrunner');
    expect(hurt(c, c.hp - 1).fell).toBe(false);
    expect(hurt(c, 1)).toEqual({ fell: true, died: false });
    const d = createCharacter('Хрупкий', 'netrunner');
    expect(hurt(d, d.hp + d.maxHp).died).toBe(true);
  });

  it('levels up by the SRD experience table', () => {
    const c = createCharacter('Рост', 'solo');
    c.xp = 950;
    expect(levelUp(c)).toBe(2);
    expect(c.level).toBe(3);
  });
});

describe('actions', () => {
  it('a check reports the dice, the bonus and success against the DC', () => {
    const c = newCampaign(createCharacter('Ноль', 'netrunner'));
    const out = act.check(c, { skill: 'hacking', ability: 'int', dc: 15, advantage: 'none', reason: 'взломать дверь' }, faces(12));
    expect(out.result).toMatchObject({ roll: 12, bonus: 4, total: 16, success: true });
    expect(out.entries[0]).toMatchObject({ kind: 'roll', outcome: 'success' });
  });

  it('combat: initiative order, attacks change hit points, xp for a kill, turns skip the fallen', () => {
    const c = newCampaign(createCharacter('Рейн', 'solo'));
    const start = act.startCombat(c, { enemies: [{ kind: 'thug', name: null }, { kind: 'drone', name: 'Оса' }], surprise: false }, seeded(7));
    expect(start.error).toBeUndefined();
    expect(c.combat!.order).toHaveLength(3);
    const thug = c.combat!.enemies[0];
    thug.hp = 1;
    // A natural 20 always hits and kills the weakened thug.
    const hit = act.playerAttack(c, { weapon: 'rifle', target: thug.id, advantage: 'none' }, faces(20, 10, 10));
    expect(hit.result).toMatchObject({ hit: true, critical: true, target_down: true });
    expect(c.character.xp).toBe(25);
    // A natural 1 always misses.
    const drone = c.combat!.enemies[1];
    expect(act.playerAttack(c, { weapon: 'rifle', target: drone.id, advantage: 'none' }, faces(1)).result).toMatchObject({ hit: false, fumble: true });
    // The thug is out: turns go round between the player and the drone only.
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) seen.add((act.nextTurn(c).result as { turn_of: string }).turn_of);
    expect([...seen].sort()).toEqual([drone.id, 'player'].sort());
    expect(act.endCombat(c, { outcome: 'победа' }).error).toBeUndefined();
    expect(c.combat).toBeNull();
  });

  it('refuses impossible requests with an error the model can read', () => {
    const c = newCampaign(createCharacter('Рейн', 'solo'));
    expect(act.playerAttack(c, { weapon: 'rifle', target: 'thug-1', advantage: 'none' }, seeded(1)).error).toBe(true);
    expect(act.startCombat(c, { enemies: [{ kind: 'dragon', name: null }], surprise: false }, seeded(1)).error).toBe(true);
    expect(act.changeGear(c, { add: [], remove: [], credits: -1000, reason: 'покупка' }).error).toBe(true);
    expect(act.changeGear(c, { add: [], remove: ['Ракетница'], credits: 0, reason: 'потеря' }).error).toBe(true);
  });

  it('gear: weapons by id become usable, money changes', () => {
    const c = newCampaign(createCharacter('Рейн', 'solo'));
    act.changeGear(c, { add: ['shotgun', 'Кредитный чип'], remove: ['Аптечка'], credits: -50, reason: 'сделка' });
    expect(c.character.weapons).toContain('shotgun');
    expect(c.character.inventory).toContain('Кредитный чип');
    expect(c.character.inventory).not.toContain('Аптечка');
    expect(c.character.credits).toBe(100);
  });

  it('class features spend charges and come back with rest', () => {
    const c = newCampaign(createCharacter('Док', 'medtech'));
    c.character.hp = 1;
    for (let i = 0; i < 3; i++) expect(act.useFeature(c, { target: null }, seeded(i)).error).toBeUndefined();
    expect(act.useFeature(c, { target: null }, seeded(9)).error).toBe(true);
    act.takeRest(c, { kind: 'long' }, seeded(1));
    expect(c.character.featureUses).toBe(3);
    expect(c.character.hp).toBe(c.character.maxHp);
  });

  it('the face bonus die is added once to the next roll', () => {
    const c = newCampaign(createCharacter('Лис', 'face'));
    act.useFeature(c, { target: null }, seeded(1));
    expect(c.character.bonusDice).toBe('1d6');
    const out = act.check(c, { skill: 'persuasion', ability: 'cha', dc: 10, advantage: 'none', reason: 'уговорить' }, faces(10, 6));
    expect((out.result as { bonus: number }).bonus).toBeGreaterThan(4);
    expect(c.character.bonusDice).toBeNull();
  });
});
