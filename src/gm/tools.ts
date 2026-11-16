/**
 * The game master's tools: the model asks, the engine rolls. Schemas are strict and are also
 * checked here, since streamed tool input is not validated by the API.
 */
import * as act from '../engine/actions';
import { ENEMIES, SKILL_IDS, WEAPONS } from '../engine/content';
import type { Campaign } from '../engine/campaign';
import type { Rng } from '../engine/dice';

type Schema =
  | { type: 'string' | 'integer' | 'number' | 'boolean' | 'null'; enum?: readonly string[]; description?: string }
  | { type: 'array'; items: Schema; description?: string }
  | { type: 'object'; properties: Record<string, Schema>; required: string[]; additionalProperties: false; description?: string };

const str = (description: string, values?: readonly string[]): Schema => ({ type: 'string', description, ...(values ? { enum: values } : {}) });
const int = (description: string): Schema => ({ type: 'integer', description });
const bool = (description: string): Schema => ({ type: 'boolean', description });
const obj = (properties: Record<string, Schema>): Schema & { type: 'object' } => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

const ABILITY = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const ADV = ['none', 'advantage', 'disadvantage'] as const;
const advantage = str('Преимущество или помеха по правилам 5e', ADV);

interface ToolDef {
  name: string;
  description: string;
  schema: Schema & { type: 'object' };
  run: (c: Campaign, input: any, rng: Rng) => act.Outcome;
}

const TOOLS: ToolDef[] = [
  {
    name: 'ability_check',
    description: 'Проверка навыка или характеристики игрока (d20 + модификатор против КС). Вызывай, когда исход действия игрока неочевиден и у провала есть последствия. Не решай исход сам.',
    schema: obj({
      skill: str('Навык, если подходит; иначе none', [...SKILL_IDS, 'none']),
      ability: str('Характеристика (если навык указан, берётся его характеристика)', ABILITY),
      dc: int('Класс сложности: 5 очень легко, 10 легко, 15 средне, 20 трудно, 25 очень трудно, 30 почти невозможно'),
      advantage,
      reason: str('Что пытается сделать персонаж, 2-6 слов'),
    }),
    run: (c, i, rng) => act.check(c, { ...i, skill: i.skill === 'none' ? null : i.skill, dc: Math.min(35, Math.max(1, i.dc)) }, rng),
  },
  {
    name: 'saving_throw',
    description: 'Спасбросок игрока от опасности: взрыв (ЛОВ), яд или нейровирус (ТЕЛ), взлом мозга (ИНТ), внушение (МДР).',
    schema: obj({ ability: str('Характеристика', ABILITY), dc: int('КС'), advantage, reason: str('От чего, 2-6 слов') }),
    run: (c, i, rng) => act.save(c, i, rng),
  },
  {
    name: 'player_attack',
    description: 'Атака игрока по врагу в бою оружием. Движок бросает попадание и урон, меняет хиты врага и, если был ход игрока, передаёт ход дальше (next_turn в ответе).',
    schema: obj({ weapon: str('id оружия из списка оружия персонажа или fists', [...Object.keys(WEAPONS)]), target: str('id врага из состояния боя'), advantage }),
    run: (c, i, rng) => act.playerAttack(c, i, rng),
  },
  {
    name: 'enemy_attack',
    description: 'Атака врага по игроку в ход врага. Движок бросает попадание по КД игрока и урон и передаёт ход дальше (next_turn в ответе). Несколько врагов подряд — вызывай сразу все атаки в одном ответе.',
    schema: obj({ enemy: str('id атакующего врага'), advantage }),
    run: (c, i, rng) => act.enemyAttack(c, i, rng),
  },
  {
    name: 'use_feature',
    description: 'Особая способность класса игрока (см. состояние): лечение, урон по врагу или бонус к следующему броску. Тратит заряд.',
    schema: obj({ target: str('id врага для способности с уроном, иначе пустая строка') }),
    run: (c, i, rng) => act.useFeature(c, { target: i.target || null }, rng),
  },
  {
    name: 'change_hp',
    description: 'Урон или лечение игрока вне атаки: падение, огонь, стимулятор, уличный хирург. amount — формула кубиков вроде 2d6 или число.',
    schema: obj({ amount: str('Формула, например 1d6, 2d8+2 или 5'), heal: bool('true — лечение, false — урон'), reason: str('Причина, 2-6 слов') }),
    run: (c, i, rng) => act.changeHp(c, i, rng),
  },
  {
    name: 'death_save',
    description: 'Спасбросок от смерти, когда у игрока 0 хитов, в начале его хода.',
    schema: obj({}),
    run: (c, _i, rng) => act.deathSave(c, rng),
  },
  {
    name: 'start_combat',
    description: `Начать бой: создаёт врагов из бестиария и бросает инициативу. Виды: ${Object.values(ENEMIES).map((e) => `${e.id} (${e.name}, КД ${e.ac})`).join('; ')}.`,
    schema: obj({
      enemies: { type: 'array', items: obj({ kind: str('Вид из бестиария', Object.keys(ENEMIES)), name: str('Своё имя врага или пустая строка') }), description: 'Враги, 1-8' },
      surprise: bool('Игрок застал врагов врасплох'),
    }),
    run: (c, i, rng) => act.startCombat(c, { ...i, enemies: i.enemies.map((e: { kind: string; name: string }) => ({ kind: e.kind, name: e.name || null })) }, rng),
  },
  {
    name: 'next_turn',
    description: 'Передать ход следующему участнику боя, если его ход прошёл без атаки (бег, разговор, укрытие). После атак ход переходит сам.',
    schema: obj({}),
    run: (c) => act.nextTurn(c),
  },
  {
    name: 'end_combat',
    description: 'Закончить бой: враги побеждены, сбежали или сдались.',
    schema: obj({ outcome: str('Чем кончилось, 2-8 слов') }),
    run: (c, i) => act.endCombat(c, i),
  },
  {
    name: 'change_gear',
    description: `Изменить снаряжение и деньги (эдди, ¥): находки, покупки, кражи, оплата. Оружие из списка ${Object.keys(WEAPONS).join(', ')} добавляй по id, остальное — названием.`,
    schema: obj({
      add: { type: 'array', items: str('Предмет'), description: 'Что получил' },
      remove: { type: 'array', items: str('Предмет'), description: 'Что потерял — точные названия из инвентаря' },
      credits: int('Изменение денег, может быть отрицательным; 0 если не меняются'),
      reason: str('Причина, 2-6 слов'),
    }),
    run: (c, i) => act.changeGear(c, i),
  },
  {
    name: 'award_xp',
    description: 'Опыт за пройденное испытание без боя (взлом, переговоры, выполненное задание). За побеждённых врагов опыт начисляется сам.',
    schema: obj({ amount: int('Опыт: 25-100 за сцену, 100-500 за задание'), reason: str('За что') }),
    run: (c, i) => act.awardXp(c, i),
  },
  {
    name: 'rest',
    description: 'Отдых: короткий (час) или долгий (ночь в безопасном месте).',
    schema: obj({ kind: str('Вид отдыха', ['short', 'long']) }),
    run: (c, i, rng) => act.takeRest(c, i, rng),
  },
  {
    name: 'roll_dice',
    description: 'Произвольный бросок: случайная встреча, таблица, решение NPC. Не для проверок игрока.',
    schema: obj({ formula: str('Формула, например 1d20 или 3d6'), reason: str('Зачем') }),
    run: (_c, i, rng) => act.rollDice(i, rng),
  },
  {
    name: 'update_quest',
    description: 'Добавить или обновить задание в журнале игрока.',
    schema: obj({ id: str('Короткий латинский id'), title: str('Название'), status: str('Статус', ['active', 'done', 'failed']), note: str('Что известно, одна фраза') }),
    run: (c, i) => act.updateQuest(c, i),
  },
  {
    name: 'remember',
    description: 'Запомнить важный факт кампании (имя и роль NPC, долг, обещание, тайна) и/или сменить текущее место. Факты видны тебе в каждом ходе.',
    schema: obj({ fact: str('Факт одной фразой; пустая строка, если только место'), location: str('Новое место или пустая строка, если не сменилось') }),
    run: (c, i) => act.remember(c, { fact: i.fact, location: i.location || null }),
  },
];

/** The tools as plain data, in a fixed order, for claude.ai's page tools. */
export const TOOL_LIST = TOOLS.map(({ name, description, schema }) => ({ name, description, schema }));

/** Checks a value against our strict schema subset; returns the first problem or null. */
export function validate(schema: Schema, value: unknown, path = 'input'): string | null {
  const t = schema.type;
  if (t === 'object') {
    const s = schema as Extract<Schema, { type: 'object' }>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path}: ожидался объект`;
    for (const key of s.required) if (!(key in value)) return `${path}.${key}: отсутствует`;
    for (const key of Object.keys(value)) {
      const sub = s.properties[key];
      if (!sub) return `${path}.${key}: лишнее поле`;
      const err = validate(sub, (value as Record<string, unknown>)[key], `${path}.${key}`);
      if (err) return err;
    }
    return null;
  } else if (t === 'array') {
    if (!Array.isArray(value)) return `${path}: ожидался массив`;
    for (let i = 0; i < value.length; i++) {
      const err = validate((schema as Extract<Schema, { type: 'array' }>).items, value[i], `${path}[${i}]`);
      if (err) return err;
    }
    return null;
  } else if (t === 'integer') {
    if (!Number.isInteger(value)) return `${path}: ожидалось целое число`;
  } else if (t === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${path}: ожидалось число`;
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') return `${path}: ожидалось true/false`;
  } else if (t === 'string') {
    if (typeof value !== 'string') return `${path}: ожидалась строка`;
  } else if (t === 'null' && value !== null) return `${path}: ожидался null`;
  const values = 'enum' in schema ? schema.enum : undefined;
  if (values && !values.includes(value as string)) return `${path}: допустимо ${values.join(', ')}`;
  return null;
}

/** Runs one tool call against the campaign. Unknown tools and bad input come back as errors for the model. */
export function runTool(c: Campaign, name: string, input: unknown, rng: Rng): act.Outcome {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { result: { error: `Нет инструмента ${name}` }, entries: [], error: true };
  const problem = validate(tool.schema, input);
  if (problem) return { result: { error: `Неверные данные: ${problem}` }, entries: [], error: true };
  return tool.run(c, input, rng);
}
