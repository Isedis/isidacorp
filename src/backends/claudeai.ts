import type { Campaign } from '../engine/campaign';
import { foldTranscript, isSampleError, playTurnSample, type SampleFn } from '../gm/sampleSession';
import type { Backend, TurnHooks } from './backend';

/**
 * The game master through the player's own claude.ai account: the page is a claude.ai artifact
 * and asks Claude with the `sample` capability. No key; turns count toward the plan's limits.
 */
export class ClaudeAiBackend implements Backend {
  constructor(private sample: SampleFn | null, private toolsAvailable: boolean) {}

  setupView(): string | null {
    if (!this.sample) return `<div class="panel"><p>Мастер работает только внутри claude.ai: открой эту страницу по ссылке claude.ai/artifact/… в браузере или в приложении Claude.</p></div>`;
    if (!this.toolsAvailable) return `<div class="panel"><p>Здесь мастер не может бросать кубики: этот вид claude.ai не поддерживает функции страницы. Открой игру в браузере на claude.ai.</p></div>`;
    return null;
  }

  setup(): string | null {
    return null;
  }

  settingsView(): string {
    return `<p class="note">Мастер — самая умная модель Claude из твоей подписки claude.ai. Каждый ход расходует лимиты подписки, как сообщение в чате.</p>`;
  }

  saveSettings(): void {}

  act(): boolean {
    return false;
  }

  play(c: Campaign, text: string | null, hooks: TurnHooks): Promise<void> {
    return playTurnSample(this.sample!, c, text, Math.random, hooks);
  }

  afterTurn(c: Campaign): Promise<boolean> {
    return foldTranscript(this.sample!, c);
  }

  describe(err: unknown): { text: string; retry: boolean } {
    if (!isSampleError(err)) return { text: `Что-то пошло не так: ${err instanceof Error ? err.message : String(err)}`, retry: true };
    switch (err.code) {
      case 'cancelled':
        return { text: 'Ход остановлен.', retry: true };
      case 'not_granted':
        return { text: 'Странице не разрешено обращаться к Claude. Разреши доступ в меню артефакта и перезагрузи страницу.', retry: false };
      case 'sampling_disabled':
      case 'capability_disabled':
      case 'not_declared':
        return { text: 'Claude недоступен для этого аккаунта здесь.', retry: false };
      case 'tools_unavailable':
        return { text: 'Здесь мастер не может бросать кубики. Открой игру в браузере на claude.ai.', retry: false };
      case 'rate_limited':
        return { text: 'Лимит подписки или слишком частые ходы. Подожди немного и повтори.', retry: true };
      case 'session_expired':
        return { text: 'Сессия claude.ai истекла. Войди заново и повтори.', retry: true };
      case 'refused':
        return { text: 'Мастер отказался вести эту сцену. Попробуй сформулировать иначе.', retry: false };
      case 'prompt_too_large':
        return { text: 'История стала слишком длинной для одного хода. Повтори — мастер сожмёт старые сцены.', retry: true };
      case 'empty_completion':
        return { text: 'Мастер ничего не ответил. Попробуй сформулировать иначе.', retry: false };
      default:
        return { text: 'Связь с Claude прервалась. Попробуй ещё раз.', retry: true };
    }
  }

  costNote(c: Campaign): string {
    return `Ходы расходуют лимиты подписки claude.ai. В памяти мастера: ${c.transcript.length} последних сцен${c.summary ? ' и краткая летопись прошлого' : ''}.`;
  }
}
