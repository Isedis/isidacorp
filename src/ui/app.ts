import Anthropic from '@anthropic-ai/sdk';
import { ABILITIES, ABILITY_SHORT, CLASSES, SKILLS, SKILL_IDS, WEAPONS, classById, ARMORS, ABILITY_NAMES } from '../engine/content';
import { armorClass, createCharacter, modifier, proficientSave, proficientSkill, saveBonus, skillBonus, weaponAttack } from '../engine/character';
import { newCampaign, type Campaign, type Entry } from '../engine/campaign';
import { MODELS, RefusedError, TruncatedError, playTurn, type Effort, type GmClient, type ModelId, type Settings } from '../gm/session';
import { loadCampaign, loadKey, loadSettings, saveCampaign, saveKey, saveSettings } from '../storage';

type Tab = 'play' | 'sheet' | 'journal' | 'settings';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const sign = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

/** The model's light markdown: paragraphs, **bold**, *italic*, «dialogue» lines kept as they are. */
function prose(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim()).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export class App {
  private key = loadKey();
  private settings: Settings = loadSettings();
  private campaign: Campaign | null = loadCampaign();
  private tab: Tab = 'play';
  private busy = false;
  private live = '';
  private error: { text: string; retry: string | null } | null = null;
  private draftClass = CLASSES[0].id;
  private client: GmClient | null = null;

  constructor(private root: HTMLElement) {
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('submit', (e) => this.onSubmit(e));
    this.render();
  }

  private gm(): GmClient {
    if (!this.client) this.client = new Anthropic({ apiKey: this.key!, dangerouslyAllowBrowser: true, maxRetries: 2 }) as unknown as GmClient;
    return this.client;
  }

  private render(): void {
    if (!this.key) this.root.innerHTML = this.connectView();
    else if (!this.campaign) this.root.innerHTML = this.createView();
    else this.root.innerHTML = this.gameView();
    if (this.campaign && this.tab === 'play') this.scrollFeed();
  }

  // ---- Screens -------------------------------------------------------------------

  private connectView(): string {
    return `<main class="screen intro">
      <h1 class="logo">ИСИДАКОРП</h1>
      <p class="lead">Текстовая ролевая игра в киберпанке. Мастер — нейросеть Claude, кубики и правила 5e считает движок.</p>
      <form class="card" data-form="connect">
        <label class="label" for="key">Ключ API Anthropic</label>
        <input id="key" name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" required>
        <p class="hint">Создай на console.anthropic.com → API Keys. Ключ хранится только на этом телефоне и уходит напрямую в Anthropic. Игра оплачивается с твоего счёта API.</p>
        ${this.modelPicker()}
        <button class="btn primary" type="submit">Подключиться</button>
      </form>
    </main>`;
  }

  private modelPicker(): string {
    return `<fieldset class="models"><legend class="label">Модель мастера</legend>${MODELS.map((m) => `
      <label class="model"><input type="radio" name="model" value="${m.id}" ${m.id === this.settings.model ? 'checked' : ''}>
        <span><b>${m.name}</b> · ${m.note}</span></label>`).join('')}</fieldset>`;
  }

  private createView(): string {
    const def = classById(this.draftClass)!;
    return `<main class="screen create">
      <h1 class="title">Новый персонаж</h1>
      <form class="card" data-form="create">
        <label class="label" for="name">Имя или кличка</label>
        <input id="name" name="name" maxlength="40" placeholder="Например, Рейн" required>
        <label class="label" for="about">Кто ты (по желанию)</label>
        <textarea id="about" name="about" rows="3" maxlength="400" placeholder="Внешность, прошлое, чего хочешь. Мастер вплетёт это в историю."></textarea>
        <div class="label">Класс</div>
        <div class="classes">${CLASSES.map((c) => `
          <button type="button" class="class ${c.id === this.draftClass ? 'on' : ''}" data-class="${c.id}">
            <b>${c.name}</b><span>${esc(c.tagline)}</span></button>`).join('')}</div>
        <div class="class-detail">
          <div>Хиты d${def.hitDie} · главное: ${ABILITY_NAMES[def.priority[0]]} · спасброски: ${def.saves.map((a) => ABILITY_SHORT[a]).join(', ')}</div>
          <div>Навыки: ${def.skills.map((s) => SKILLS[s].name).join(', ')}</div>
          <div>Оружие: ${def.weapons.map((w) => WEAPONS[w].name).join(', ')} · ${ARMORS[def.armor].name}</div>
          <div>«${def.feature.name}»: ${esc(def.feature.text)}</div>
        </div>
        <button class="btn primary" type="submit">В город</button>
      </form>
    </main>`;
  }

  private gameView(): string {
    const c = this.campaign!;
    const ch = c.character;
    const def = classById(ch.classId)!;
    const hpPct = Math.round((ch.hp / ch.maxHp) * 100);
    const tabs: [Tab, string][] = [['play', 'Игра'], ['sheet', 'Персонаж'], ['journal', 'Журнал'], ['settings', 'Настройки']];
    const body = this.tab === 'play' ? this.playView() : this.tab === 'sheet' ? this.sheetView() : this.tab === 'journal' ? this.journalView() : this.settingsView();
    return `<div class="game">
      <header class="hud">
        <div class="who"><b>${esc(ch.name)}</b><span>${def.name} · ${ch.level} ур.</span></div>
        <div class="hp ${ch.hp === 0 ? 'down' : hpPct <= 35 ? 'low' : ''}" aria-label="Хиты ${ch.hp} из ${ch.maxHp}">
          <div class="hp-bar"><i style="width:${hpPct}%"></i></div><span>${ch.hp}/${ch.maxHp}</span></div>
        <div class="stat">КД <b>${armorClass(ch)}</b></div>
        <div class="stat"><b>${ch.credits}</b>¥</div>
      </header>
      <nav class="tabs">${tabs.map(([id, name]) => `<button class="tab ${this.tab === id ? 'on' : ''}" data-tab="${id}">${name}</button>`).join('')}</nav>
      ${body}
    </div>`;
  }

  private playView(): string {
    const c = this.campaign!;
    const last = [...c.feed].reverse().find((e) => e.kind === 'gm') as Extract<Entry, { kind: 'gm' }> | undefined;
    const choices = !this.busy && last ? last.choices : [];
    const combat = c.combat
      ? `<div class="combat">Раунд ${c.combat.round} · ${c.combat.order.map((o, i) => {
          const e = c.combat!.enemies.find((x) => x.id === o.id);
          const hp = o.id === 'player' ? `${c.character.hp}/${c.character.maxHp}` : `${e!.hp}/${e!.maxHp}`;
          return `<span class="${i === c.combat!.turn ? 'now' : ''} ${e && e.hp === 0 ? 'out' : ''}">${esc(o.name)} ${hp}</span>`;
        }).join('')}</div>`
      : '';
    const start = c.feed.length === 0 && !this.busy && !this.error
      ? `<div class="start"><p>Исида ждёт. Мастер откроет первую сцену.</p><button class="btn primary" data-act="start">Начать кампанию</button></div>` : '';
    const dead = c.character.dead ? `<div class="banner dead">Персонаж погиб. Можно дослушать мастера или начать заново в настройках.</div>` : '';
    const error = this.error
      ? `<div class="banner error">${esc(this.error.text)}${this.error.retry !== null ? ' <button class="btn small" data-act="retry">Повторить</button>' : ''}</div>` : '';
    return `<section class="feed" id="feed">
        ${c.feed.map((e) => this.entryView(e)).join('')}
        ${this.busy ? `<article class="gm live">${this.live ? prose(this.live) : '<p class="thinking">Мастер думает<span>…</span></p>'}</article>` : ''}
        ${start}${dead}${error}
      </section>
      ${combat}
      ${choices.length ? `<div class="choices">${choices.map((t) => `<button class="choice" data-say="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <form class="composer" data-form="say">
        <textarea name="text" rows="1" placeholder="${this.busy ? 'Мастер говорит…' : 'Что делаешь?'}" ${this.busy || c.feed.length === 0 ? 'disabled' : ''}></textarea>
        <button class="btn send" type="submit" ${this.busy || c.feed.length === 0 ? 'disabled' : ''} aria-label="Отправить">➤</button>
      </form>`;
  }

  private entryView(e: Entry): string {
    switch (e.kind) {
      case 'gm':
        return `<article class="gm">${prose(e.text)}</article>`;
      case 'player':
        return `<article class="player">${esc(e.text)}</article>`;
      case 'roll':
        return `<article class="roll ${e.outcome}"><div class="roll-title">🎲 ${esc(e.title)}</div><div class="roll-detail">${esc(e.detail)}</div></article>`;
      case 'system':
        return `<article class="system">${esc(e.text)}</article>`;
    }
  }

  private sheetView(): string {
    const ch = this.campaign!.character;
    const def = classById(ch.classId)!;
    return `<section class="page">
      <div class="abilities">${ABILITIES.map((a) => `<div class="ability ${proficientSave(ch, a) ? 'prof' : ''}"><span>${ABILITY_SHORT[a]}</span><b>${sign(modifier(ch.abilities[a]))}</b><small>${ch.abilities[a]} · спас ${sign(saveBonus(ch, a))}</small></div>`).join('')}</div>
      <h2>Навыки</h2>
      <ul class="skills">${SKILL_IDS.map((s) => `<li class="${proficientSkill(ch, s) ? 'prof' : ''}"><span>${SKILLS[s].name} <small>${ABILITY_SHORT[SKILLS[s].ability]}</small></span><b>${sign(skillBonus(ch, s))}</b></li>`).join('')}</ul>
      <h2>Оружие</h2>
      <ul class="list">${ch.weapons.map((w) => { const a = weaponAttack(ch, w); return `<li><span>${esc(WEAPONS[w]?.name ?? w)}</span><b>${sign(a?.bonus ?? 0)} · ${esc(a?.damage ?? '')}</b></li>`; }).join('')}</ul>
      <h2>«${def.feature.name}» · ${ch.featureUses}/${def.feature.uses}</h2>
      <p class="muted">${esc(def.feature.text)}. Заряды возвращает ${def.feature.recharge === 'short' ? 'короткий' : 'долгий'} отдых.</p>
      <h2>Снаряжение</h2>
      <ul class="list">${ch.inventory.map((i) => `<li>${esc(i)}</li>`).join('') || '<li class="muted">пусто</li>'}<li><span>${ARMORS[ch.armor]?.name ?? ''}</span><b>КД ${armorClass(ch)}</b></li></ul>
      <p class="muted">Опыт: ${ch.xp}. ${ch.about ? esc(ch.about) : ''}</p>
    </section>`;
  }

  private journalView(): string {
    const c = this.campaign!;
    const quests = c.quests.length
      ? c.quests.map((q) => `<li class="quest ${q.status}"><b>${esc(q.title)}</b><span>${q.status === 'done' ? 'выполнено' : q.status === 'failed' ? 'провалено' : esc(q.note)}</span></li>`).join('')
      : '<li class="muted">Пока нет</li>';
    const facts = c.facts.length ? c.facts.map((f) => `<li>${esc(f)}</li>`).join('') : '<li class="muted">Пока нет</li>';
    return `<section class="page">
      <p class="muted">Сейчас: ${esc(c.location)}</p>
      <h2>Задания</h2><ul class="list quests">${quests}</ul>
      <h2>Запомнил мастер</h2><ul class="list facts">${facts}</ul>
      <h2>Расход</h2>
      <p class="muted">Примерно $${c.usage.dollars.toFixed(2)} за кампанию · ${Math.round((c.usage.input + c.usage.cacheRead + c.usage.cacheWrite) / 1000)} тыс. токенов на входе (из кэша ${Math.round(c.usage.cacheRead / 1000)} тыс.), ${Math.round(c.usage.output / 1000)} тыс. на выходе.</p>
    </section>`;
  }

  private settingsView(): string {
    const efforts: [Effort, string][] = [['low', 'Быстро'], ['medium', 'Обычно'], ['high', 'Вдумчиво']];
    return `<section class="page">
      <form data-form="settings">
        ${this.modelPicker()}
        <fieldset class="models"><legend class="label">Насколько мастер обдумывает ход</legend>
          ${efforts.map(([id, name]) => `<label class="model"><input type="radio" name="effort" value="${id}" ${this.settings.effort === id ? 'checked' : ''}><span>${name}</span></label>`).join('')}
        </fieldset>
        <button class="btn" type="submit">Сохранить</button>
      </form>
      <h2>Ключ API</h2>
      <p class="muted">Ключ хранится на этом телефоне: ${esc(this.key!.slice(0, 10))}…</p>
      <button class="btn" data-act="forget-key">Заменить ключ</button>
      <h2>Кампания</h2>
      <button class="btn danger" data-act="new-campaign">Начать новую кампанию</button>
      <p class="muted">Версия ${__BUILD_ID__}. <button class="link" data-act="reload">Обновить игру</button></p>
      <p class="muted small">Механика основана на SRD 5.2 © Wizards of the Coast LLC, лицензия CC-BY-4.0. Мир и тексты игры оригинальные.</p>
    </section>`;
  }

  // ---- Events --------------------------------------------------------------------

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tab],[data-act],[data-class],[data-say]');
    if (!el) return;
    if (el.dataset.tab) {
      this.tab = el.dataset.tab as Tab;
      this.render();
    } else if (el.dataset.class) {
      const form = this.root.querySelector<HTMLFormElement>('[data-form="create"]');
      const draft = form ? { name: (form.elements.namedItem('name') as HTMLInputElement).value, about: (form.elements.namedItem('about') as HTMLTextAreaElement).value } : null;
      this.draftClass = el.dataset.class;
      this.render();
      if (draft) {
        (this.root.querySelector('#name') as HTMLInputElement).value = draft.name;
        (this.root.querySelector('#about') as HTMLTextAreaElement).value = draft.about;
      }
    } else if (el.dataset.say) void this.say(el.dataset.say);
    else if (el.dataset.act === 'start') void this.say(null);
    else if (el.dataset.act === 'retry' && this.error) void this.say(this.error.retry === '' ? null : this.error.retry);
    else if (el.dataset.act === 'forget-key' && confirm('Удалить ключ с телефона? Кампания останется.')) {
      saveKey(null);
      this.key = null;
      this.client = null;
      this.render();
    } else if (el.dataset.act === 'new-campaign' && confirm('Начать заново? Текущая кампания будет удалена.')) {
      this.campaign = null;
      saveCampaign(null);
      this.tab = 'play';
      this.error = null;
      this.render();
    } else if (el.dataset.act === 'reload') location.reload();
  }

  private onSubmit(e: Event): void {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    switch (form.dataset.form) {
      case 'connect': {
        const key = String(data.get('key') ?? '').trim();
        if (!key.startsWith('sk-ant-')) {
          alert('Ключ Anthropic начинается с sk-ant-');
          return;
        }
        this.key = key;
        saveKey(key);
        this.settings.model = (data.get('model') as ModelId) ?? this.settings.model;
        saveSettings(this.settings);
        this.render();
        break;
      }
      case 'create': {
        this.campaign = newCampaign(createCharacter(String(data.get('name') ?? ''), this.draftClass, String(data.get('about') ?? '')));
        saveCampaign(this.campaign);
        this.render();
        break;
      }
      case 'say': {
        const text = String(data.get('text') ?? '').trim();
        if (text) void this.say(text);
        break;
      }
      case 'settings': {
        this.settings = { model: (data.get('model') as ModelId) ?? this.settings.model, effort: (data.get('effort') as Effort) ?? this.settings.effort };
        saveSettings(this.settings);
        this.tab = 'play';
        this.render();
        break;
      }
    }
  }

  /** One turn: null opens the campaign. */
  private async say(text: string | null): Promise<void> {
    const c = this.campaign;
    if (!c || this.busy) return;
    this.busy = true;
    this.live = '';
    this.error = null;
    this.render();
    try {
      await playTurn(this.gm(), c, text, this.settings, Math.random, {
        onText: (d) => {
          this.live += d;
          this.updateLive();
        },
        onEntry: (entry) => {
          if (entry.kind === 'gm') this.live = '';
          saveCampaign(c);
          this.render();
        },
      });
      if (!saveCampaign(c)) this.error = { text: 'Память телефона заполнена: прогресс не сохранился.', retry: null };
    } catch (err) {
      this.error = { text: describe(err), retry: text ?? '' };
    } finally {
      this.busy = false;
      this.live = '';
      this.render();
    }
  }

  private updateLive(): void {
    const el = this.root.querySelector('.gm.live');
    if (!el) return this.render();
    el.innerHTML = prose(this.live.replace(/\n▸[^\n]*/g, ''));
    this.scrollFeed();
  }

  private scrollFeed(): void {
    const feed = this.root.querySelector('#feed');
    if (feed) feed.scrollTop = feed.scrollHeight;
  }
}

function describe(err: unknown): string {
  if (err instanceof RefusedError) return 'Мастер отказался вести эту сцену. Попробуй сформулировать иначе.';
  if (err instanceof TruncatedError) return 'Ответ мастера оборвался. Попробуй ещё раз.';
  if (err instanceof Anthropic.AuthenticationError) return 'Ключ API не подошёл. Проверь его в настройках.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'У ключа нет доступа к этой модели. Выбери другую в настройках.';
  if (err instanceof Anthropic.RateLimitError) return 'Слишком много запросов или кончился лимит. Подожди минуту.';
  if (err instanceof Anthropic.BadRequestError) return `Запрос отклонён: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Нет связи с сервером. Проверь интернет.';
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return 'Сервер Anthropic перегружен или недоступен. Попробуй ещё раз через минуту.';
  if (err instanceof Anthropic.APIError) return `Ошибка API ${err.status ?? ''}: ${err.message}`;
  return `Что-то пошло не так: ${err instanceof Error ? err.message : String(err)}`;
}
