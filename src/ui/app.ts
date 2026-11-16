import { ABILITIES, ABILITY_NAMES, ABILITY_SHORT, ARMORS, CLASSES, SKILLS, SKILL_IDS, WEAPONS, classById } from '../engine/content';
import { armorClass, createCharacter, modifier, proficientSave, proficientSkill, saveBonus, skillBonus, weaponAttack } from '../engine/character';
import { newCampaign, type Campaign, type Entry } from '../engine/campaign';
import type { Backend } from '../backends/backend';
import type { Store } from '../storage';

type Tab = 'play' | 'sheet' | 'journal' | 'settings';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const sign = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

/** The master's light markdown: paragraphs, **bold**, *italic*. */
function prose(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Hit points as a terminal gauge: [#######---]. */
function gauge(hp: number, max: number, width = 14): string {
  const filled = max > 0 ? Math.round((hp / max) * width) : 0;
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}

const OUTCOME: Record<Extract<Entry, { kind: 'roll' }>['outcome'], string> = {
  success: 'УСПЕХ',
  fail: 'ПРОВАЛ',
  crit: 'КРИТ',
  fumble: 'ПРОВАЛ',
  neutral: 'БРОСОК',
};

export class App {
  private campaign: Campaign | null = null;
  private loaded = false;
  private tab: Tab = 'play';
  private busy = false;
  private live = '';
  private error: { text: string; retry: string | null } | null = null;
  private draftClass = CLASSES[0].id;
  private notice: string | null = null;
  private housekeeping: Promise<boolean> | null = null;
  private stop: AbortController | null = null;

  constructor(private root: HTMLElement, private backend: Backend, private store: Store) {
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('submit', (e) => this.onSubmit(e));
    root.addEventListener('keydown', (e) => this.onKey(e));
    this.render();
    void store.load().then((c) => {
      this.campaign = c;
      this.loaded = true;
      this.render();
    });
  }

  private render(): void {
    const setup = this.backend.setupView();
    if (setup) this.root.innerHTML = `<main class="screen">${this.brandHead()}${setup}${this.notice ? `<p class="note warn">${esc(this.notice)}</p>` : ''}</main>`;
    else if (!this.loaded) this.root.innerHTML = `<main class="screen">${this.brandHead()}<p class="note">Загрузка кампании…</p></main>`;
    else if (!this.campaign) this.root.innerHTML = this.createView();
    else this.root.innerHTML = this.gameView();
    if (this.campaign && this.tab === 'play') this.scrollFeed();
  }

  private brandHead(): string {
    return `<header class="brand"><span class="eyebrow">[ ISIDACORP / ИГРА ]</span><h1>ИСИДА</h1>
      <p class="lead">Текстовая ролевая игра. Мегаполис, 2089 год. Мастер — Claude, кубики и правила 5e считает движок.</p><i class="rule"></i></header>`;
  }

  // ---- Screens -------------------------------------------------------------------

  private createView(): string {
    const def = classById(this.draftClass)!;
    return `<main class="screen">
      ${this.brandHead()}
      <form class="panel" data-form="create">
        <span class="eyebrow">[ НОВЫЙ ПЕРСОНАЖ ]</span>
        <label class="label" for="name">Имя или кличка</label>
        <input id="name" name="name" maxlength="40" placeholder="Например, Рейн" required>
        <label class="label" for="about">Кто ты · по желанию</label>
        <textarea id="about" name="about" rows="3" maxlength="400" placeholder="Внешность, прошлое, чего хочешь. Мастер вплетёт это в историю."></textarea>
        <div class="label">Класс</div>
        <div class="classes">${CLASSES.map((c) => `
          <button type="button" class="class ${c.id === this.draftClass ? 'on' : ''}" data-class="${c.id}" aria-pressed="${c.id === this.draftClass}">
            <b>${c.name}</b><span>${esc(c.tagline)}</span></button>`).join('')}</div>
        <dl class="specs">
          <dt>Хиты</dt><dd>d${def.hitDie}</dd>
          <dt>Главное</dt><dd>${ABILITY_NAMES[def.priority[0]]}</dd>
          <dt>Спасброски</dt><dd>${def.saves.map((a) => ABILITY_SHORT[a]).join(' / ')}</dd>
          <dt>Навыки</dt><dd>${def.skills.map((s) => SKILLS[s].name).join(', ')}</dd>
          <dt>Оружие</dt><dd>${def.weapons.map((w) => WEAPONS[w].name).join(', ')}</dd>
          <dt>Броня</dt><dd>${ARMORS[def.armor].name}</dd>
          <dt>Особое</dt><dd>«${def.feature.name}»: ${esc(def.feature.text)}</dd>
        </dl>
        <button class="btn primary" type="submit">Войти в город</button>
      </form>
    </main>`;
  }

  private gameView(): string {
    const c = this.campaign!;
    const ch = c.character;
    const def = classById(ch.classId)!;
    const low = ch.hp === 0 || ch.hp / ch.maxHp <= 0.35;
    const tabs: [Tab, string][] = [['play', 'Игра'], ['sheet', 'Персонаж'], ['journal', 'Журнал'], ['settings', 'Меню']];
    const body = this.tab === 'play' ? this.playView() : this.tab === 'sheet' ? this.sheetView() : this.tab === 'journal' ? this.journalView() : this.settingsView();
    return `<div class="game">
      <header class="hud">
        <div class="who"><b>${esc(ch.name)}</b><span>${def.name} · ${ch.level} ур.</span></div>
        <div class="stats"><span>КД <b>${armorClass(ch)}</b></span><span><b>${ch.credits}</b>¥</span></div>
        <div class="hp ${low ? 'low' : ''}" aria-label="Хиты ${ch.hp} из ${ch.maxHp}"><span class="gauge">${gauge(ch.hp, ch.maxHp)}</span><span>ХИТЫ ${ch.hp}/${ch.maxHp}</span></div>
      </header>
      <nav class="tabs">${tabs.map(([id, name]) => `<button class="tab ${this.tab === id ? 'on' : ''}" data-tab="${id}">${name}</button>`).join('')}</nav>
      ${body}
    </div>`;
  }

  private playView(): string {
    const c = this.campaign!;
    const last = [...c.feed].reverse().find((e) => e.kind === 'gm') as Extract<Entry, { kind: 'gm' }> | undefined;
    const choices = !this.busy && !c.character.dead && last ? last.choices : [];
    const combat = c.combat
      ? `<div class="combat"><span class="round">РАУНД ${c.combat.round}</span>${c.combat.order.map((o, i) => {
          const e = c.combat!.enemies.find((x) => x.id === o.id);
          const hp = o.id === 'player' ? `${c.character.hp}/${c.character.maxHp}` : `${e!.hp}/${e!.maxHp}`;
          return `<span class="${i === c.combat!.turn ? 'now' : ''} ${e && e.hp === 0 ? 'out' : ''}">${esc(o.name)} ${hp}</span>`;
        }).join('')}</div>`
      : '';
    const start = c.feed.length === 0 && !this.busy && !this.error
      ? `<div class="start"><span class="eyebrow">[ СИГНАЛ ]</span><p>Исида ждёт. Мастер откроет первую сцену.</p><button class="btn primary" data-act="start">Начать кампанию</button></div>` : '';
    const dead = c.character.dead ? `<div class="banner">Персонаж погиб. Можно дослушать мастера или начать заново в меню.</div>` : '';
    const error = this.error
      ? `<div class="banner">${esc(this.error.text)}${this.error.retry !== null ? ' <button class="btn small" data-act="retry">Повторить</button>' : ''}</div>` : '';
    const thinking = `<p class="thinking">&gt; мастер думает<span class="cursor">_</span></p>`;
    const disabled = this.busy || c.feed.length === 0;
    return `<section class="feed" id="feed" aria-live="polite">
        ${c.feed.map((e) => this.entryView(e)).join('')}
        ${this.busy ? `<article class="gm live">${this.live.trim() ? prose(this.live.replace(/\n▸[^\n]*/g, '')) : thinking}</article>` : ''}
        ${start}${dead}${error}
      </section>
      ${combat}
      ${choices.length ? `<div class="choices">${choices.map((t) => `<button class="choice" data-say="${esc(t)}">▸ ${esc(t)}</button>`).join('')}</div>` : ''}
      <form class="composer" data-form="say">
        <span class="prompt" aria-hidden="true">&gt;</span>
        <textarea id="say" name="text" rows="1" aria-label="Что делаешь" placeholder="${this.busy ? 'мастер говорит…' : 'что делаешь?'}" ${disabled ? 'disabled' : ''}></textarea>
        ${this.busy && this.stop ? `<button class="btn send" type="button" data-act="stop">СТОП</button>` : `<button class="btn send" type="submit" ${disabled ? 'disabled' : ''}>ВВОД</button>`}
      </form>`;
  }

  private entryView(e: Entry): string {
    switch (e.kind) {
      case 'gm':
        return `<article class="gm">${prose(e.text)}</article>`;
      case 'player':
        return `<article class="player"><span>&gt;</span> ${esc(e.text)}</article>`;
      case 'roll':
        return `<article class="roll ${e.outcome}"><div class="roll-head"><span>${esc(e.title)}</span><b>[${OUTCOME[e.outcome]}]</b></div><div class="roll-detail">${esc(e.detail)}</div></article>`;
      case 'system':
        return `<article class="system">// ${esc(e.text)}</article>`;
    }
  }

  private sheetView(): string {
    const ch = this.campaign!.character;
    const def = classById(ch.classId)!;
    return `<section class="page">
      <div class="abilities">${ABILITIES.map((a) => `<div class="ability ${proficientSave(ch, a) ? 'prof' : ''}"><span>${ABILITY_SHORT[a]}</span><b>${sign(modifier(ch.abilities[a]))}</b><small>${ch.abilities[a]} · спас ${sign(saveBonus(ch, a))}</small></div>`).join('')}</div>
      <h2 class="label">Навыки</h2>
      <ul class="rows">${SKILL_IDS.map((s) => `<li class="${proficientSkill(ch, s) ? 'prof' : ''}"><span>${SKILLS[s].name} <small>${ABILITY_SHORT[SKILLS[s].ability]}</small></span><b>${sign(skillBonus(ch, s))}</b></li>`).join('')}</ul>
      <h2 class="label">Оружие</h2>
      <ul class="rows">${ch.weapons.map((w) => { const a = weaponAttack(ch, w); return `<li><span>${esc(WEAPONS[w]?.name ?? w)}</span><b>${sign(a?.bonus ?? 0)} · ${esc(a?.damage ?? '')}</b></li>`; }).join('')}</ul>
      <h2 class="label">«${def.feature.name}» · ${ch.featureUses}/${def.feature.uses}</h2>
      <p class="note">${esc(def.feature.text)}. Заряды возвращает ${def.feature.recharge === 'short' ? 'короткий' : 'долгий'} отдых.</p>
      <h2 class="label">Снаряжение</h2>
      <ul class="rows">${ch.inventory.map((i) => `<li><span>${esc(i)}</span></li>`).join('') || '<li class="note">пусто</li>'}<li><span>${ARMORS[ch.armor]?.name ?? ''}</span><b>КД ${armorClass(ch)}</b></li></ul>
      <p class="note">Опыт ${ch.xp}. ${ch.about ? esc(ch.about) : ''}</p>
    </section>`;
  }

  private journalView(): string {
    const c = this.campaign!;
    const quests = c.quests.length
      ? c.quests.map((q) => `<li class="quest ${q.status}"><b>${esc(q.title)}</b><span>${q.status === 'done' ? '[ВЫПОЛНЕНО]' : q.status === 'failed' ? '[ПРОВАЛЕНО]' : esc(q.note)}</span></li>`).join('')
      : '<li class="note">Пока нет</li>';
    const facts = c.facts.length ? c.facts.map((f) => `<li><span>${esc(f)}</span></li>`).join('') : '<li class="note">Пока нет</li>';
    return `<section class="page">
      <p class="note">Сейчас: ${esc(c.location)}</p>
      <h2 class="label">Задания</h2><ul class="rows quests">${quests}</ul>
      <h2 class="label">Запомнил мастер</h2><ul class="rows">${facts}</ul>
      ${c.summary ? `<h2 class="label">Летопись</h2><p class="chronicle">${esc(c.summary)}</p>` : ''}
      <h2 class="label">Расход</h2><p class="note">${esc(this.backend.costNote(c))}</p>
    </section>`;
  }

  private settingsView(): string {
    return `<section class="page">
      ${this.backend.settingsView()}
      <h2 class="label">Кампания</h2>
      ${this.notice === 'confirm-new'
        ? `<p class="note warn">Текущая кампания будет удалена без возврата.</p><div class="row"><button class="btn danger" data-act="new-confirmed">Удалить и начать заново</button><button class="btn" data-act="new-cancel">Отмена</button></div>`
        : `<button class="btn" data-act="new-campaign">Начать новую кампанию</button>`}
      <p class="note small">ISIDACORP — INDEPENDENT GAMES · BUILD ${esc(__BUILD_ID__)}</p>
      <p class="note small">Механика основана на SRD 5.2 © Wizards of the Coast LLC, лицензия CC-BY-4.0. Мир и тексты игры оригинальные.</p>
    </section>`;
  }

  // ---- Events --------------------------------------------------------------------

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tab],[data-act],[data-class],[data-say]');
    if (!el) return;
    const act = el.dataset.act;
    if (el.dataset.tab) {
      this.tab = el.dataset.tab as Tab;
      this.notice = null;
      this.render();
    } else if (el.dataset.class) {
      const name = (this.root.querySelector('#name') as HTMLInputElement | null)?.value ?? '';
      const about = (this.root.querySelector('#about') as HTMLTextAreaElement | null)?.value ?? '';
      this.draftClass = el.dataset.class;
      this.render();
      (this.root.querySelector('#name') as HTMLInputElement).value = name;
      (this.root.querySelector('#about') as HTMLTextAreaElement).value = about;
    } else if (el.dataset.say) void this.say(el.dataset.say);
    else if (act === 'start') void this.say(null);
    else if (act === 'retry' && this.error) void this.say(this.error.retry === '' ? null : this.error.retry);
    else if (act === 'stop') this.stop?.abort();
    else if (act === 'new-campaign') {
      this.notice = 'confirm-new';
      this.render();
    } else if (act === 'new-cancel') {
      this.notice = null;
      this.render();
    } else if (act === 'new-confirmed') {
      this.campaign = null;
      void this.store.save(null);
      this.tab = 'play';
      this.error = null;
      this.notice = null;
      this.render();
    } else if (act && this.backend.act(act)) this.render();
  }

  private onKey(e: KeyboardEvent): void {
    // Enter sends, Shift+Enter breaks the line.
    const t = e.target as HTMLElement;
    if (t.id === 'say' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      (t.closest('form') as HTMLFormElement).requestSubmit();
    }
  }

  private onSubmit(e: Event): void {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    switch (form.dataset.form) {
      case 'setup':
        this.notice = this.backend.setup(data);
        this.render();
        break;
      case 'create':
        this.campaign = newCampaign(createCharacter(String(data.get('name') ?? ''), this.draftClass, String(data.get('about') ?? '')));
        void this.store.save(this.campaign);
        this.render();
        break;
      case 'say': {
        const text = String(data.get('text') ?? '').trim();
        if (text) void this.say(text);
        break;
      }
      case 'settings':
        this.backend.saveSettings(data);
        this.tab = 'play';
        this.render();
        break;
    }
  }

  /** One turn: null opens the campaign. */
  private async say(text: string | null): Promise<void> {
    const c = this.campaign;
    if (!c || this.busy) return;
    this.busy = true;
    this.live = '';
    this.error = null;
    this.stop = new AbortController();
    this.render();
    try {
      // Old scenes are folded into the summary first if that was still running.
      if (this.housekeeping) await this.housekeeping;
      await this.backend.play(c, text, {
        signal: this.stop.signal,
        onText: (d) => {
          this.live += d;
          this.updateLive();
        },
        onEntry: (entry) => {
          if (entry.kind === 'gm') this.live = '';
          this.render();
        },
      });
      if (!(await this.store.save(c))) this.error = { text: 'Не удалось сохранить прогресс. Проверь связь или память телефона.', retry: null };
      this.housekeeping = this.backend.afterTurn(c).then(async (changed) => {
        if (changed) await this.store.save(c);
        this.housekeeping = null;
        return changed;
      });
    } catch (err) {
      const d = this.backend.describe(err);
      this.error = { text: d.text, retry: d.retry ? (text ?? '') : null };
    } finally {
      this.busy = false;
      this.stop = null;
      this.live = '';
      this.render();
    }
  }

  private updateLive(): void {
    const el = this.root.querySelector('.gm.live');
    if (!el) return this.render();
    if (this.live.trim()) el.innerHTML = prose(this.live.replace(/\n▸[^\n]*/g, ''));
    this.scrollFeed();
  }

  private scrollFeed(): void {
    const feed = this.root.querySelector('#feed');
    if (feed) feed.scrollTop = feed.scrollHeight;
  }
}
