// Plays a short session of the artifact build in a phone-sized browser, with claude.ai's
// runtime replaced by a scripted stand-in whose "Claude" calls the page tools. Screenshots
// every screen. Usage: npm run build:artifact; NODE_PATH=$(npm root -g) node scripts/e2e-artifact.cjs <out-dir>
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const page = fs.readFileSync('dist-artifact/isida.html', 'utf8');
// The Artifact skeleton, as claude.ai wraps the page.
const doc = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${page}</body></html>`;
const runtime = () => {
  const turns = [
    async (o, say) => {
      say('Дождь стекает по неоновой вывеске лапшичной «Ито». Фиксер **Мама Цзи** кладёт перед тобой чип: «Склад девять, Ржавые доки. Забери кейс — и долг закрыт».');
      o.tools.find((t) => t.name === 'update_quest').execute({ id: 'case9', title: 'Кейс со склада 9', status: 'active', note: 'Забрать кейс для Мамы Цзи' });
      o.tools.find((t) => t.name === 'remember').execute({ fact: 'Мама Цзи — фиксер, ей должен персонаж', location: 'Неоновый рынок, лапшичная «Ито»' });
      say('\n\nОна ждёт ответа, постукивая ногтем по стойке.\n▸ Взять чип и уйти\n▸ Спросить, что в кейсе\n▸ Торговаться об оплате');
    },
    async (o, say) => {
      say('Ты втыкаешь шнур в порт кейса.');
      o.tools.find((t) => t.name === 'ability_check').execute({ skill: 'hacking', ability: 'int', dc: 14, advantage: 'none', reason: 'вскрыть защиту кейса' });
      say('\n\nЗамок поддаётся, но двери склада с лязгом распахиваются — охранник и дрон.');
      o.tools.find((t) => t.name === 'start_combat').execute({ enemies: [{ kind: 'guard', name: '' }, { kind: 'drone', name: 'Оса' }], surprise: false });
      say('\n\nОхранник вскидывает оружие.\n▸ Выстрелить в охранника\n▸ Перегрузить дрона\n▸ Нырнуть за контейнер');
    },
  ];
  const sample = async (input, o = {}) => {
    const t = turns.shift();
    if (!t) throw { code: 'rate_limited', message: 'limit' };
    let text = '';
    const say = (s) => { text += s; o.onText?.({ text, delta: s }); };
    await new Promise((r) => setTimeout(r, 300));
    await t(o, say);
    window.__inputs = (window.__inputs || 0) + 1;
    return { text, truncated: false };
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 20 } });
  const store = new Map();
  const db = { collection: (p) => ({ doc: (id) => ({
    get: async () => ({ exists: store.has(p + '/' + id), data: () => JSON.parse(store.get(p + '/' + id)) }),
    set: async (d) => { const s = JSON.stringify(d); if (s.length > 262144) throw { code: 'too_large' }; store.set(p + '/' + id, s); window.__saved = s.length; },
    delete: async () => store.delete(p + '/' + id),
  }) }) };
  const caps = { sample, db, user: { id: async () => 'u1' } };
  window.claude = { use: async (n) => caps[n] ?? null };
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.addInitScript(runtime);
  // A real navigation, so the stand-in runtime is in place before the page's own scripts.
  const file = require('path').resolve(OUT, 'harness.html');
  fs.writeFileSync(file, doc);
  await p.goto('file://' + file);
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}/0-boot.png` });
  await p.waitForTimeout(1100);
  await p.screenshot({ path: `${OUT}/1-mark.png` });
  await p.waitForSelector('#name', { timeout: 5000 });
  await p.fill('#name', 'Ноль');
  await p.fill('#about', 'Бывший сетевой инженер Исидакорп, уволен после аварии в Глубине. Должен фиксеру.');
  await p.click('[data-class="netrunner"]');
  await p.screenshot({ path: `${OUT}/2-create.png` });
  await p.click('button[type=submit]');
  await p.click('[data-act="start"]');
  await p.waitForSelector('.choice');
  await p.screenshot({ path: `${OUT}/3-start.png` });
  await p.click('.choice >> nth=1');
  await p.waitForSelector('.combat');
  await p.waitForSelector('.choice');
  await p.screenshot({ path: `${OUT}/4-combat.png` });
  await p.click('[data-tab="sheet"]');
  await p.screenshot({ path: `${OUT}/5-sheet.png` });
  await p.click('[data-tab="journal"]');
  await p.screenshot({ path: `${OUT}/6-journal.png` });
  await p.click('[data-tab="play"]');
  await p.fill('#say', 'Стреляю в охранника');
  await p.press('#say', 'Enter');
  await p.waitForSelector('.banner');
  await p.screenshot({ path: `${OUT}/7-error.png` });
  const w = await p.evaluate(() => ({ inputs: window.__inputs, saved: window.__saved, overflow: document.documentElement.scrollWidth > innerWidth }));
  console.log(JSON.stringify(w));
  await b.close();
})();
