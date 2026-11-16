import { ABILITIES, ARMORS, CLASSES, LEVEL_XP, SKILLS, STANDARD_ARRAY, WEAPONS, classById, type Ability, type ClassDef, type Skill } from './content';

export interface Character {
  name: string;
  /** A few words from the player: looks, past, what they want. */
  about: string;
  classId: string;
  level: number;
  xp: number;
  abilities: Record<Ability, number>;
  maxHp: number;
  hp: number;
  /** Temporary bonus from the face's "Рычаг", spent on the next check or attack. */
  bonusDice: string | null;
  weapons: string[];
  armor: string;
  inventory: string[];
  credits: number;
  featureUses: number;
  conditions: string[];
  /** Death saving throws while at 0 hit points. */
  deathSaves: { success: number; fail: number };
  dead: boolean;
}

export const modifier = (score: number) => Math.floor((score - 10) / 2);
export const proficiency = (level: number) => 2 + Math.floor((level - 1) / 4);
export const cls = (c: Character): ClassDef => classById(c.classId)!;

export function createCharacter(name: string, classId: string, about = ''): Character {
  const def = classById(classId) ?? CLASSES[0];
  const abilities = {} as Record<Ability, number>;
  def.priority.forEach((a, i) => (abilities[a] = STANDARD_ARRAY[i]));
  const maxHp = def.hitDie + modifier(abilities.con);
  return {
    name: name.trim() || 'Безымянный',
    about: about.trim(),
    classId: def.id,
    level: 1,
    xp: 0,
    abilities,
    maxHp,
    hp: maxHp,
    bonusDice: null,
    weapons: [...def.weapons],
    armor: def.armor,
    inventory: [...def.gear],
    credits: 150,
    featureUses: def.feature.uses,
    conditions: [],
    deathSaves: { success: 0, fail: 0 },
    dead: false,
  };
}

export function armorClass(c: Character): number {
  const armor = ARMORS[c.armor] ?? ARMORS.none;
  const dex = modifier(c.abilities.dex);
  return armor.base + (armor.dexCap === null ? dex : Math.min(dex, armor.dexCap));
}

export const proficientSkill = (c: Character, skill: Skill) => cls(c).skills.includes(skill);
export const proficientSave = (c: Character, ability: Ability) => cls(c).saves.includes(ability);

export function skillBonus(c: Character, skill: Skill): number {
  return modifier(c.abilities[SKILLS[skill].ability]) + (proficientSkill(c, skill) ? proficiency(c.level) : 0);
}

export function saveBonus(c: Character, ability: Ability): number {
  return modifier(c.abilities[ability]) + (proficientSave(c, ability) ? proficiency(c.level) : 0);
}

export function weaponAttack(c: Character, weaponId: string): { bonus: number; damage: string } | null {
  const w = WEAPONS[weaponId];
  if (!w) return null;
  // Finesse: a melee weapon on Dexterity uses the better of the two.
  const ability = w.ability === 'dex' && !w.ranged ? (c.abilities.dex >= c.abilities.str ? 'dex' : 'str') : w.ability;
  const mod = modifier(c.abilities[ability]);
  const damage = w.damage === '1' ? `${Math.max(1, 1 + mod)}` : `${w.damage}${mod >= 0 ? '+' : ''}${mod}`;
  return { bonus: mod + proficiency(c.level), damage };
}

/** Level the experience earns: SRD thresholds. */
export const levelFor = (xp: number) => {
  let level = 1;
  LEVEL_XP.forEach((need, i) => {
    if (xp >= need) level = i + 1;
  });
  return level;
};

/** Raises the level if the experience allows: average hit die plus Constitution per level. */
export function levelUp(c: Character): number {
  const target = levelFor(c.xp);
  let gained = 0;
  while (c.level < target) {
    c.level++;
    const hp = Math.floor(cls(c).hitDie / 2) + 1 + modifier(c.abilities.con);
    c.maxHp += Math.max(1, hp);
    c.hp += Math.max(1, hp);
    gained++;
  }
  return gained;
}

export function heal(c: Character, amount: number): number {
  const before = c.hp;
  c.hp = Math.min(c.maxHp, c.hp + Math.max(0, amount));
  if (c.hp > 0) c.deathSaves = { success: 0, fail: 0 };
  return c.hp - before;
}

/** Damage to the player: at 0 they fall; damage as large as their maximum on top of that kills outright (SRD). */
export function hurt(c: Character, amount: number): { fell: boolean; died: boolean } {
  const dmg = Math.max(0, amount);
  if (c.hp === 0) {
    c.deathSaves.fail += 1;
    if (dmg >= c.maxHp || c.deathSaves.fail >= 3) c.dead = true;
    return { fell: false, died: c.dead };
  }
  const left = c.hp - dmg;
  c.hp = Math.max(0, left);
  if (c.hp === 0 && -left >= c.maxHp) {
    c.dead = true;
    return { fell: true, died: true };
  }
  return { fell: c.hp === 0, died: false };
}

export function rest(c: Character, kind: 'short' | 'long'): void {
  const f = cls(c).feature;
  if (kind === 'long') {
    c.hp = c.maxHp;
    c.featureUses = f.uses;
    c.deathSaves = { success: 0, fail: 0 };
  } else if (f.recharge === 'short') c.featureUses = f.uses;
}

export { ABILITIES };
