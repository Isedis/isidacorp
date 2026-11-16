/**
 * Everything mechanical the game master can ask for. The model proposes, the engine rolls
 * and changes the state; each action returns what the model reads back and what the player sees.
 */
import { ENEMIES, SKILLS, WEAPONS, classById, type Ability, type Skill } from './content';
import { armorClass, cls, heal, hurt, levelUp, modifier, proficiency, rest, saveBonus, skillBonus, weaponAttack } from './character';
import { roll, rollD20, type Advantage, type Rng } from './dice';
import type { Campaign, Entry } from './campaign';
import { ABILITY_SHORT } from './content';

export interface Outcome {
  /** For the model: a short factual report. */
  result: Record<string, unknown>;
  /** For the feed. */
  entries: Entry[];
  error?: boolean;
}

const fail = (message: string): Outcome => ({ result: { error: message }, entries: [], error: true });
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const advText = (adv: Advantage) => (adv === 'advantage' ? ' с преимуществом' : adv === 'disadvantage' ? ' с помехой' : '');
const diceText = (rolls: number[]) => (rolls.length > 1 ? `[${rolls.join(', ')}]` : `${rolls[0]}`);

/** Uses up the face's bonus die, if one is waiting. */
function spendBonus(c: Campaign, rng: Rng): number {
  const dice = c.character.bonusDice;
  if (!dice) return 0;
  c.character.bonusDice = null;
  return roll(dice, rng)?.total ?? 0;
}

export function check(c: Campaign, input: { skill: Skill | null; ability: Ability; dc: number; advantage: Advantage; reason: string }, rng: Rng): Outcome {
  if (c.character.dead) return fail('Персонаж мёртв');
  const ability = input.skill ? SKILLS[input.skill].ability : input.ability;
  const bonus = input.skill ? skillBonus(c.character, input.skill) : modifier(c.character.abilities[ability]);
  const d = rollD20(input.advantage, rng);
  const extra = spendBonus(c, rng);
  const total = d.kept + bonus + extra;
  const success = total >= input.dc;
  const label = input.skill ? `${SKILLS[input.skill].name} (${ABILITY_SHORT[ability]})` : ABILITY_SHORT[ability];
  return {
    result: { roll: d.kept, dice: d.rolls, bonus: bonus + extra, total, dc: input.dc, success },
    entries: [{
      kind: 'roll',
      title: `${label}: ${input.reason}`,
      detail: `d20${advText(input.advantage)} ${diceText(d.rolls)} ${sign(bonus)}${extra ? ` ${sign(extra)} рычаг` : ''} = ${total} против КС ${input.dc}`,
      outcome: success ? 'success' : 'fail',
    }],
  };
}

export function save(c: Campaign, input: { ability: Ability; dc: number; advantage: Advantage; reason: string }, rng: Rng): Outcome {
  if (c.character.dead) return fail('Персонаж мёртв');
  const bonus = saveBonus(c.character, input.ability);
  const d = rollD20(input.advantage, rng);
  const total = d.kept + bonus;
  const success = total >= input.dc;
  return {
    result: { roll: d.kept, dice: d.rolls, bonus, total, dc: input.dc, success },
    entries: [{
      kind: 'roll',
      title: `Спасбросок ${ABILITY_SHORT[input.ability]}: ${input.reason}`,
      detail: `d20${advText(input.advantage)} ${diceText(d.rolls)} ${sign(bonus)} = ${total} против КС ${input.dc}`,
      outcome: success ? 'success' : 'fail',
    }],
  };
}

const enemyById = (c: Campaign, id: string) => c.combat?.enemies.find((e) => e.id === id);

function damageEnemy(c: Campaign, id: string, amount: number): { hp: number; down: boolean; xp: number } {
  const e = enemyById(c, id)!;
  e.hp = Math.max(0, e.hp - amount);
  return { hp: e.hp, down: e.hp === 0, xp: e.hp === 0 ? ENEMIES[e.kind]?.xp ?? 0 : 0 };
}

export function playerAttack(c: Campaign, input: { weapon: string; target: string; advantage: Advantage }, rng: Rng): Outcome {
  const ch = c.character;
  if (ch.dead || ch.hp === 0) return fail('Персонаж без сознания и не может атаковать');
  const enemy = enemyById(c, input.target);
  if (!enemy) return fail(`Нет врага с id ${input.target}. Враги: ${c.combat?.enemies.map((e) => e.id).join(', ') || 'боя нет'}`);
  if (enemy.hp === 0) return fail(`${enemy.name} уже выведен из строя`);
  const weaponId = ch.weapons.includes(input.weapon) ? input.weapon : input.weapon === 'fists' ? 'fists' : null;
  if (!weaponId) return fail(`У персонажа нет оружия ${input.weapon}. Есть: ${ch.weapons.join(', ')}, fists`);
  const atk = weaponAttack(ch, weaponId)!;
  const d = rollD20(input.advantage, rng);
  const extra = spendBonus(c, rng);
  const crit = d.kept === 20;
  const total = d.kept + atk.bonus + extra;
  const hit = crit || (d.kept !== 1 && total >= enemy.ac);
  const name = WEAPONS[weaponId].name;
  const attackLine = `d20${advText(input.advantage)} ${diceText(d.rolls)} ${sign(atk.bonus)}${extra ? ` ${sign(extra)} рычаг` : ''} = ${total} против КД ${enemy.ac}`;
  if (!hit) {
    return {
      result: { hit: false, roll: d.kept, total, ac: enemy.ac, fumble: d.kept === 1 },
      entries: [{ kind: 'roll', title: `${name} → ${enemy.name}`, detail: `${attackLine} — промах`, outcome: d.kept === 1 ? 'fumble' : 'fail' }],
    };
  }
  const dmg = roll(atk.damage, rng, crit)!;
  const amount = Math.max(1, dmg.total);
  const after = damageEnemy(c, enemy.id, amount);
  if (after.xp) ch.xp += after.xp;
  return {
    result: { hit: true, critical: crit, damage: amount, target_hp: after.hp, target_down: after.down, xp_gained: after.xp },
    entries: [{
      kind: 'roll',
      title: `${name} → ${enemy.name}`,
      detail: `${attackLine} — ${crit ? 'КРИТ! ' : ''}урон ${atk.damage}${crit ? ' ×2 кубика' : ''} ${diceText(dmg.dice)} = ${amount}. ${after.down ? `${enemy.name} выведен из строя` : `Осталось ${after.hp}/${enemy.maxHp}`}`,
      outcome: crit ? 'crit' : 'success',
    }],
  };
}

export function enemyAttack(c: Campaign, input: { enemy: string; advantage: Advantage }, rng: Rng): Outcome {
  const enemy = enemyById(c, input.enemy);
  if (!enemy) return fail(`Нет врага с id ${input.enemy}`);
  if (enemy.hp === 0) return fail(`${enemy.name} выведен из строя и не атакует`);
  const def = ENEMIES[enemy.kind];
  const ch = c.character;
  const ac = armorClass(ch);
  const d = rollD20(input.advantage, rng);
  const crit = d.kept === 20;
  const total = d.kept + def.attack.bonus;
  const hit = crit || (d.kept !== 1 && total >= ac);
  const line = `d20${advText(input.advantage)} ${diceText(d.rolls)} ${sign(def.attack.bonus)} = ${total} против КД ${ac}`;
  if (!hit) {
    return {
      result: { hit: false, total, player_ac: ac },
      entries: [{ kind: 'roll', title: `${enemy.name}: ${def.attack.name}`, detail: `${line} — мимо`, outcome: 'success' }],
    };
  }
  const dmg = roll(def.attack.damage, rng, crit)!;
  const amount = Math.max(1, dmg.total);
  const res = hurt(ch, amount);
  return {
    result: { hit: true, critical: crit, damage: amount, player_hp: ch.hp, player_down: res.fell, player_dead: res.died },
    entries: [{
      kind: 'roll',
      title: `${enemy.name}: ${def.attack.name}`,
      detail: `${line} — ${crit ? 'КРИТ! ' : ''}урон ${diceText(dmg.dice)} = ${amount}. ${res.died ? 'Смерть.' : res.fell ? 'Ты падаешь без сознания.' : `Хиты ${ch.hp}/${ch.maxHp}`}`,
      outcome: crit ? 'fumble' : 'fail',
    }],
  };
}

/** Damage or healing outside an attack: falls, fire, a stim, a back-alley surgeon. */
export function changeHp(c: Campaign, input: { amount: string; heal: boolean; reason: string }, rng: Rng): Outcome {
  const r = roll(input.amount, rng);
  if (!r) return fail(`Не понимаю формулу ${input.amount}`);
  const ch = c.character;
  const value = Math.max(0, r.total);
  if (input.heal) {
    const healed = heal(ch, value);
    return {
      result: { healed, player_hp: ch.hp },
      entries: [{ kind: 'roll', title: `Лечение: ${input.reason}`, detail: `${input.amount} ${r.dice.length ? diceText(r.dice) : ''} = +${healed}. Хиты ${ch.hp}/${ch.maxHp}`, outcome: 'success' }],
    };
  }
  const res = hurt(ch, value);
  return {
    result: { damage: value, player_hp: ch.hp, player_down: res.fell, player_dead: res.died },
    entries: [{ kind: 'roll', title: `Урон: ${input.reason}`, detail: `${input.amount} ${r.dice.length ? diceText(r.dice) : ''} = ${value}. ${res.died ? 'Смерть.' : `Хиты ${ch.hp}/${ch.maxHp}`}`, outcome: 'fail' }],
  };
}

export function useFeature(c: Campaign, input: { target: string | null }, rng: Rng): Outcome {
  const ch = c.character;
  const f = cls(ch).feature;
  if (ch.featureUses <= 0) return fail(`«${f.name}» исчерпано до ${f.recharge === 'short' ? 'короткого' : 'долгого'} отдыха`);
  const mod = f.effect.ability ? modifier(ch.abilities[f.effect.ability]) : 0;
  const formula = `${f.effect.dice}${f.effect.addLevel ? `+${ch.level}` : ''}${mod ? sign(mod) : ''}`;
  if (f.effect.kind === 'bonus') {
    ch.featureUses--;
    ch.bonusDice = f.effect.dice;
    return {
      result: { ready: true, bonus_dice: f.effect.dice, uses_left: ch.featureUses },
      entries: [{ kind: 'roll', title: f.name, detail: `+${f.effect.dice} к следующей проверке или атаке`, outcome: 'neutral' }],
    };
  }
  if (f.effect.kind === 'damage') {
    const enemy = input.target ? enemyById(c, input.target) : undefined;
    if (!enemy || enemy.hp === 0) return fail(`Нужна живая цель из боя: ${c.combat?.enemies.filter((e) => e.hp > 0).map((e) => e.id).join(', ') || 'боя нет'}`);
    ch.featureUses--;
    const r = roll(formula, rng)!;
    const amount = Math.max(1, r.total);
    const after = damageEnemy(c, enemy.id, amount);
    if (after.xp) ch.xp += after.xp;
    return {
      result: { damage: amount, target_hp: after.hp, target_down: after.down, uses_left: ch.featureUses, xp_gained: after.xp },
      entries: [{ kind: 'roll', title: `${f.name} → ${enemy.name}`, detail: `${formula} ${diceText(r.dice)} = ${amount}. ${after.down ? `${enemy.name} выведен из строя` : `Осталось ${after.hp}/${enemy.maxHp}`}`, outcome: 'success' }],
    };
  }
  ch.featureUses--;
  const r = roll(formula, rng)!;
  const healed = heal(ch, Math.max(1, r.total));
  return {
    result: { healed, player_hp: ch.hp, uses_left: ch.featureUses },
    entries: [{ kind: 'roll', title: f.name, detail: `${formula} ${diceText(r.dice)} = +${healed}. Хиты ${ch.hp}/${ch.maxHp}`, outcome: 'success' }],
  };
}

export function deathSave(c: Campaign, rng: Rng): Outcome {
  const ch = c.character;
  if (ch.hp > 0 || ch.dead) return fail('Спасбросок от смерти нужен только при 0 хитов');
  const d = rollD20('none', rng).kept;
  let text: string;
  if (d === 20) {
    ch.hp = 1;
    ch.deathSaves = { success: 0, fail: 0 };
    text = '20 — приходишь в себя с 1 хитом';
  } else if (d === 1 || d < 10) {
    ch.deathSaves.fail += d === 1 ? 2 : 1;
    if (ch.deathSaves.fail >= 3) ch.dead = true;
    text = `${d} — провал (${ch.deathSaves.fail}/3)${ch.dead ? '. Смерть.' : ''}`;
  } else {
    ch.deathSaves.success += 1;
    text = `${d} — успех (${ch.deathSaves.success}/3)`;
    if (ch.deathSaves.success >= 3) {
      ch.deathSaves = { success: 0, fail: 0 };
      text += '. Состояние стабильно';
    }
  }
  return {
    result: { roll: d, successes: ch.deathSaves.success, failures: ch.deathSaves.fail, hp: ch.hp, dead: ch.dead },
    entries: [{ kind: 'roll', title: 'Спасбросок от смерти', detail: text, outcome: ch.dead ? 'fumble' : d >= 10 ? 'success' : 'fail' }],
  };
}

export function startCombat(c: Campaign, input: { enemies: { kind: string; name: string | null }[]; surprise: boolean }, rng: Rng): Outcome {
  if (c.combat) return fail('Бой уже идёт; закончите его через end_combat');
  const bad = input.enemies.find((e) => !ENEMIES[e.kind]);
  if (bad) return fail(`Нет такого врага: ${bad.kind}. Доступны: ${Object.keys(ENEMIES).join(', ')}`);
  if (input.enemies.length === 0 || input.enemies.length > 8) return fail('В бою от 1 до 8 врагов');
  const enemies = input.enemies.map((e) => {
    const def = ENEMIES[e.kind];
    const hp = Math.max(1, roll(def.hp, rng)!.total);
    return { id: `${e.kind}-${c.nextEnemyId++}`, kind: e.kind, name: e.name?.trim() || def.name, hp, maxHp: hp, ac: def.ac, initiative: rollD20('none', rng).kept + def.initiative };
  });
  const ch = c.character;
  const playerInit = rollD20(input.surprise ? 'advantage' : 'none', rng).kept + modifier(ch.abilities.dex);
  const order = [{ id: 'player', name: ch.name, initiative: playerInit }, ...enemies.map((e) => ({ id: e.id, name: e.name, initiative: e.initiative }))]
    .sort((a, b) => b.initiative - a.initiative || (a.id === 'player' ? -1 : 1));
  c.combat = { round: 1, order, turn: 0, enemies };
  return {
    result: { enemies: enemies.map((e) => ({ id: e.id, name: e.name, hp: e.hp, ac: e.ac })), order: order.map((o) => `${o.id} (${o.initiative})`), first: order[0].id },
    entries: [{ kind: 'roll', title: 'Бой! Инициатива', detail: order.map((o) => `${o.name} ${o.initiative}`).join(' · '), outcome: 'neutral' }],
  };
}

/** Moves to the next living combatant; the model calls it after each turn. */
export function nextTurn(c: Campaign): Outcome {
  const combat = c.combat;
  if (!combat) return fail('Боя нет');
  const alive = (id: string) => id === 'player' ? !c.character.dead : (enemyById(c, id)?.hp ?? 0) > 0;
  for (let i = 0; i < combat.order.length; i++) {
    combat.turn++;
    if (combat.turn >= combat.order.length) {
      combat.turn = 0;
      combat.round++;
    }
    if (alive(combat.order[combat.turn].id)) break;
  }
  const now = combat.order[combat.turn];
  return { result: { round: combat.round, turn_of: now.id, name: now.name }, entries: [] };
}

export function endCombat(c: Campaign, input: { outcome: string }): Outcome {
  if (!c.combat) return fail('Боя нет');
  c.combat = null;
  return { result: { ended: true }, entries: [{ kind: 'system', text: `Бой окончен: ${input.outcome}` }] };
}

export function changeGear(c: Campaign, input: { add: string[]; remove: string[]; credits: number; reason: string }): Outcome {
  const ch = c.character;
  if (ch.credits + input.credits < 0) return fail(`Не хватает денег: есть ${ch.credits}¥, нужно ${-input.credits}¥`);
  const missing = input.remove.filter((item) => !ch.inventory.includes(item) && !ch.weapons.includes(item));
  if (missing.length) return fail(`Нет в инвентаре: ${missing.join(', ')}`);
  for (const item of input.remove) {
    const list = ch.inventory.includes(item) ? ch.inventory : ch.weapons;
    list.splice(list.indexOf(item), 1);
  }
  for (const item of input.add) {
    // Known weapons go in hand and can be attacked with.
    if (WEAPONS[item]) ch.weapons.push(item);
    else ch.inventory.push(item.slice(0, 80));
  }
  ch.credits += input.credits;
  const parts = [
    ...input.add.map((a) => `+ ${WEAPONS[a]?.name ?? a}`),
    ...input.remove.map((r) => `− ${WEAPONS[r]?.name ?? r}`),
    ...(input.credits ? [`${input.credits > 0 ? '+' : ''}${input.credits}¥`] : []),
  ];
  return {
    result: { credits: ch.credits, inventory: ch.inventory, weapons: ch.weapons },
    entries: parts.length ? [{ kind: 'system', text: `${input.reason}: ${parts.join(', ')}` }] : [],
  };
}

export function awardXp(c: Campaign, input: { amount: number; reason: string }): Outcome {
  const ch = c.character;
  ch.xp += Math.max(0, Math.min(5000, Math.round(input.amount)));
  const gained = levelUp(ch);
  const entries: Entry[] = [{ kind: 'system', text: `+${input.amount} опыта: ${input.reason}` }];
  if (gained) entries.push({ kind: 'system', text: `Новый уровень: ${ch.level}! Хиты ${ch.hp}/${ch.maxHp}, мастерство +${proficiency(ch.level)}` });
  return { result: { xp: ch.xp, level: ch.level, leveled_up: gained > 0 }, entries };
}

export function takeRest(c: Campaign, input: { kind: 'short' | 'long' }, rng: Rng): Outcome {
  if (c.combat) return fail('Во время боя отдыхать нельзя');
  const ch = c.character;
  let healed = 0;
  if (input.kind === 'short') {
    // One hit die, as the SRD lets a short rest spend.
    const r = roll(`1d${cls(ch).hitDie}${sign(modifier(ch.abilities.con))}`, rng)!;
    healed = heal(ch, Math.max(1, r.total));
  } else healed = ch.maxHp - ch.hp;
  rest(ch, input.kind);
  return {
    result: { player_hp: ch.hp, feature_uses: ch.featureUses },
    entries: [{ kind: 'system', text: `${input.kind === 'long' ? 'Долгий' : 'Короткий'} отдых: +${healed} хитов, ${classById(ch.classId)!.feature.name}: ${ch.featureUses}` }],
  };
}

export function rollDice(input: { formula: string; reason: string }, rng: Rng): Outcome {
  const r = roll(input.formula, rng);
  if (!r) return fail(`Не понимаю формулу ${input.formula}`);
  return {
    result: { total: r.total, dice: r.dice },
    entries: [{ kind: 'roll', title: input.reason, detail: `${input.formula} ${r.dice.length ? diceText(r.dice) : ''} = ${r.total}`, outcome: 'neutral' }],
  };
}

export function updateQuest(c: Campaign, input: { id: string; title: string; status: 'active' | 'done' | 'failed'; note: string }): Outcome {
  const q = c.quests.find((x) => x.id === input.id);
  const isNew = !q;
  if (q) Object.assign(q, { title: input.title || q.title, status: input.status, note: input.note || q.note });
  else c.quests.push({ id: input.id, title: input.title, status: input.status, note: input.note });
  const word = input.status === 'done' ? 'выполнено' : input.status === 'failed' ? 'провалено' : isNew ? 'новое задание' : 'задание обновлено';
  return { result: { quests: c.quests.length }, entries: [{ kind: 'system', text: `${word}: ${input.title || q?.title}` }] };
}

export function remember(c: Campaign, input: { fact: string; location: string | null }): Outcome {
  if (input.fact.trim()) c.facts.push(input.fact.trim().slice(0, 300));
  // Old facts drop off the front; the model still has the conversation itself.
  if (c.facts.length > 60) c.facts.splice(0, c.facts.length - 60);
  if (input.location?.trim()) c.location = input.location.trim().slice(0, 80);
  return { result: { facts: c.facts.length, location: c.location }, entries: [] };
}
