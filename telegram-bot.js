// Telegram bot สำหรับสั่งบอตจากระยะไกล — รันอยู่ใน ui-server.js (pm2)
// ตั้งค่าใน .env.telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const CAPACITY = { '256gb': '256GB', '512gb': '512GB', '1tb': '1TB', '2tb': '2TB' };
const QUANTITIES = [1, 2, 3, 4];
const STOP_KEYBOARD = [[{ text: '⏹ หยุดบอต', callback_data: 's' }, { text: '📋 ดู log', callback_data: 'l' }]];
const stopMarkup = { reply_markup: { inline_keyboard: STOP_KEYBOARD } };
// แจ้งเตือนเฉพาะบรรทัดสำคัญจาก index.js
const NOTIFY_PATTERN = /🔔|💰|เริ่มบอตไม่ได้|Error:/;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const baht = (n) => (n ? `฿${Number(n).toLocaleString('en-US')}` : '');
const modelOf = (key) => key.replace(/-(256gb|512gb|1tb|2tb)-.*$/, '');

// ชื่อย่อ เช่น duo-wh-256 อ่านจาก scripts ใน package.json ให้ตรงกับ npm run
function loadAliases(dir) {
  try {
    const scripts = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts || {};
    const aliases = {};
    for (const [name, cmd] of Object.entries(scripts)) {
      const m = /^node index\.js --product (\S+)$/.exec(cmd);
      if (m) aliases[name] = m[1];
    }
    return aliases;
  } catch { return {}; }
}

function createTelegramBot({ token, chatId, ui, fetchImpl = fetch, dir = __dirname, logger = console }) {
  const api = `https://api.telegram.org/bot${token}`;
  const aliases = loadAliases(dir);
  const aliasOf = Object.fromEntries(Object.entries(aliases).map(([a, k]) => [k, a]));
  let offset = 0;
  let stopped = false;
  let controller = null;

  async function call(method, body = {}, signal) {
    const res = await fetchImpl(`${api}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
    return data.result;
  }
  const send = (text, extra = {}) => call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
    .catch((err) => logger.error(`[telegram] ส่งข้อความไม่สำเร็จ: ${err.message}`));
  const edit = (msg, text, keyboard) => call('editMessageText', { chat_id: chatId, message_id: msg.message_id, text, parse_mode: 'HTML', reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined })
    .catch(() => send(text, keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}));

  const products = () => {
    const config = ui.readConfig();
    return { config, list: Object.entries(config.products).filter(([, p]) => p.partNumber) };
  };
  const label = (key, p) => `${p.name}${p.priceTHB ? ` — ${baht(p.priceTHB)}` : ''}`;
  const models = (list) => {
    const out = new Map();
    for (const [key, p] of list) {
      const m = modelOf(key);
      if (!out.has(m)) out.set(m, { name: p.name.split(/ \d+(?:GB|TB)/)[0], items: [] });
      out.get(m).items.push([key, p]);
    }
    return out;
  };
  const resolveKey = (input, list) => {
    if (!input) return null;
    const k = aliases[input] || input;
    return list.some(([key]) => key === k) ? k : null;
  };

  // ---------- หน้าเมนู ----------
  function menuModels() {
    const { list } = products();
    const groups = models(list);
    const lines = ['<b>📱 สินค้าทั้งหมด</b> (ชื่อย่อใช้กับ /buy)', ''];
    for (const g of groups.values()) {
      lines.push(`<b>${esc(g.name)}</b>`);
      for (const [key, p] of g.items) lines.push(`• <code>${esc(aliasOf[key] || key)}</code> ${esc(CAPACITY[p.options?.dimensionCapacity] || '')} ${esc(p.colorTH || '')} ${baht(p.priceTHB)}`);
      lines.push('');
    }
    lines.push('เลือกรุ่นด้านล่างเพื่อซื้อ 👇');
    const keyboard = [...groups.entries()].map(([m, g]) => [{ text: g.name, callback_data: `m:${m}` }]);
    return { text: lines.join('\n'), keyboard };
  }
  function menuProducts(model) {
    const { list } = products();
    const g = models(list).get(model);
    if (!g) return { text: 'ไม่พบรุ่นนี้', keyboard: [[{ text: '« กลับ', callback_data: 'home' }]] };
    const buttons = g.items.map(([key, p]) => ({ text: `${CAPACITY[p.options?.dimensionCapacity] || ''} ${p.colorTH || ''}`.trim(), callback_data: `p:${key}` }));
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
    keyboard.push([{ text: '« กลับ', callback_data: 'home' }]);
    return { text: `<b>${esc(g.name)}</b>\nเลือกความจุและสี:`, keyboard };
  }
  function menuQuantity(key) {
    const { config } = products();
    const p = config.products[key];
    return {
      text: `<b>${esc(label(key, p))}</b>\nจำนวนต่อเบราว์เซอร์:`,
      keyboard: [QUANTITIES.map((q) => ({ text: String(q), callback_data: `q:${key}:${q}` })), [{ text: '« กลับ', callback_data: `m:${modelOf(key)}` }]],
    };
  }
  function menuConfirm(key, qty) {
    const { config } = products();
    const p = config.products[key];
    const browsers = (config.envFiles || ['.env']).length;
    const lines = [
      '<b>ยืนยันเริ่มเฝ้าสต็อกและซื้อ?</b>',
      esc(label(key, p)),
      `จำนวน ${qty} เครื่อง × ${browsers} เบราว์เซอร์ = รวม ${qty * browsers} เครื่อง`,
      config.autoPlaceOrder ? '⚠️ autoPlaceOrder: <b>เปิด</b> — บอตจะกดสั่งซื้อจริง' : 'autoPlaceOrder: ปิด — บอตหยุดที่หน้าตรวจทาน',
    ];
    return { text: lines.join('\n'), keyboard: [[{ text: '✅ ยืนยัน', callback_data: `c:${key}:${qty}` }, { text: '❌ ยกเลิก', callback_data: 'x' }]] };
  }
  function statusText() {
    const s = ui.getState();
    if (!s.running) return '⏹ บอตไม่ได้ทำงานอยู่';
    const p = ui.readConfig().products[s.productKey];
    return `▶️ บอตกำลังทำงาน${s.stopping ? ' (กำลังหยุด)' : ''}\n${esc(p ? p.name : s.productKey)} × ${s.quantity}`;
  }
  function logText(n = 20) {
    const lines = ui.getState().logs.join('').split('\n').filter(Boolean).slice(-n);
    return lines.length ? `<pre>${esc(lines.join('\n')).slice(-3800)}</pre>` : 'ยังไม่มี log';
  }
  function doStart(key, qty) {
    const r = ui.start(key, qty);
    return r.status === 200 ? null : `❌ ${esc(r.error)}`;
  }

  // ---------- รับคำสั่ง ----------
  async function handleMessage(msg) {
    const [cmdRaw, ...args] = (msg.text || '').trim().split(/\s+/);
    const cmd = cmdRaw.toLowerCase().replace(/@.*$/, '');
    if (cmd === '/start' || cmd === '/help') {
      return send([
        '<b>Apple Bot</b>',
        '/list — รายการสินค้าทั้งหมด แล้วกดเลือกซื้อ',
        '/buy &lt;ชื่อย่อ&gt; [จำนวน] — เช่น <code>/buy duo-wh-256</code>',
        '/status — สถานะบอต',
        '/log — log ล่าสุด',
        '/stop — หยุดบอต',
      ].join('\n'));
    }
    if (cmd === '/list' || cmd === '/menu' || (cmd === '/buy' && !args.length)) {
      const m = menuModels();
      return send(m.text, { reply_markup: { inline_keyboard: m.keyboard } });
    }
    if (cmd === '/buy') {
      const { list } = products();
      const key = resolveKey(args[0], list);
      if (!key) return send(`ไม่พบสินค้า <code>${esc(args[0])}</code> — ดูชื่อย่อด้วย /list`);
      const qty = args[1] === undefined ? (ui.readConfig().quantity || 1) : Number(args[1]);
      if (!Number.isSafeInteger(qty) || qty < 1) return send('จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
      const m = menuConfirm(key, qty);
      return send(m.text, { reply_markup: { inline_keyboard: m.keyboard } });
    }
    if (cmd === '/status') return send(statusText(), ui.getState().running ? stopMarkup : {});
    if (cmd === '/log') return send(logText(Number(args[0]) || 20), ui.getState().running ? stopMarkup : {});
    if (cmd === '/stop') return send(ui.stop() ? '⏹ ส่งสัญญาณหยุดบอตแล้ว' : 'บอตไม่ได้ทำงานอยู่');
    return send('ไม่รู้จักคำสั่งนี้ — พิมพ์ /help');
  }

  async function handleCallback(cq) {
    call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
    const msg = cq.message;
    const [type, a, b] = cq.data.split(':');
    let view;
    if (type === 'home') view = menuModels();
    else if (type === 'm') view = menuProducts(a);
    else if (type === 'p') view = menuQuantity(a);
    else if (type === 'q') view = menuConfirm(a, Number(b));
    else if (type === 'x') return edit(msg, '❌ ยกเลิกแล้ว');
    else if (type === 's') {
      if (!ui.getState().running) return edit(msg, `${esc(msg.text || '')}\n\n⏹ บอตไม่ได้ทำงานอยู่แล้ว`);
      ui.stop();
      return edit(msg, `${esc(msg.text || '')}\n\n⏹ ส่งสัญญาณหยุดบอตแล้ว`);
    }
    else if (type === 'l') return send(logText(), ui.getState().running ? stopMarkup : {});
    else if (type === 'c') {
      const err = doStart(a, Number(b));
      if (err) return edit(msg, err);
      return edit(msg, `${menuConfirm(a, Number(b)).text.split('\n').slice(1, 3).join('\n')}\n\n▶️ เริ่มแล้ว — กดปุ่มด้านล่างเพื่อหยุดได้ทุกเมื่อ`, STOP_KEYBOARD);
    }
    if (view) return edit(msg, view.text, view.keyboard);
  }

  async function handleUpdate(update) {
    const msg = update.message || update.callback_query?.message;
    // รับคำสั่งจากแชทของเจ้าของเท่านั้น
    if (!msg || String(msg.chat.id) !== String(chatId)) {
      if (msg) logger.warn(`[telegram] ปฏิเสธคำสั่งจาก chat ${msg.chat.id}`);
      return;
    }
    if (update.callback_query) return handleCallback(update.callback_query);
    if (update.message.text) return handleMessage(update.message);
  }

  // ---------- แจ้งเตือนจากบอต ----------
  let buffer = '';
  ui.events.on('log', (text) => {
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (NOTIFY_PATTERN.test(line)) send(esc(line.replace(/\x07/g, '').trim()), ui.getState().running ? stopMarkup : {});
  });
  ui.events.on('start', ({ name, quantity }) => send(`▶️ เริ่มเฝ้าสต็อก: ${esc(name)} × ${quantity}`, stopMarkup));
  ui.events.on('close', ({ code, signal }) => { buffer = ''; send(`⏹ บอตหยุดแล้ว (${esc(signal || code)})`); });

  // ---------- long polling ----------
  async function poll() {
    try {
      // ข้ามข้อความค้างเก่า กันคำสั่ง /buy เก่ายิงซ้ำหลังรีสตาร์ต
      const pending = await call('getUpdates', { offset: -1, timeout: 0 });
      if (pending.length) offset = pending[pending.length - 1].update_id + 1;
      await call('setMyCommands', { commands: [
        { command: 'list', description: 'รายการสินค้า / เลือกซื้อ' },
        { command: 'buy', description: 'ซื้อ เช่น /buy duo-wh-256 2' },
        { command: 'status', description: 'สถานะบอต' },
        { command: 'log', description: 'log ล่าสุด' },
        { command: 'stop', description: 'หยุดบอต' },
      ] });
      logger.log('[telegram] พร้อมรับคำสั่ง');
    } catch (err) { logger.error(`[telegram] เริ่มไม่สำเร็จ: ${err.message}`); }
    while (!stopped) {
      try {
        controller = new AbortController();
        const updates = await call('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }, controller.signal);
        for (const u of updates) {
          offset = u.update_id + 1;
          await handleUpdate(u).catch((err) => logger.error(`[telegram] ${err.message}`));
        }
      } catch (err) {
        if (stopped) break;
        logger.error(`[telegram] polling error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  return {
    start() { poll(); return this; },
    stop() { stopped = true; controller?.abort(); },
    handleUpdate,
  };
}

// โหลดค่าจาก .env.telegram (หรือ environment) แล้วเริ่มบอต — ไม่มีค่าก็ข้าม
function startFromEnv(ui, dir = __dirname) {
  const file = path.join(dir, '.env.telegram');
  const env = { ...(fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {}), ...process.env };
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[telegram] ไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ใน .env.telegram — ข้าม');
    return null;
  }
  return createTelegramBot({ token, chatId, ui, dir }).start();
}

module.exports = { createTelegramBot, startFromEnv, loadAliases };
