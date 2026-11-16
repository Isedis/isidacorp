import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Character } from './character';

/** One line of the story feed the player reads; the API history is kept separately. */
export type Entry =
  | { kind: 'gm'; text: string; choices: string[] }
  | { kind: 'player'; text: string }
  | { kind: 'roll'; title: string; detail: string; outcome: 'success' | 'fail' | 'neutral' | 'crit' | 'fumble' }
  | { kind: 'system'; text: string };

export interface Enemy {
  id: string;
  kind: string;
  name: string;
  hp: number;
  maxHp: number;
  ac: number;
  initiative: number;
}

export interface Combat {
  round: number;
  /** Turn order, highest initiative first: 'player' or an enemy id. */
  order: { id: string; name: string; initiative: number }[];
  turn: number;
  enemies: Enemy[];
}

export interface Quest {
  id: string;
  title: string;
  status: 'active' | 'done' | 'failed';
  note: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Spent so far, in US dollars, by the model prices at the time. */
  dollars: number;
}

export interface Campaign {
  version: 1;
  id: string;
  createdAt: number;
  character: Character;
  combat: Combat | null;
  quests: Quest[];
  /** Facts the game master asked to remember: people, places, debts, promises. */
  facts: string[];
  /** Where the character is now, in a few words. */
  location: string;
  feed: Entry[];
  /** The conversation with the model through the API, append-only: thinking blocks stay valid only if it never changes. */
  messages: BetaMessageParam[];
  /** Recent exchanges as plain text, for a master that remembers nothing between calls (claude.ai). */
  transcript: { player: string; gm: string }[];
  /** What happened before the transcript, as the master summarised it. */
  summary: string;
  usage: Usage;
  nextEnemyId: number;
}

export function newCampaign(character: Character): Campaign {
  return {
    version: 1,
    id: Math.random().toString(36).slice(2, 10),
    createdAt: Date.now(),
    character,
    combat: null,
    quests: [],
    facts: [],
    location: 'Исида, Нижний город',
    feed: [],
    messages: [],
    transcript: [],
    summary: '',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, dollars: 0 },
    nextEnemyId: 1,
  };
}
