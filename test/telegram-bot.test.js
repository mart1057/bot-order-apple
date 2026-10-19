const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createTelegramBot } = require('../telegram-bot');

test('telegram: list → model → product → qty → confirm starts the bot; rejects other chats', async () => {
  const config = {
    quantity: 1, autoPlaceOrder: true, envFiles: ['.env'],
    products: {
      'iphone-duo-256gb-starwhite': { name: 'iPhone Duo 256GB Star White', colorTH: 'สตาร์ไวท์', partNumber: 'P1', priceTHB: 79900, options: { dimensionCapacity: '256gb' } },
      'iphone-18-pro-256gb-black': { name: 'iPhone 18 Pro 256GB Black', colorTH: 'ดำ', partNumber: 'P2', options: { dimensionCapacity: '256gb' } },
    },
  };
  const started = [];
  const state = { running: false, logs: [] };
  let stops = 0;
  const ui = { events: new EventEmitter(), readConfig: () => config, getState: () => state, stop: () => { stops++; state.running = false; return true; },
    start: (k, q) => { started.push([k, q]); state.running = true; return { status: 200 }; } };
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ method: url.split('/').pop(), body: JSON.parse(opts.body) }); return { json: async () => ({ ok: true, result: {} }) }; };
  const bot = createTelegramBot({ token: 'T', chatId: 42, ui, fetchImpl, dir: path.join(__dirname, '..'), logger: { log() {}, warn() {}, error() {} } });
  const msg = (text, chat = 42) => ({ message: { chat: { id: chat }, text } });
  const tap = (data) => ({ callback_query: { id: 'c', data, message: { chat: { id: 42 }, message_id: 1 } } });
  const last = (m) => calls.filter((c) => c.method === m).at(-1).body;

  await bot.handleUpdate(msg('/list'));
  assert.match(last('sendMessage').text, /duo-wh-256/);
  assert.deepEqual(last('sendMessage').reply_markup.inline_keyboard.map((r) => r[0].callback_data), ['m:iphone-duo', 'm:iphone-18-pro']);

  await bot.handleUpdate(tap('m:iphone-duo'));
  assert.equal(last('editMessageText').reply_markup.inline_keyboard[0][0].callback_data, 'p:iphone-duo-256gb-starwhite');
  await bot.handleUpdate(tap('p:iphone-duo-256gb-starwhite'));
  await bot.handleUpdate(tap('q:iphone-duo-256gb-starwhite:2'));
  assert.match(last('editMessageText').text, /autoPlaceOrder/);
  assert.equal(started.length, 0, 'ต้องยังไม่เริ่มก่อนกดยืนยัน');
  await bot.handleUpdate(tap('c:iphone-duo-256gb-starwhite:2'));
  assert.deepEqual(started, [['iphone-duo-256gb-starwhite', 2]]);
  assert.equal(last('editMessageText').reply_markup.inline_keyboard[0][0].callback_data, 's', 'ต้องมีปุ่มหยุดหลังเริ่ม');
  await bot.handleUpdate(msg('/status'));
  assert.equal(last('sendMessage').reply_markup.inline_keyboard[0][0].callback_data, 's');
  await bot.handleUpdate(tap('s'));
  assert.equal(stops, 1);
  assert.match(last('editMessageText').text, /หยุดบอตแล้ว/);
  await bot.handleUpdate(tap('s'));
  assert.equal(stops, 1, 'กดซ้ำตอนหยุดแล้วไม่ต้องสั่งซ้ำ');

  await bot.handleUpdate(msg('/buy duo-wh-256 3'));
  assert.equal(last('sendMessage').reply_markup.inline_keyboard[0][0].callback_data, 'c:iphone-duo-256gb-starwhite:3');
  await bot.handleUpdate(msg('/buy nope'));
  assert.match(last('sendMessage').text, /ไม่พบสินค้า/);

  const before = calls.length;
  await bot.handleUpdate(msg('/buy duo-wh-256', 999));
  await bot.handleUpdate({ callback_query: { id: 'c', data: 'c:iphone-duo-256gb-starwhite:1', message: { chat: { id: 999 }, message_id: 1 } } });
  assert.equal(calls.length, before, 'แชทอื่นต้องถูกเพิกเฉย');
  assert.equal(started.length, 1);

  ui.events.emit('log', '\x07🔔 มีของแล้ว: Central World\n[10:00] ยังไม่มีของ\n');
  assert.match(last('sendMessage').text, /มีของแล้ว/);
});
