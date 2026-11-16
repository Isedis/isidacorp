/** A source of uniform numbers in [0, 1): Math.random in play, a seeded one in tests. */
export type Rng = () => number;

/** A seeded generator (mulberry32), for tests and reproducible rolls. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const die = (sides: number, rng: Rng) => 1 + Math.floor(rng() * sides);

export type Advantage = 'none' | 'advantage' | 'disadvantage';

export interface D20 {
  /** Both dice when rolled with advantage or disadvantage, otherwise one. */
  rolls: number[];
  kept: number;
}

export function rollD20(adv: Advantage, rng: Rng): D20 {
  const first = die(20, rng);
  if (adv === 'none') return { rolls: [first], kept: first };
  const second = die(20, rng);
  return { rolls: [first, second], kept: adv === 'advantage' ? Math.max(first, second) : Math.min(first, second) };
}

interface Term {
  sign: 1 | -1;
  count: number;
  sides: number; // 0 for a flat number
}

const TERM = /^(\d*)d(\d+)$|^(\d+)$/;

/** Parses "2d6+3", "1d8 + 1d4 - 1", "d20". Returns null for anything else. */
export function parseFormula(formula: string): Term[] | null {
  const text = formula.replace(/\s+/g, '').toLowerCase();
  if (!text || !/^[+-]?[0-9d]+([+-][0-9d]+)*$/.test(text)) return null;
  const terms: Term[] = [];
  for (const raw of text.match(/[+-]?[^+-]+/g)!) {
    const sign = raw.startsWith('-') ? -1 : 1;
    const body = raw.replace(/^[+-]/, '');
    const m = TERM.exec(body);
    if (!m) return null;
    if (m[3] !== undefined) terms.push({ sign, count: Number(m[3]), sides: 0 });
    else {
      const count = m[1] === '' ? 1 : Number(m[1]);
      const sides = Number(m[2]);
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
      terms.push({ sign, count, sides });
    }
  }
  return terms;
}

export interface Roll {
  formula: string;
  dice: number[];
  total: number;
}

/** Rolls a formula; `doubleDice` doubles the number of dice, as a critical hit does. */
export function roll(formula: string, rng: Rng, doubleDice = false): Roll | null {
  const terms = parseFormula(formula);
  if (!terms) return null;
  const dice: number[] = [];
  let total = 0;
  for (const t of terms) {
    if (t.sides === 0) {
      total += t.sign * t.count;
      continue;
    }
    for (let i = 0; i < t.count * (doubleDice ? 2 : 1); i++) {
      const d = die(t.sides, rng);
      dice.push(d);
      total += t.sign * d;
    }
  }
  return { formula, dice, total };
}
