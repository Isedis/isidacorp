import type { Campaign, Entry } from '../engine/campaign';

export interface TurnHooks {
  onText?: (delta: string) => void;
  onEntry?: (entry: Entry) => void;
  signal?: AbortSignal;
}

/** Who plays the game master: Claude through the player's claude.ai account (see claudeai.ts). */
export interface Backend {
  /** A setup screen shown before anything else, or null when none is needed. */
  setupView(): string | null;
  /** Applies the setup form; returns an error to show, or null. */
  setup(data: FormData): string | null;
  /** Backend-specific part of the settings tab. */
  settingsView(): string;
  saveSettings(data: FormData): void;
  /** A `data-act` from the backend's own markup; returns whether to render again. */
  act(name: string): boolean;
  play(c: Campaign, text: string | null, hooks: TurnHooks): Promise<void>;
  /** Housekeeping between turns; resolves true when the campaign changed. */
  afterTurn(c: Campaign): Promise<boolean>;
  /** Player-facing text for a failed turn, and whether trying again makes sense. */
  describe(err: unknown): { text: string; retry: boolean };
  /** A line for the journal about what the game costs. */
  costNote(c: Campaign): string;
}
