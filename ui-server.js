const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

function createUI({ launch = spawn, readConfig = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8')) } = {}) {
  let child = null;
  let state = { running: false, stopping: false, productKey: null, logs: [] };
  const events = new EventEmitter();
  const log = (text) => { state.logs.push(text); state.logs = state.logs.slice(-500); events.emit('log', text); };
  function stop() {
    if (!child || state.stopping) return false;
    state.stopping = true;
    child.kill('SIGTERM');
    return true;
  }
  // เริ่มบอต ใช้ร่วมกันทั้งหน้า UI และ Telegram
  function start(productKey, requestedQuantity) {
    if (child) return { status: 409, error: 'บอตกำลังทำงาน กรุณาหยุดรอบเดิมก่อน' };
    const config = readConfig();
    if (!Object.hasOwn(config.products, productKey) || !config.products[productKey].partNumber) return { status: 400, error: 'ไม่พบสินค้าหรือยังไม่มี partNumber' };
    const quantity = requestedQuantity ?? config.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1) return { status: 400, error: 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป' };
    state = { running: true, stopping: false, productKey, quantity, logs: [] };
    child = launch(process.execPath, [path.join(__dirname, 'index.js'), '--product', productKey, '--quantity', String(quantity)], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
    const current = child;
    for (const stream of [current.stdout, current.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', log);
    }
    current.on('error', (err) => { log(`เริ่มบอตไม่ได้: ${err.message}`); });
    current.on('close', (code, signal) => {
      log(`\nบอตหยุดแล้ว (${signal || code})\n`);
      child = null;
      state.running = false;
      state.stopping = false;
      events.emit('close', { code, signal, productKey, quantity });
    });
    events.emit('start', { productKey, quantity, name: config.products[productKey].name });
    return { status: 200 };
  }
  const server = http.createServer(async (req, res) => {
    const origin = `http://${req.headers.host}`;
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    // Only accept requests for the local server, including mutation requests from this UI.
    if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '') || (req.headers.origin && req.headers.origin !== origin)) return send(403, { error: 'ไม่อนุญาตแหล่งที่มานี้' });
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" });
        return res.end(fs.readFileSync(path.join(__dirname, 'ui/index.html')));
      }
      if (req.method === 'GET' && req.url === '/api/products') {
        const config = readConfig();
        return send(200, { apiVersion: 2, selectedProduct: config.selectedProduct, quantity: config.quantity || 1, autoPlaceOrder: !!config.autoPlaceOrder, products: Object.entries(config.products).map(([key, p]) => ({ key, name: p.name, color: p.colorTH, capacity: p.options.dimensionCapacity, model: key.replace(/-(256gb|512gb|1tb|2tb)-.*$/, ''), price: p.priceTHB })) });
      }
      if (req.method === 'GET' && req.url === '/api/status') return send(200, state);
      if (req.method === 'POST') {
        if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return send(403, { error: 'กรุณาสั่งงานจากหน้า UI' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) return send(413, { error: 'ข้อมูลใหญ่เกินไป' });
        }
        const input = JSON.parse(body || '{}');
        if (req.url === '/api/start') {
          const result = start(input.productKey, input.quantity);
          return result.status === 200 ? send(200, { ok: true }) : send(result.status, { error: result.error });
        }
        if (req.url === '/api/stop') { stop(); return send(200, { ok: true }); }
      }
      send(404, { error: 'ไม่พบหน้านี้' });
    } catch (err) { send(400, { error: err.message }); }
  });
  return { server, stop, start, events, getState: () => state, readConfig };
}

if (require.main === module) {
  const ui = createUI();
  const { server, stop } = ui;
  const port = Number(process.env.UI_PORT || 3310);
  server.on('error', (err) => { console.error(`เปิด UI ไม่สำเร็จ: ${err.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`เปิดหน้า UI ที่ http://127.0.0.1:${server.address().port}`));
  const telegram = require('./telegram-bot').startFromEnv(ui);
  const shutdown = () => { telegram?.stop(); stop(); server.close(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
module.exports = { createUI };
