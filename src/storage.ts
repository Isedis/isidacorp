import type { Campaign } from './engine/campaign';

/** Where a campaign is kept: the artifact's private database, or this browser as a fallback. */
export interface Store {
  load(): Promise<Campaign | null>;
  /** False when it could not be kept (storage full, offline): the player is told, the game goes on. */
  save(c: Campaign | null): Promise<boolean>;
}

const CAMPAIGN = 'isidacorp-campaign';

export const readLocal = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
export const writeLocal = (key: string, value: string | null): boolean => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

/** Fills fields added after a campaign was saved. */
export function revive(raw: unknown): Campaign | null {
  const c = raw as Campaign | null;
  if (!c || c.version !== 1 || !c.character || !Array.isArray(c.feed)) return null;
  // Fields of the removed API-key version.
  delete (c as Partial<Record<'messages' | 'usage', unknown>>).messages;
  delete (c as Partial<Record<'messages' | 'usage', unknown>>).usage;
  c.transcript ??= [];
  c.summary ??= '';
  return c;
}

export const localStore: Store = {
  async load() {
    try {
      return revive(JSON.parse(readLocal(CAMPAIGN) ?? 'null'));
    } catch {
      return null;
    }
  },
  async save(c) {
    return writeLocal(CAMPAIGN, c && JSON.stringify(c));
  },
};
