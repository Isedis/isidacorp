import Anthropic from '@anthropic-ai/sdk';
import type { Campaign } from '../engine/campaign';
import { MODELS, RefusedError, TruncatedError, playTurn, type Effort, type GmClient, type ModelId, type Settings } from '../gm/session';
import { readLocal, writeLocal } from '../storage';
import type { Backend, TurnHooks } from './backend';

const KEY = 'isidacorp-api-key';
const SETTINGS = 'isidacorp-settings';
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function loadSettings(): Settings {
  try {
    const s = JSON.parse(readLocal(SETTINGS) ?? '{}');
    return {
      model: MODELS.some((m) => m.id === s.model) ? s.model : 'claude-opus-5-5',
      effort: ['low', 'medium', 'high'].includes(s.effort) ? s.effort : 'medium',
    };
  } catch {
    return { model: 'claude-opus-5-5', effort: 'medium' };
  }
}

/** The game master through the player's own Anthropic API key, kept on the phone. */
export class ApiBackend implements Backend {
  private key = readLocal(KEY);
  private settings = loadSettings();
  private client: GmClient | null = null;

  private gm(): GmClient {
    this.client ??= new Anthropic({ apiKey: this.key!, dangerouslyAllowBrowser: true, maxRetries: 2 }) as unknown as GmClient;
    return this.client;
  }

  private modelPicker(): string {
    return `<fieldset class="options"><legend class="label">Модель мастера</legend>${MODELS.map((m) => `
      <label class="option"><input type="radio" name="model" value="${m.id}" ${m.id === this.settings.model ? 'checked' : ''}><span>${m.name} <small>${m.note}</small></span></label>`).join('')}</fieldset>`;
  }

  setupView(): string | null {
    if (this.key) return null;
    return `<form class="panel" data-form="setup">
      <label class="label" for="key">Ключ API Anthropic</label>
      <input id="key" name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" required>
      <p class="note">Создай на console.anthropic.com → API Keys. Ключ хранится только на этом телефоне и уходит напрямую в Anthropic. Игра оплачивается с твоего счёта API.</p>
      ${this.modelPicker()}
      <button class="btn primary" type="submit">Подключиться</button>
    </form>`;
  }

  setup(data: FormData): string | null {
    const key = String(data.get('key') ?? '').trim();
    if (!key.startsWith('sk-ant-')) return 'Ключ Anthropic начинается с sk-ant-';
    this.key = key;
    writeLocal(KEY, key);
    this.settings.model = (data.get('model') as ModelId) ?? this.settings.model;
    writeLocal(SETTINGS, JSON.stringify(this.settings));
    return null;
  }

  settingsView(): string {
    const efforts: [Effort, string][] = [['low', 'Быстро'], ['medium', 'Обычно'], ['high', 'Вдумчиво']];
    return `<form class="stack" data-form="settings">
        ${this.modelPicker()}
        <fieldset class="options"><legend class="label">Насколько мастер обдумывает ход</legend>
          ${efforts.map(([id, name]) => `<label class="option"><input type="radio" name="effort" value="${id}" ${this.settings.effort === id ? 'checked' : ''}><span>${name}</span></label>`).join('')}
        </fieldset>
        <button class="btn" type="submit">Сохранить</button>
      </form>
      <h2 class="label">Ключ API</h2>
      <p class="note">Хранится на этом телефоне: ${esc((this.key ?? '').slice(0, 10))}…</p>
      <button class="btn" data-act="forget-key">Удалить ключ</button>`;
  }

  saveSettings(data: FormData): void {
    this.settings = { model: (data.get('model') as ModelId) ?? this.settings.model, effort: (data.get('effort') as Effort) ?? this.settings.effort };
    writeLocal(SETTINGS, JSON.stringify(this.settings));
  }

  act(name: string): boolean {
    if (name !== 'forget-key') return false;
    writeLocal(KEY, null);
    this.key = null;
    this.client = null;
    return true;
  }

  play(c: Campaign, text: string | null, hooks: TurnHooks): Promise<void> {
    return playTurn(this.gm(), c, text, this.settings, Math.random, hooks);
  }

  async afterTurn(): Promise<boolean> {
    return false;
  }

  describe(err: unknown): { text: string; retry: boolean } {
    const r = (text: string, retry = true) => ({ text, retry });
    if (err instanceof Anthropic.APIUserAbortError) return r('Ход остановлен.');
    if (err instanceof RefusedError) return r('Мастер отказался вести эту сцену. Попробуй сформулировать иначе.', false);
    if (err instanceof TruncatedError) return r('Ответ мастера оборвался. Попробуй ещё раз.');
    if (err instanceof Anthropic.AuthenticationError) return r('Ключ API не подошёл. Проверь его в настройках.', false);
    if (err instanceof Anthropic.PermissionDeniedError) return r('У ключа нет доступа к этой модели. Выбери другую в настройках.', false);
    if (err instanceof Anthropic.RateLimitError) return r('Слишком много запросов или кончился лимит. Подожди минуту.');
    if (err instanceof Anthropic.BadRequestError) return r(`Запрос отклонён: ${err.message}`, false);
    if (err instanceof Anthropic.APIConnectionError) return r('Нет связи с сервером. Проверь интернет.');
    if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return r('Сервер Anthropic перегружен или недоступен. Попробуй ещё раз через минуту.');
    if (err instanceof Anthropic.APIError) return r(`Ошибка API ${err.status ?? ''}: ${err.message}`);
    return r(`Что-то пошло не так: ${err instanceof Error ? err.message : String(err)}`);
  }

  costNote(c: Campaign): string {
    const u = c.usage;
    return `Примерно $${u.dollars.toFixed(2)} за кампанию · ${Math.round((u.input + u.cacheRead + u.cacheWrite) / 1000)} тыс. токенов на входе (из кэша ${Math.round(u.cacheRead / 1000)} тыс.), ${Math.round(u.output / 1000)} тыс. на выходе.`;
  }
}
