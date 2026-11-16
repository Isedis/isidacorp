import type { Campaign } from './engine/campaign';
import type { Settings } from './gm/session';

const KEY = 'isidacorp-api-key';
const SETTINGS = 'isidacorp-settings';
const CAMPAIGN = 'isidacorp-campaign';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null): boolean => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const loadKey = () => read(KEY);
export const saveKey = (key: string | null) => write(KEY, key);

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(read(SETTINGS) ?? '{}');
    return {
      model: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].includes(s.model) ? s.model : 'claude-opus-5-5',
      effort: ['low', 'medium', 'high'].includes(s.effort) ? s.effort : 'medium',
    };
  } catch {
    return { model: 'claude-opus-5-5', effort: 'medium' };
  }
}
export const saveSettings = (s: Settings) => write(SETTINGS, JSON.stringify(s));

export function loadCampaign(): Campaign | null {
  try {
    const c = JSON.parse(read(CAMPAIGN) ?? 'null');
    return c && c.version === 1 && c.character && Array.isArray(c.messages) ? (c as Campaign) : null;
  } catch {
    return null;
  }
}
/** False when the phone's storage is full: the player is told, the game goes on. */
export const saveCampaign = (c: Campaign | null) => write(CAMPAIGN, c && JSON.stringify(c));
