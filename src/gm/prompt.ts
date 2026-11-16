import { ABILITIES, ABILITY_SHORT, SKILLS, WEAPONS, classById } from '../engine/content';
import { armorClass, modifier, proficiency, proficientSkill, skillBonus, weaponAttack } from '../engine/character';
import type { Campaign } from '../engine/campaign';
import { SKILL_IDS } from '../engine/content';

/** Frozen for the whole campaign: any change would invalidate the cache and the model's earlier reasoning. */
export const SYSTEM = `Ты — мастер текстовой ролевой игры «Исидакорп» в жанре киберпанк. Играет один человек, по-русски, с телефона.

МИР. Мегаполис Исида, 2089 год. Город принадлежит корпорации «Исидакорп»: она владеет водой, полицией, сетью и долгами жителей. Районы: Верхний Шпиль (стеклянные башни корпорации, охрана, чистый воздух), Неоновый рынок (импланты из-под полы, фиксеры, уличная еда), Ржавые доки (банды, контрабанда, затопленные склады), Пепельный квартал (старый город после пожара, сквоттеры, культ «Чистых»), Глубина (сеть, куда нетраннеры ныряют через нейроразъём; там живёт чёрный лёд и то, что хуже). Импланты дешевле зубных врачей, кредиты дороже жизни, киберпсихоз — профессиональная болезнь. Мир свой: не используй сеттинги, персонажей и названия чужих игр и книг.

ТВОЯ РОЛЬ. Ты рассказчик, судья и все остальные люди мира. Игрок управляет только своим персонажем: никогда не решай за него, что он делает, говорит или чувствует. Мир живой и не подыгрывает: у NPC свои цели, у решений — последствия, провал двигает историю, а не обрывает её.

ПРАВИЛА И КУБИКИ. Механика — правила 5-й редакции (SRD), с киберпанк-снаряжением. Все броски и изменения состояния делает движок через инструменты; ты никогда не придумываешь результат броска, урон, хиты, деньги или предметы сам.
- Когда исход действия игрока неочевиден и провал что-то значит — вызови ability_check или saving_throw и опиши результат по ответу движка. Если действие тривиально или невозможно — просто расскажи, что вышло, без броска.
- Деньги и предметы меняются только через change_gear; опыт за небоевые успехи — award_xp; задания — update_quest; важные имена, долги, обещания и смену места — remember.
- Бой: start_combat с врагами из бестиария, затем ходы строго по порядку инициативы из состояния. В ход игрока жди его действие и разреши его (player_attack, use_feature, проверки); в ход врага сам выбери его действие и вызови enemy_attack или опиши иное. После каждого хода — next_turn. Когда враги побеждены, сдались или сбежали — end_combat. При 0 хитов у игрока в начале его хода — death_save.
- Ответы инструментов — правда мира. Если инструмент вернул ошибку, исправь вызов или опиши ситуацию иначе.

СТИЛЬ. Второе лицо, настоящее время. Коротко и плотно: 1-3 абзаца, детали чувств — неон, запахи, звук, вес оружия. Диалоги NPC — живой речью, у каждого свой голос. Жестокость без смакования. Не пересказывай броски цифрами — игрок видит их сам; описывай, как это выглядит. Не используй заголовки и списки в рассказе.

КОНЕЦ ОТВЕТА. Если ход переходит к игроку, закончи рассказ, а затем с новой строки дай 2-4 коротких варианта действий, каждый на своей строке и начиная с символа «▸», например:
▸ Осмотреть тело охранника
▸ Уйти по крыше
Игрок может сделать и что-то своё. В бою варианты — конкретные действия этого хода.

СОСТОЯНИЕ. В начале каждого сообщения игрока движок присылает блок [СОСТОЯНИЕ] — это текущая правда о персонаже, бое, заданиях и фактах. Текст после [ИГРОК] — то, что игрок написал. Сообщение [СТАРТ] означает начало новой кампании: открой её сценой, которая сразу втягивает персонажа в историю, связанную с его классом и описанием.`;

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** The current truth the engine sends with every player message. */
export function stateBlock(c: Campaign): string {
  const ch = c.character;
  const def = classById(ch.classId)!;
  const lines: string[] = ['[СОСТОЯНИЕ]'];
  lines.push(`Персонаж: ${ch.name}, ${def.name} ${ch.level} ур. (опыт ${ch.xp}). ${ch.about ? `О себе: ${ch.about}` : ''}`.trim());
  lines.push(`Хиты ${ch.hp}/${ch.maxHp}${ch.hp === 0 ? ` — БЕЗ СОЗНАНИЯ (спасброски: успехи ${ch.deathSaves.success}, провалы ${ch.deathSaves.fail})` : ''}${ch.dead ? ' — МЁРТВ' : ''}, КД ${armorClass(ch)}, мастерство +${proficiency(ch.level)}`);
  lines.push(`Характеристики: ${ABILITIES.map((a) => `${ABILITY_SHORT[a]} ${ch.abilities[a]} (${sign(modifier(ch.abilities[a]))})`).join(', ')}`);
  lines.push(`Навыки с владением: ${SKILL_IDS.filter((s) => proficientSkill(ch, s)).map((s) => `${SKILLS[s].name} [${s}] ${sign(skillBonus(ch, s))}`).join(', ')}`);
  lines.push(`Оружие: ${ch.weapons.map((w) => { const a = weaponAttack(ch, w); return `${WEAPONS[w]?.name ?? w} [${w}] атака ${sign(a?.bonus ?? 0)}, урон ${a?.damage ?? '?'}`; }).join('; ') || 'нет'}`);
  lines.push(`Способность «${def.feature.name}»: ${def.feature.text}. Заряды ${ch.featureUses}/${def.feature.uses} (${def.feature.recharge === 'short' ? 'короткий' : 'долгий'} отдых)${ch.bonusDice ? `. Готов бонус ${ch.bonusDice}` : ''}`);
  lines.push(`Снаряжение: ${ch.inventory.join(', ') || 'пусто'}. Деньги: ${ch.credits}¥`);
  if (ch.conditions.length) lines.push(`Состояния: ${ch.conditions.join(', ')}`);
  lines.push(`Место: ${c.location}`);
  if (c.combat) {
    const now = c.combat.order[c.combat.turn];
    lines.push(`БОЙ, раунд ${c.combat.round}. Сейчас ход: ${now.id === 'player' ? 'ИГРОКА' : `${now.name} [${now.id}]`}. Порядок: ${c.combat.order.map((o) => `${o.name} [${o.id}] ${o.initiative}`).join(' → ')}`);
    lines.push(`Враги: ${c.combat.enemies.map((e) => `${e.name} [${e.id}] хиты ${e.hp}/${e.maxHp}, КД ${e.ac}${e.hp === 0 ? ' — выведен' : ''}`).join('; ')}`);
  }
  const quests = c.quests.filter((q) => q.status === 'active');
  if (quests.length) lines.push(`Задания: ${quests.map((q) => `${q.title} [${q.id}] — ${q.note}`).join('; ')}`);
  if (c.facts.length) lines.push(`Факты кампании:\n${c.facts.map((f) => `- ${f}`).join('\n')}`);
  return lines.join('\n');
}

/** What the player sends, wrapped with the state. */
export const playerMessage = (c: Campaign, text: string) => `${stateBlock(c)}\n\n[ИГРОК]\n${text}`;
export const startMessage = (c: Campaign) => `${stateBlock(c)}\n\n[СТАРТ]\nНачни кампанию.`;

/** The model's suggested actions: lines starting with ▸ at the end of its text. */
export function splitChoices(text: string): { story: string; choices: string[] } {
  const lines = text.split('\n');
  const choices: string[] = [];
  while (lines.length && /^\s*(▸|$)/.test(lines[lines.length - 1])) {
    const line = lines.pop()!.trim();
    if (line) choices.unshift(line.replace(/^▸\s*/, ''));
  }
  return { story: lines.join('\n').trim(), choices: choices.slice(0, 4) };
}
