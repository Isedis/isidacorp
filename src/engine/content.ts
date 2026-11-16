/**
 * The world's content: abilities and skills follow the SRD 5.2 core (CC-BY-4.0), the classes,
 * gear, implants and enemies are our own cyberpunk setting built on it.
 */

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export const ABILITIES: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Сила',
  dex: 'Ловкость',
  con: 'Телосложение',
  int: 'Интеллект',
  wis: 'Мудрость',
  cha: 'Харизма',
};
export const ABILITY_SHORT: Record<Ability, string> = { str: 'СИЛ', dex: 'ЛОВ', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР' };

export type Skill =
  | 'athletics' | 'acrobatics' | 'sleight' | 'stealth'
  | 'hacking' | 'tech' | 'investigation' | 'history'
  | 'medicine' | 'perception' | 'insight' | 'streetwise'
  | 'deception' | 'intimidation' | 'persuasion' | 'performance';

export const SKILLS: Record<Skill, { name: string; ability: Ability }> = {
  athletics: { name: 'Атлетика', ability: 'str' },
  acrobatics: { name: 'Акробатика', ability: 'dex' },
  sleight: { name: 'Ловкость рук', ability: 'dex' },
  stealth: { name: 'Скрытность', ability: 'dex' },
  hacking: { name: 'Взлом', ability: 'int' },
  tech: { name: 'Техника', ability: 'int' },
  investigation: { name: 'Анализ', ability: 'int' },
  history: { name: 'Знания', ability: 'int' },
  medicine: { name: 'Медицина', ability: 'wis' },
  perception: { name: 'Внимательность', ability: 'wis' },
  insight: { name: 'Проницательность', ability: 'wis' },
  streetwise: { name: 'Улицы', ability: 'wis' },
  deception: { name: 'Обман', ability: 'cha' },
  intimidation: { name: 'Запугивание', ability: 'cha' },
  persuasion: { name: 'Убеждение', ability: 'cha' },
  performance: { name: 'Выступление', ability: 'cha' },
};
export const SKILL_IDS = Object.keys(SKILLS) as Skill[];

export interface Weapon {
  id: string;
  name: string;
  damage: string;
  /** Finesse and firearms use Dexterity, heavy melee uses Strength. */
  ability: 'str' | 'dex';
  ranged: boolean;
}

export const WEAPONS: Record<string, Weapon> = {
  pistol: { id: 'pistol', name: 'Пистолет «Гадюка»', damage: '1d8', ability: 'dex', ranged: true },
  smg: { id: 'smg', name: 'Пистолет-пулемёт', damage: '1d6', ability: 'dex', ranged: true },
  rifle: { id: 'rifle', name: 'Штурмовая винтовка', damage: '1d10', ability: 'dex', ranged: true },
  shotgun: { id: 'shotgun', name: 'Дробовик', damage: '2d6', ability: 'dex', ranged: true },
  knife: { id: 'knife', name: 'Моно-нож', damage: '1d4', ability: 'dex', ranged: false },
  katana: { id: 'katana', name: 'Термокатана', damage: '1d10', ability: 'str', ranged: false },
  pipe: { id: 'pipe', name: 'Арматура', damage: '1d6', ability: 'str', ranged: false },
  fists: { id: 'fists', name: 'Кулаки', damage: '1', ability: 'str', ranged: false },
};

export interface Armor {
  id: string;
  name: string;
  base: number;
  /** How much Dexterity adds; null for no limit. */
  dexCap: number | null;
}

export const ARMORS: Record<string, Armor> = {
  jacket: { id: 'jacket', name: 'Армированная куртка', base: 11, dexCap: null },
  vest: { id: 'vest', name: 'Бронежилет', base: 13, dexCap: 2 },
  plates: { id: 'plates', name: 'Подкожная броня', base: 14, dexCap: 2 },
  none: { id: 'none', name: 'Без брони', base: 10, dexCap: null },
};

/** A class feature with limited uses, spent through the game master's tools. */
export interface Feature {
  id: string;
  name: string;
  text: string;
  uses: number;
  /** When uses come back. */
  recharge: 'short' | 'long';
  /** What the engine rolls: healing, damage or a bonus, with its ability modifier added if set. */
  effect: { kind: 'heal' | 'damage' | 'bonus'; dice: string; ability?: Ability; addLevel?: boolean };
}

export interface ClassDef {
  id: string;
  name: string;
  tagline: string;
  hitDie: number;
  /** Abilities in order of importance: the standard array goes into them in this order. */
  priority: Ability[];
  saves: [Ability, Ability];
  skills: Skill[];
  weapons: string[];
  armor: string;
  feature: Feature;
  gear: string[];
}

export const CLASSES: readonly ClassDef[] = [
  {
    id: 'solo', name: 'Соло', tagline: 'Наёмный стрелок. Держит удар и бьёт первым.',
    hitDie: 10, priority: ['dex', 'con', 'str', 'wis', 'int', 'cha'], saves: ['str', 'con'],
    skills: ['athletics', 'intimidation', 'perception'], weapons: ['rifle', 'knife'], armor: 'vest',
    feature: { id: 'second-wind', name: 'Второе дыхание', text: 'Стимулятор: восстановить 1d10 + уровень хитов', uses: 1, recharge: 'short', effect: { kind: 'heal', dice: '1d10', addLevel: true } },
    gear: ['Аптечка', 'Два магазина', 'Наручные часы со взломанным GPS'],
  },
  {
    id: 'netrunner', name: 'Нетраннер', tagline: 'Хакер с нейроразъёмом. Ломает сети, камеры и чужие мозги.',
    hitDie: 6, priority: ['int', 'dex', 'con', 'wis', 'cha', 'str'], saves: ['int', 'wis'],
    skills: ['hacking', 'tech', 'investigation'], weapons: ['pistol'], armor: 'jacket',
    feature: { id: 'overload', name: 'Перегрузка', text: 'Прожечь импланты цели: 2d8 + ИНТ нейро-урона', uses: 2, recharge: 'long', effect: { kind: 'damage', dice: '2d8', ability: 'int' } },
    gear: ['Кибердека «Мотылёк»', 'Шнур прямого подключения', 'Энергетик «Синий дым»'],
  },
  {
    id: 'techie', name: 'Техник', tagline: 'Чинит, собирает и взрывает. Таскает с собой дрона.',
    hitDie: 8, priority: ['int', 'con', 'dex', 'wis', 'str', 'cha'], saves: ['con', 'int'],
    skills: ['tech', 'investigation', 'sleight'], weapons: ['shotgun', 'pipe'], armor: 'vest',
    feature: { id: 'drone', name: 'Дрон-оса', text: 'Дрон атакует цель: 1d8 + ИНТ урона', uses: 3, recharge: 'short', effect: { kind: 'damage', dice: '1d8', ability: 'int' } },
    gear: ['Ящик инструментов', 'Изолента', 'Самодельная граната'],
  },
  {
    id: 'medtech', name: 'Медтех', tagline: 'Уличный хирург. Ставит на ноги и знает, где у тела слабые места.',
    hitDie: 8, priority: ['wis', 'con', 'dex', 'int', 'cha', 'str'], saves: ['wis', 'cha'],
    skills: ['medicine', 'insight', 'tech'], weapons: ['smg'], armor: 'vest',
    feature: { id: 'trauma', name: 'Травма-набор', text: 'Срочная помощь: восстановить 1d8 + МДР хитов', uses: 3, recharge: 'long', effect: { kind: 'heal', dice: '1d8', ability: 'wis' } },
    gear: ['Медицинский сканер', 'Три шприца с коагулянтом', 'Перчатки'],
  },
  {
    id: 'face', name: 'Фейсер', tagline: 'Фиксер и переговорщик. Знает всех и всем что-то должен.',
    hitDie: 8, priority: ['cha', 'dex', 'wis', 'con', 'int', 'str'], saves: ['dex', 'cha'],
    skills: ['persuasion', 'deception', 'streetwise'], weapons: ['pistol'], armor: 'jacket',
    feature: { id: 'leverage', name: 'Рычаг', text: 'Найти слабость: +1d6 к следующей проверке или атаке', uses: 3, recharge: 'short', effect: { kind: 'bonus', dice: '1d6' } },
    gear: ['Телефон с тремя личностями', 'Хороший костюм', 'Визитки фиксера'],
  },
  {
    id: 'ghost', name: 'Призрак', tagline: 'Вор и убийца. Камеры его не видят, охрана не слышит.',
    hitDie: 8, priority: ['dex', 'int', 'con', 'wis', 'cha', 'str'], saves: ['dex', 'int'],
    skills: ['stealth', 'acrobatics', 'sleight', 'perception'], weapons: ['knife', 'smg'], armor: 'jacket',
    feature: { id: 'sneak', name: 'Удар из тени', text: 'Атака из засады наносит ещё 1d6 урона', uses: 3, recharge: 'short', effect: { kind: 'damage', dice: '1d6' } },
    gear: ['Отмычки', 'Оптический камуфляж (сбоит)', 'Крюк-кошка'],
  },
];

export const classById = (id: string) => CLASSES.find((c) => c.id === id);

/** SRD standard array. */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

export interface EnemyDef {
  id: string;
  name: string;
  ac: number;
  hp: string;
  initiative: number;
  attack: { name: string; bonus: number; damage: string };
  xp: number;
}

/** The bestiary: enemies the game master can bring into a fight. */
export const ENEMIES: Record<string, EnemyDef> = {
  thug: { id: 'thug', name: 'Уличный бандит', ac: 12, hp: '2d8+2', initiative: 1, attack: { name: 'Обрез', bonus: 3, damage: '1d8+1' }, xp: 25 },
  guard: { id: 'guard', name: 'Охранник корпорации', ac: 15, hp: '3d8+3', initiative: 1, attack: { name: 'Пистолет-пулемёт', bonus: 4, damage: '1d6+2' }, xp: 50 },
  drone: { id: 'drone', name: 'Дрон-охранник', ac: 14, hp: '2d6', initiative: 3, attack: { name: 'Шоковый разряд', bonus: 4, damage: '1d6+2' }, xp: 25 },
  ganger: { id: 'ganger', name: 'Боец банды', ac: 13, hp: '4d8+4', initiative: 2, attack: { name: 'Мачете', bonus: 4, damage: '1d8+2' }, xp: 50 },
  merc: { id: 'merc', name: 'Наёмник', ac: 16, hp: '6d8+12', initiative: 2, attack: { name: 'Штурмовая винтовка', bonus: 5, damage: '1d10+3' }, xp: 200 },
  cyberpsycho: { id: 'cyberpsycho', name: 'Киберпсих', ac: 15, hp: '10d8+30', initiative: 3, attack: { name: 'Клинки-богомолы', bonus: 6, damage: '2d8+4' }, xp: 450 },
  mech: { id: 'mech', name: 'Боевой мех', ac: 17, hp: '12d10+36', initiative: 0, attack: { name: 'Ротационный пулемёт', bonus: 7, damage: '3d8+3' }, xp: 700 },
  netghost: { id: 'netghost', name: 'Чёрный лёд', ac: 13, hp: '5d6', initiative: 4, attack: { name: 'Нейроудар', bonus: 5, damage: '2d6' }, xp: 100 },
};

/** SRD experience thresholds for levels 2-10. */
export const LEVEL_XP = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000];
