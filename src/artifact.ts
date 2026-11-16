import './style.css';
import { App } from './ui/app';
import { splash } from './ui/splash';
import { ClaudeAiBackend } from './backends/claudeai';
import { localStore, revive, type Store } from './storage';
import type { Campaign } from './engine/campaign';
import type { SampleFn } from './gm/sampleSession';

/**
 * The claude.ai artifact build: Claude on the player's own account through `sample`, the
 * campaign in the artifact's database under the player's private path (this browser as a
 * fallback when the database is not there).
 */
interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}
interface DocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}
interface Db {
  collection(path: string): { doc(id: string): DocRef };
}
interface User {
  id(): Promise<string | null>;
}

const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
const use = <T,>(name: string): Promise<T | null> => (claude ? (claude.use(name) as Promise<T | null>).catch(() => null) : Promise.resolve(null));

/** Database documents are at most 256 KiB: the oldest feed entries are let go before that. */
function fitted(c: Campaign): Campaign {
  const copy = { ...c };
  while (JSON.stringify(copy).length > 200_000 && copy.feed.length > 40) copy.feed = copy.feed.slice(Math.floor(copy.feed.length / 4));
  return copy;
}

async function dbStore(): Promise<Store> {
  const [db, user] = await Promise.all([use<Db>('db'), use<User>('user')]);
  const id = await user?.id().catch(() => null);
  if (!db || !id) return localStore;
  const doc = db.collection(`data/users/${id}`).doc('isida-campaign');
  return {
    async load() {
      try {
        const snap = await doc.get();
        return snap.exists ? revive(snap.data()) : await localStore.load();
      } catch {
        return localStore.load();
      }
    },
    async save(c) {
      void localStore.save(c);
      try {
        if (c) await doc.set(fitted(c) as unknown as Record<string, unknown>);
        else await doc.delete();
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function boot(): Promise<void> {
  const root = document.getElementById('app')!;
  const shown = splash(document.body);
  const sample = await use<SampleFn & { limits(): Promise<{ tools?: unknown }> }>('sample');
  const limits = sample ? await sample.limits().catch(() => null) : null;
  const store = await dbStore();
  await shown;
  new App(root, new ClaudeAiBackend(sample, Boolean(limits?.tools)), store);
}

void boot();
