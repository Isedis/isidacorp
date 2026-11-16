// Plays a short scripted session in a phone-sized browser with the Anthropic API replaced by
// recorded SSE streams; saves screenshots. Usage: npm run build; npx vite preview --port 4190;
// NODE_PATH=$(npm root -g) node scripts/e2e.cjs <out-dir>
const { chromium } = require('playwright');
const OUT = process.argv[2];
function sse(content, stop) {
  const ev = [];
  const push = (type, data) => ev.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  push('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 3000, output_tokens: 1, cache_read_input_tokens: 2000 } } });
  content.forEach((b, i) => {
    if (b.type === 'text') {
      push('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      for (const part of b.text.match(/[\s\S]{1,40}/g)) push('content_block_delta', { index: i, delta: { type: 'text_delta', text: part } });
    } else {
      push('content_block_start', { index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      push('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    push('content_block_stop', { index: i });
  });
  push('message_delta', { delta: { stop_reason: stop }, usage: { output_tokens: 400 } });
  push('message_stop', {});
  return ev.join('');
}
const script = [
  sse([{ type: 'text', text: 'Дождь стекает по неоновой вывеске «Лапша Ито». Фиксер **Мама Цзи** кладёт перед тобой чип: «Работа простая, Ноль. Склад девять, Ржавые доки. Забери кейс — и долг закрыт».' },
       { type: 'tool_use', id: 't1', name: 'update_quest', input: { id: 'case9', title: 'Кейс со склада 9', status: 'active', note: 'Забрать кейс для Мамы Цзи в Ржавых доках' } },
       { type: 'tool_use', id: 't2', name: 'remember', input: { fact: 'Мама Цзи — фиксер, ей должен персонаж', location: 'Неоновый рынок, лапшичная «Ито»' } }], 'tool_use'),
  sse([{ type: 'text', text: 'Она ждёт ответа, постукивая ногтем по стойке.\n\n▸ Взять чип и выйти\n▸ Спросить, что в кейсе\n▸ Торговаться об оплате' }], 'end_turn'),
  sse([{ type: 'text', text: 'Ты втыкаешь шнур в порт кейса.' },
       { type: 'tool_use', id: 't3', name: 'ability_check', input: { skill: 'hacking', ability: 'int', dc: 14, advantage: 'none', reason: 'вскрыть защиту кейса' } }], 'tool_use'),
  sse([{ type: 'text', text: 'Двери склада с лязгом распахиваются — двое охранников.' },
       { type: 'tool_use', id: 't4', name: 'start_combat', input: { enemies: [{ kind: 'guard', name: '' }, { kind: 'drone', name: 'Оса' }], surprise: false } }], 'tool_use'),
  sse([{ type: 'text', text: 'Охранник вскидывает оружие.\n\n▸ Выстрелить в охранника\n▸ Перегрузить дрона' }], 'end_turn'),
];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const requests = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    requests.push({ headers: req.headers(), body: JSON.parse(req.postData()) });
    const body = script.shift();
    if (!body) return route.fulfill({ status: 500, body: '{"type":"error","error":{"type":"api_error","message":"no more"}}', headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
    await route.fulfill({ status: 200, body, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' } });
  });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:4190/isidacorp/');
  await page.screenshot({ path: `${OUT}/1-connect.png` });
  await page.fill('#key', 'sk-ant-test-key');
  await page.click('button[type=submit]');
  await page.fill('#name', 'Ноль');
  await page.fill('#about', 'Бывший сетевой инженер Исидакорп, уволен после аварии в Глубине. Должен фиксеру.');
  await page.click('[data-class="netrunner"]');
  await page.screenshot({ path: `${OUT}/2-create.png` });
  await page.click('button[type=submit]');
  await page.click('[data-act="start"]');
  await page.waitForSelector('.choice');
  await page.screenshot({ path: `${OUT}/3-start.png` });
  await page.click('.choice >> nth=1');
  await page.waitForSelector('.combat');
  await page.waitForSelector('.choice');
  await page.screenshot({ path: `${OUT}/4-combat.png` });
  await page.click('[data-tab="sheet"]');
  await page.screenshot({ path: `${OUT}/5-sheet.png` });
  await page.click('[data-tab="journal"]');
  await page.screenshot({ path: `${OUT}/6-journal.png` });
  // A failed request: the error and a retry button, the campaign untouched.
  await page.click('[data-tab="play"]');
  await page.fill('textarea[name=text]', 'Стреляю в охранника');
  await page.click('.btn.send');
  await page.waitForSelector('.banner.error');
  await page.screenshot({ path: `${OUT}/7-error.png` });
  const r = requests[0];
  console.log('requests', requests.length, 'model', r.body.model, 'betas', r.headers['anthropic-beta'], 'fallbacks', r.body.fallbacks, 'browser hdr', r.headers['anthropic-dangerous-direct-browser-access'], 'cache', JSON.stringify(r.body.cache_control), 'effort', JSON.stringify(r.body.output_config), 'tools', r.body.tools.length, 'stream', r.body.stream);
  console.log('2nd request messages', requests[1].body.messages.length, requests[1].body.messages[2].content.map(c => c.type).join(','));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('isidacorp-campaign')));
  console.log('saved feed', saved.feed.length, 'messages', saved.messages.length, 'combat', !!saved.combat, 'quests', saved.quests.length, 'usage$', saved.usage.dollars.toFixed(4));
  await b.close();
})();
