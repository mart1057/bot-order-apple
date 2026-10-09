require('dotenv').config();
const { execFile } = require('child_process');
const playwright = require('playwright');
const config = require('./settings.json');
const createBrowserSession = require('./browser-session');
const diagnoseBag = process.argv.includes('--diagnose-bag');

// เลือกสินค้าจาก settings.products ตาม settings.selectedProduct
const product = config.products?.[config.selectedProduct];
if (!product) {
  throw new Error(`ไม่พบสินค้า "${config.selectedProduct}" ใน settings.json (ที่มี: ${Object.keys(config.products || {}).join(', ')})`);
}
if (!product.partNumber) {
  throw new Error(`สินค้า "${config.selectedProduct}" ยังไม่มี partNumber ใน settings.json กรุณาเติมก่อนรัน`);
}
const { products, selectedProduct, ...shared } = config;
const settings = { ...shared, partNumber: product.partNumber, productUrl: product.productUrl, options: product.options || {} };
console.log(`🛒 สินค้าที่เลือก: ${product.name || selectedProduct} (${settings.partNumber})`);

const REQUIRED_ENV = ['FIRST_NAME', 'LAST_NAME', 'EMAIL', 'PHONE'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString('th-TH');

function notify(message) {
  console.log(`\x07🔔 ${message}`);
  if (process.platform === 'darwin') {
    execFile('osascript', ['-e', `display notification ${JSON.stringify(message)} with title "Apple Bot" sound name "Glass"`]);
  }
}

// API นี้ใช้งานได้กับ Apple TH (endpoint fulfillment-messages แบบเดิมตอบ 404)
async function checkStock() {
  const params = new URLSearchParams({ 'parts.0': settings.partNumber, location: settings.location });
  // ใช้ curl เพราะ Apple บล็อก fetch ของ Node (ตอบ 541)
  const output = await new Promise((resolve, reject) => {
    execFile('curl', ['-sS', '-i', '-m', '15', '-A', settings.stockUserAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      '-H', 'Accept: application/json', '-H', 'Accept-Language: th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
      `https://www.apple.com/th/shop/retail/pickup-message?${params}`], (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
  // curl อาจส่ง header ของ proxy/100 Continue ก่อน response จริง
  let body = output;
  let status;
  let headers = '';
  while (body.startsWith('HTTP/')) {
    const separator = /\r?\n\r?\n/.exec(body);
    if (!separator) throw new Error('อ่าน HTTP response ไม่ได้');
    headers = body.slice(0, separator.index);
    status = Number(headers.match(/^HTTP\/\S+\s+(\d{3})/)?.[1]);
    body = body.slice(separator.index + separator[0].length);
  }
  if ([403, 429, 541].includes(status)) {
    const retryAfter = headers.match(/^retry-after:\s*(.+)$/im)?.[1].trim();
    const retryAfterMs = retryAfter
      ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now())
      : 0;
    const error = new Error(`Apple จำกัดหรือปฏิเสธคำขอ (HTTP ${status})`);
    error.retryAfterMs = Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0;
    throw error;
  }
  if (!(status >= 200 && status < 300)) throw new Error(`Stock API ตอบ HTTP ${status}`);
  body = body.trimStart();
  if (!body.startsWith('{')) throw new Error('Apple ตอบกลับไม่ใช่ JSON (อาจโดนจำกัดความถี่)');

  const data = JSON.parse(body);
  const stores = data?.body?.stores;
  if (!Array.isArray(stores)) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง (part number หรือ location อาจผิด)');

  const wanted = settings.storeNumbers?.length ? stores.filter((s) => settings.storeNumbers.includes(s.storeNumber)) : stores;
  return wanted
    .filter((s) => s.partsAvailability?.[settings.partNumber]?.pickupDisplay === 'available')
    .map((s) => `${s.storeName} (${s.partsAvailability[settings.partNumber].pickupSearchQuote})`);
}

// ลอง selector หลายแบบ เพราะหน้า checkout ของ Apple เปลี่ยน id บ่อย
async function fillFirst(page, selectors, value, label) {
  for (const sel of selectors) {
    const el = (typeof sel === 'string' ? page.locator(sel) : sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.fill(value);
      return true;
    }
  }
  console.warn(`⚠️  หาช่อง ${label} ไม่เจอ กรุณากรอกเอง`);
  return false;
}

async function clickFirst(page, selectors, label, timeout = 15000) {
  const el = page.locator(selectors.join(', ')).first();
  await el.waitFor({ state: 'visible', timeout }).catch(() => {
    throw new Error(`หาปุ่ม "${label}" ไม่เจอ`);
  });
  await el.click();
}

// เว้นจังหวะระหว่างขั้นตอนให้หน้าเว็บประมวลผล
const pause = (page) => {
  const [min, max] = settings.stepDelayMs || [300, 700];
  return page.waitForTimeout(min + Math.random() * (max - min));
};

async function assertNotBlocked(page, step) {
  await page.waitForLoadState('domcontentloaded');
  const title = await page.title().catch(() => '');
  const blocked = /Page Not Found|ไม่พบหน้า/i.test(title) ||
    (await page.getByText(/can.t be found|ไม่พบหน้าที่คุณ/i).first().isVisible().catch(() => false));
  if (blocked) {
    const url = new URL(page.url());
    throw new Error(`Apple ตอบหน้า "can't be found" หลังขั้นตอน ${step} ที่ ${url.origin}${url.pathname} — อาจเป็น URL/session หรือการจำกัดการเข้าถึง ยังระบุสาเหตุไม่ได้`);
  }
}

// บางตัวเลือกต้องกดที่ป้าย (label บังอยู่) บางตัวต้องกดที่ radio เอง จึงลองทั้งสองแบบ และกดซ้ำจนกว่าหน้าเว็บจะรับ
async function selectRadio(page, radio, label) {
  await radio.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {
    throw new Error(`หาตัวเลือก "${label}" ไม่เจอ`);
  });
  const deadline = Date.now() + 30000;
  while (!(await radio.isChecked())) {
    if (Date.now() > deadline) throw new Error(`เลือก "${label}" ไม่สำเร็จ`);
    const id = await radio.getAttribute('id');
    await page.locator(`label[for="${id}"]`).click({ timeout: 3000 })
      .catch(() => radio.click({ timeout: 3000 }))
      .catch(() => radio.check({ force: true }))
      .catch(() => {});
    await radio.evaluate((el) => new Promise((ok) => {
      const end = Date.now() + 800;
      (function check() { if (el.checked || Date.now() > end) ok(); else requestAnimationFrame(check); })();
    })).catch(() => {});
  }
  console.log(`✅ เลือก ${label}`);
}

// เลือก "ตัวแรกที่เลือกได้" ในกลุ่ม radio: ถ้ามีตัวที่เลือกอยู่แล้วและใช้ได้ก็ใช้ตัวนั้น
async function selectFirstEnabled(page, radios, label) {
  await radios.first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {
    throw new Error(`หา${label}ไม่เจอ`);
  });
  const count = await radios.count();
  for (let i = 0; i < count; i++) {
    const r = radios.nth(i);
    if (await r.isDisabled()) continue;
    await selectRadio(page, r, `${label}ลำดับที่ ${i + 1}`);
    return;
  }
  throw new Error(`ไม่มี${label}ที่เลือกได้`);
}

async function selectPickupSlot(page) {
  // สาขา: ร้านที่ "ทั้งหมดยังไม่พร้อมให้บริการ" จะถูก disable
  await selectFirstEnabled(page, page.locator('input[type="radio"][name*="storeLocator" i], input[type="radio"][name*="store" i]'), 'สาขา');
  await pause(page);

  // วันที่: บางวัน (เช่นวันนี้) อาจกดไม่ได้
  const dates = page.locator('input[type="radio"][name*="startDate" i], input[type="radio"][name*="date" i]');
  if (await dates.first().waitFor({ state: 'attached', timeout: 10000 }).then(() => true, () => false)) {
    await selectFirstEnabled(page, dates, 'วันรับสินค้า');
    await pause(page);
  }

  // ช่วงเวลา: dropdown "ช่วงเวลาที่มีให้เลือก" เลือกช่วงแรกที่มีค่า
  const time = page.locator('select[name*="timeSlot" i]').or(page.getByLabel(/ช่วงเวลา/)).first();
  await time.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    throw new Error('หาช่อง "ช่วงเวลาที่มีให้เลือก" ไม่เจอ');
  });
  // เลือกช่วงเวลาลำดับที่ pickupSlotIndex (ค่าเริ่มต้น 3) ถ้ามีไม่ถึง ใช้ช่วงสุดท้ายที่มี
  const slots = await time.evaluate((el) => [...el.options].filter((o) => o.value && !o.disabled).map((o) => o.value));
  if (!slots.length) throw new Error('ไม่มีช่วงเวลารับสินค้าที่เลือกได้');
  const want = settings.pickupSlotIndex || 3;
  if (slots.length < want) console.warn(`⚠️  มีช่วงเวลาแค่ ${slots.length} ช่วง เลือกช่วงสุดท้ายแทนลำดับที่ ${want}`);
  await time.selectOption(slots[Math.min(want, slots.length) - 1]);
  console.log(`✅ เลือกช่วงเวลา ${(await time.locator('option:checked').textContent())?.trim()}`);
}

// หาช่องกรอกจากข้อความป้ายที่แสดงบนจอ (label[for], label ที่ครอบ, aria-labelledby, aria-label, placeholder)
// แล้วติด data-bot-field ไว้เพื่อให้ Playwright ชี้ช่องนั้นได้แน่นอน
async function findField(page, label, tag = 'input', timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const key = await page.evaluate(({ source, flags, tag }) => {
      const re = new RegExp(source, flags);
      const text = (el) => {
        const parts = [];
        if (el.labels) for (const l of el.labels) parts.push(l.innerText);
        for (const id of (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)) {
          parts.push(document.getElementById(id)?.innerText || '');
        }
        parts.push(el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '');
        // ป้ายลอยที่ไม่ได้ผูกกับช่อง: หาจากองค์ประกอบรอบๆ (ไม่เกิน 3 ชั้น) ที่มีช่องกรอกแค่ช่องเดียว
        let box = el.parentElement;
        for (let i = 0; box && i < 3; i++, box = box.parentElement) {
          if (box.querySelectorAll('input, select, textarea').length !== 1) break;
          for (const l of box.querySelectorAll('label, [class*="label" i]')) parts.push(l.innerText);
        }
        return parts.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      };
      const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const el = [...document.querySelectorAll(tag)].find((e) => visible(e) && !e.disabled && text(e).some((t) => re.test(t)));
      if (!el) return null;
      el.dataset.botField ||= `f${Math.random().toString(36).slice(2)}`;
      return el.dataset.botField;
    }, { source: label.source, flags: label.flags, tag });
    if (key) return page.locator(`[data-bot-field="${key}"]`);
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(150);
  }
}

// กรอกแล้วตรวจว่าค่าเข้าจริง ถ้า fill ไม่ติด (ช่องที่จัดรูปแบบเอง เช่น เลขบัตร/วันหมดอายุ) จะพิมพ์ทีละตัวแทน
async function fillField(page, label, value, name) {
  if (!value) {
    console.warn(`⚠️  ยังไม่ได้ตั้งค่า ${name} ใน .env`);
    return false;
  }
  const el = await findField(page, label);
  if (!el) {
    console.warn(`⚠️  หาช่อง ${name} ไม่เจอ`);
    return false;
  }
  const digits = (v) => v.replace(/\D/g, '');
  const ok = async () => {
    const got = await el.inputValue();
    return got === value || (digits(value) && digits(got) === digits(value));
  };
  await el.fill(value);
  if (!(await ok())) {
    await el.click();
    await el.fill('');
    await el.pressSequentially(value, { delay: 15 });
  }
  await el.blur();
  if (!(await ok())) {
    console.warn(`⚠️  กรอกช่อง ${name} แล้วค่าไม่เข้า`);
    return false;
  }
  console.log(`✅ กรอก ${name}`);
  return true;
}

// แสดงช่องกรอกที่มองเห็นในหน้า เพื่อใช้แก้ selector (ไม่แสดงค่าที่กรอก)
async function dumpFields(page) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
    .filter((e) => e.offsetWidth || e.offsetHeight)
    .map((e) => ({
      tag: e.tagName.toLowerCase(), type: e.type, id: e.id, name: e.name,
      label: [...(e.labels || [])].map((l) => l.innerText.trim()).join(' | ') || e.getAttribute('aria-label') || e.placeholder || '',
      filled: !!e.value,
    })));
  console.log('📋 ช่องที่พบในหน้า:');
  console.table(rows);
}

// dropdown จังหวัด/อำเภอ/ตำบล: รอให้ตัวเลือกโหลดก่อน แล้วเลือกตามชื่อ
async function selectByLabel(page, label, value) {
  if (!value) {
    console.warn(`⚠️  ยังไม่ได้ตั้งค่า ${label} ใน .env กรุณาเลือกเอง`);
    return;
  }
  // dropdown อำเภอ/ตำบลจะกดได้หลังเลือกช่องก่อนหน้าและโหลดรายชื่อเสร็จ จึงรอนานกว่าปกติ
  const select = await findField(page, label, 'select', 30000);
  if (!select) {
    await dumpFields(page);
    throw new Error(`หาช่อง ${label} ไม่เจอ`);
  }
  const deadline = Date.now() + 15000;
  for (;;) {
    const match = await select.evaluate((el, v) => [...(el.options || [])].find((o) => o.textContent.trim() === v.trim())?.value, value);
    if (match) {
      await select.selectOption(match);
      console.log(`✅ เลือก ${value}`);
      return;
    }
    if (Date.now() > deadline) throw new Error(`ไม่พบ "${value}" ในช่อง ${label} (สะกดให้ตรงกับในหน้าเว็บ)`);
    await page.waitForTimeout(150);
  }
}

// หน้าถุง: ทำให้จำนวนรวมในถุงเท่ากับ settings.quantity
// Apple แยก iPhone เป็นบรรทัดละ 1 เครื่อง (เลือก 2 แล้วจะกลายเป็น 2 บรรทัด) จึงนับรวมทุกบรรทัด
// ตรวจจำนวนรวมทุกบรรทัดในถุงของเซสชันนี้
const QTY_SELECTOR = 'select[name*="quantity" i], select[data-autom*="quantity" i], select[aria-label*="จำนวน"]';

async function bagTotal(page) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .filter((e) => e.offsetWidth || e.offsetHeight)
    .reduce((sum, e) => sum + (parseInt(e.value, 10) || 0), 0), QTY_SELECTOR);
}

// รอจนจำนวนรวมเปลี่ยนจากค่าเดิม (Apple อัปเดตถุงแล้ว render ใหม่)
async function waitBagChange(page, before) {
  await page.waitForFunction(({ sel, before }) => {
    const total = [...document.querySelectorAll(sel)]
      .filter((e) => e.offsetWidth || e.offsetHeight)
      .reduce((sum, e) => sum + (parseInt(e.value, 10) || 0), 0);
    return total !== before;
  }, { sel: QTY_SELECTOR, before }, { timeout: 15000 }).catch(() => {
    throw new Error('ถุงไม่อัปเดตหลังแก้จำนวน');
  });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
}

const MAX_PER_ORDER = 2; // Apple จำกัด iPhone ไม่เกิน 2 เครื่องต่อคำสั่งซื้อ

// แสดงช่องจำนวนและปุ่มในหน้าถุง เพื่อใช้แก้ selector
async function dumpBag(page) {
  const info = await page.evaluate(() => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
    return {
      selects: [...document.querySelectorAll('select')].filter(vis)
        .map((e) => ({ name: e.name, id: e.id, autom: e.dataset.autom, aria: e.getAttribute('aria-label'), value: e.value })),
      removeButtons: [...document.querySelectorAll('button, a, [role="button"]')].filter((e) => vis(e) && /ลบ|remove/i.test(e.textContent + (e.dataset.autom || '')))
        .map((e) => ({ tag: e.tagName.toLowerCase(), text: e.textContent.replace(/\s+/g, ' ').trim().slice(0, 80), autom: e.dataset.autom })),
    };
  });
  console.log('📋 ช่องจำนวนในถุง:');
  console.table(info.selects);
  console.log('📋 ปุ่มลบในถุง:');
  console.table(info.removeButtons);
}

async function setBagQuantity(page, requested) {
  const quantity = Math.min(requested, MAX_PER_ORDER);
  if (quantity !== requested) console.warn(`⚠️  Apple จำกัด ${MAX_PER_ORDER} เครื่อง ใช้ ${quantity} แทน ${requested}`);
  const qtySelects = page.locator(QTY_SELECTOR).locator('visible=true');
  if (!(await qtySelects.first().waitFor({ timeout: 20000 }).then(() => true, () => false))) {
    await dumpBag(page);
    throw new Error('หาช่องจำนวนสินค้าในถุงไม่เจอ (ดูรายละเอียดด้านบน)');
  }

  // ลบทีละบรรทัดจนเหลือตามจำนวน ไม่ว่าในถุงจะค้างไว้กี่เครื่อง
  for (let attempt = 0; attempt < 30; attempt++) {
    const total = await bagTotal(page);
    console.log(`🧺 ในถุงมีทั้งหมด ${total} เครื่อง (${await qtySelects.count()} บรรทัด) ต้องการ ${quantity}`);
    if (total === quantity) {
      console.log(`✅ จำนวนในถุง: ${quantity} เครื่อง`);
      return;
    }

    if (total > quantity) {
      // เกิน: ลบบรรทัดล่างสุดออกทีละบรรทัด
      // ปุ่ม "ลบออก" ของ Apple มีข้อความซ่อนต่อท้าย (เช่น ชื่อสินค้า) จึงไม่จับแบบตรงตัว
      const remove = page.locator('button, a, [role="button"]')
        .filter({ hasText: /ลบออก|Remove/i })
        .or(page.locator('[data-autom*="remove" i]'))
        .locator('visible=true');
      if (!(await remove.count())) {
        await dumpBag(page);
        throw new Error('หาปุ่ม "ลบออก" ในถุงไม่เจอ (ดูรายละเอียดด้านบน)');
      }
      await remove.last().click();
    } else {
      // ขาด: เพิ่มจำนวนที่บรรทัดแรก (Apple จะแยกเป็นบรรทัดใหม่ให้เอง)
      const first = qtySelects.first();
      const want = String((parseInt(await first.inputValue(), 10) || 0) + (quantity - total));
      const options = await first.evaluate((el) => [...el.options].map((o) => o.value));
      if (!options.includes(want)) throw new Error(`เลือกจำนวน ${want} ไม่ได้ (Apple ให้เลือกได้: ${options.join(', ')})`);
      await first.selectOption(want);
    }
    await waitBagChange(page, total);
  }
  await dumpBag(page);
  throw new Error(`ตั้งจำนวนในถุงเป็น ${quantity} ไม่สำเร็จ (ตอนนี้มี ${await bagTotal(page)})`);
}

// อ่าน "ยอดชำระเงินของคุณ" จากหน้าตรวจทาน
async function orderTotal(page) {
  const text = await page.locator('body').innerText();
  const matches = [...text.matchAll(/ยอดชำระเงินของคุณ\s*฿\s*([\d,]+(?:\.\d+)?)/g)];
  const last = matches.at(-1);
  return last ? parseFloat(last[1].replace(/,/g, '')) : null;
}

// Apple แสดงร้านให้เองแล้ว: ไปขั้นตอนเลือกสาขาต่อได้เลย
async function logShownStores(page, postalCode) {
  const near = await page.getByText(/แสดงร้านใกล้เคียง:/).first().innerText().catch(() => '');
  const shownCode = near.match(/\d{5}/)?.[0];
  if (shownCode && shownCode !== postalCode) {
    console.log(`ℹ️  Apple แสดงร้านใกล้ ${shownCode} ให้แล้ว (ไม่ใช่ ${postalCode}) ใช้รายชื่อร้านนี้เลือกสาขาต่อ`);
  } else {
    console.log(`✅ Apple แสดงร้านให้เลือกแล้ว${shownCode ? ` (ใกล้ ${shownCode})` : ''} ข้ามการกรอกรหัสไปรษณีย์`);
  }
}

// ค้นหาสาขาจากรหัสไปรษณีย์: ปุ่ม "นำไปใช้" จะ disabled จนกว่าหน้าเว็บจะรับรู้ค่าที่กรอก
// ถ้ากรอกเร็วเกินไป (ช่องยังไม่พร้อม) ค่าจะไม่เข้า จึงกรอกซ้ำจนปุ่มกดได้
async function searchPickupStores(page, postalCode) {
  // นับเฉพาะรายชื่อร้านที่มองเห็นจริง (Apple อาจซ่อน radio ไว้ในหน้าตั้งแต่แรก)
  const storeList = page.locator('input[type="radio"][name*="storeLocator" i]').locator('visible=true')
    .or(page.getByText(/เลือกร้านที่คุณจะมารับสินค้า/).locator('visible=true'));
  const apply = page.locator('[data-autom="checkout-cityState-นำไปใช้"], button[id$="storeLocator.search"]')
    .or(page.locator('button').filter({ hasText: /^\s*นำไปใช้\s*$/ }))
    .locator('visible=true').first();
  // เฉพาะช่องพิมพ์ข้อความ ไม่เอา checkbox "บันทึกตำแหน่งของฉัน" ที่ id มี storeLocator เหมือนกัน
  const zipInput = page.locator('input[id*="storeLocator" i]:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])')
    .or(page.getByPlaceholder(/รหัสไปรษณีย์/))
    .or(page.getByRole('textbox', { name: /รหัสไปรษณีย์/ }))
    .locator('visible=true').first();

  // รอดูว่าจะขึ้นอะไรก่อน: รายชื่อร้าน (Apple จับตำแหน่ง/จำรหัสไว้แล้วแสดงร้านให้เลย) หรือช่องรหัสไปรษณีย์
  const first = await Promise.race([
    storeList.first().waitFor({ timeout: 15000 }).then(() => 'stores'),
    zipInput.waitFor({ timeout: 15000 }).then(() => 'zip'),
  ]).catch(() => null);
  // ช่องรหัสขึ้นก่อน แต่ร้านอาจตามมาติดๆ เช็กอีกครั้งสั้นๆ
  if (first === 'zip' && await storeList.first().waitFor({ timeout: 1000 }).then(() => true, () => false)) {
    return logShownStores(page, postalCode);
  }
  if (first === 'stores') return logShownStores(page, postalCode);
  if (!first) throw new Error('ไม่มีทั้งรายชื่อร้านและช่อง "รหัสไปรษณีย์" สำหรับค้นหาสาขา');

  for (let attempt = 1; attempt <= 5; attempt++) {
    await zipInput.click();
    await zipInput.fill('');
    if (attempt === 1) await zipInput.fill(postalCode);
    else await zipInput.pressSequentially(postalCode, { delay: 40 });
    let enabled = false;
    for (const end = Date.now() + 3000; !enabled && Date.now() < end; await page.waitForTimeout(100)) {
      enabled = await apply.isEnabled({ timeout: 500 }).catch(() => false);
    }
    if (enabled) {
      await apply.click();
      await storeList.first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {
        throw new Error(`ค้นหาสาขาจากรหัส ${postalCode} แล้วไม่มีรายชื่อร้านขึ้น`);
      });
      return;
    }
    // ไม่มีปุ่มนำไปใช้ให้กด: ลองกด Enter
    if (!(await apply.count())) {
      await zipInput.press('Enter');
      if (await storeList.first().waitFor({ state: 'attached', timeout: 10000 }).then(() => true, () => false)) return;
    }
    console.warn(`⚠️  ปุ่ม "นำไปใช้" ยังกดไม่ได้ กรอกรหัสใหม่ (ครั้งที่ ${attempt})`);
    await page.waitForTimeout(500);
  }
  throw new Error('กรอกรหัสไปรษณีย์แล้วปุ่ม "นำไปใช้" ยังกดไม่ได้');
}

const field = (name) => [`input[name$=".${name}"]`, `input[name="${name}"]`, `input[id$="${name}"]`];

async function runCheckout(instance = 1) {
  console.log(`🚀 เปิดเบราว์เซอร์ ${instance} เพื่อทำรายการ...`);
  // browser: "chromium" (ใช้ Chrome ในเครื่องผ่าน browserChannel) หรือ "webkit" (engine เดียวกับ Safari)
  const type = settings.browser || 'chromium';
  const sessionDirectory = createBrowserSession(instance);
  console.log(`🪟 เบราว์เซอร์ ${instance}: โปรไฟล์ใหม่ ${sessionDirectory}`);
  const context = await playwright[type].launchPersistentContext(sessionDirectory, {
    headless: false,
    timeout: 30000,
    channel: type === 'chromium' ? settings.browserChannel || undefined : undefined,
    slowMo: settings.slowMoMs ?? 0,
    args: type === 'chromium' ? [
      ...(settings.stealthMode ? ['--disable-blink-features=AutomationControlled'] : []),
      '--start-maximized',
    ] : undefined,
    locale: 'th-TH',
    viewport: null,
    // เว้นว่างเพื่อใช้ User-Agent จริงของเบราว์เซอร์ที่เปิด
    ...(settings.userAgent ? { userAgent: settings.userAgent } : {}),
  });
  console.log(`✅ เชื่อมต่อเบราว์เซอร์ ${instance} แล้ว`);
  if (type === 'chromium' && settings.stealthMode) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  }
  // Persistent context มีแท็บเริ่มต้นอยู่แล้ว ใช้แท็บนั้นเพื่อไม่ทิ้ง about:blank ไว้
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  let checkoutStep = 'เริ่มต้น';
  let lastRejectedResponse;
  const requestPath = (request) => {
    const url = new URL(request.url());
    return `${url.origin}${url.pathname}`;
  };
  page.on('requestfailed', (request) => {
    if (request.isNavigationRequest() || /\/shop\//.test(new URL(request.url()).pathname)) {
      console.warn(`[request][${instance}][${checkoutStep}] ${request.method()} ${requestPath(request)} โหลดไม่สำเร็จ: ${request.failure()?.errorText || 'unknown error'}`);
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    const status = response.status();
    if ([403, 429, 541].includes(status)) {
      lastRejectedResponse = { status, step: checkoutStep, method: request.method(), path: requestPath(request) };
      console.warn(`[rejected][${instance}][${checkoutStep}] HTTP ${status} ${request.method()} ${requestPath(request)}`);
    } else if (diagnoseBag && /\/shop\//.test(new URL(response.url()).pathname) && ['document', 'xhr', 'fetch'].includes(request.resourceType())) {
      console.log(`[response][${instance}][${checkoutStep}] HTTP ${status} ${request.method()} ${requestPath(request)}`);
    }
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      const url = new URL(response.url());
      console.log(`[navigation] HTTP ${response.status()} ${url.origin}${url.pathname}`);
    }
  });

  try {
    console.log('🌐 กำลังเปิดหน้า Apple หลัก...');
    checkoutStep = 'เปิดหน้า Apple หลัก';
    await page.goto('https://www.apple.com/th/', { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await assertNotBlocked(page, 'เปิดหน้า Apple หลัก');
    await page.waitForTimeout(1000 + Math.random() * 1000);

    checkoutStep = 'เปิดหน้าสินค้า';
    await page.goto(settings.productUrl, { waitUntil: 'domcontentloaded' });
    await assertNotBlocked(page, 'เปิดหน้าสินค้า');
    await pause(page);

    // เลือกขนาด/สี/ความจุ (กรณีใช้ URL หน้าเลือกรุ่นที่ยังไม่ได้เลือกอะไร) แล้วเลือก "ไม่มีการคุ้มครอง AppleCare+"
    // ปุ่มใส่ถุงจะ disabled จนกว่าจะเลือกครบ
    for (const [name, value] of Object.entries(settings.options || {})) {
      if (!value) continue; // ค่าว่าง = ไม่ต้องเลือก (ใช้ค่าเริ่มต้นของ Apple)
      await selectRadio(page, page.locator(`input[name="${name}"][value="${value}"]`), `${name}=${value}`);
    }
    const noAppleCare = page.locator('input[data-autom="noapplecare"]');
    const addToBag = page.locator('button[data-autom="add-to-cart"]');
    await selectRadio(page, noAppleCare, 'ไม่มีการคุ้มครอง AppleCare+');
    await page.waitForFunction(() => {
      const button = document.querySelector('button[data-autom="add-to-cart"]');
      return button && !button.disabled;
    }, null, { timeout: 30000 });
    await pause(page);
    checkoutStep = 'ใส่ลงถุง / attach';
    await addToBag.click();
    // หน้าหลังใส่ถุง (step=attach) มีปุ่ม "ดูสินค้าในถุง"
    const bagLink = page.locator('a[href*="/shop/bag"], button').filter({
      hasText: /ดูสินค้าในถุง|ดูถุง|ตรวจสอบถุง|ไปที่ถุง|Review Bag|View Bag/i,
    }).first();
    // รอจนถึงถุง หรือมีลิงก์ตรวจสอบถุงจากผลการเพิ่มสินค้า
    const deadline = Date.now() + 30000;
    try {
      while (!new URL(page.url()).pathname.endsWith('/shop/bag')) {
        await assertNotBlocked(page, 'ใส่ลงในถุง');
        if (await bagLink.isVisible()) {
          checkoutStep = 'เปิดหน้าถุง';
          await bagLink.click();
          await page.waitForURL((url) => url.pathname.endsWith('/shop/bag'), { timeout: 30000 });
          break;
        }
        if (Date.now() > deadline) throw new Error('ยังยืนยันการใส่ถุงไม่สำเร็จ กรุณาตรวจถุงในหน้าต่างนี้ก่อนทำต่อ');
        await page.waitForTimeout(200);
      }
      await assertNotBlocked(page, 'เปิดหน้าถุง');
    } catch (err) {
      // การเพิ่มสินค้าอาจสำเร็จแล้ว แม้หน้า attach จะแสดง error
      // เปิดถุงใน session เดิมเพื่อให้ตรวจ โดยไม่เพิ่มสินค้าซ้ำหรือชำระเงินต่อ
      console.warn(`⚠️  หลังใส่ถุง: ${err.message}`);
      console.log('🛍️  กำลังเปิดหน้าถุงเพื่อตรวจผลการเพิ่มสินค้า...');
      try {
        checkoutStep = 'ตรวจถุงหลังเกิดข้อผิดพลาด';
        await page.goto('https://www.apple.com/th/shop/bag', { waitUntil: 'domcontentloaded' });
        await assertNotBlocked(page, 'ตรวจถุงหลังเพิ่มสินค้าไม่สำเร็จ');
      } catch (bagError) {
        throw new Error(`เปิดหน้าถุงไม่ได้: ${bagError.message} — กรุณาเปิดถุงด้วยตนเองเพื่อตรวจสินค้า`);
      }
      throw new Error('เปิดหน้าถุงแล้ว กรุณาตรวจรุ่น สี ความจุ และจำนวน ก่อนทำรายการต่อด้วยตนเอง');
    }
    if (diagnoseBag) {
      console.log('🔎 ตรวจถึงหน้าถุงแล้ว หยุดก่อนปรับจำนวนและชำระเงิน');
      await new Promise(() => {});
    }
    checkoutStep = 'ปรับจำนวน / checkout';
    await pause(page);
    await setBagQuantity(page, settings.quantity || 1);
    await pause(page);
    await clickFirst(page, ['[data-autom="checkout"]', '#shoppingCart\\.actions\\.navCheckout', 'button#bag-checkout-btn'], 'ชำระเงิน');
    await assertNotBlocked(page, 'กดชำระเงิน');
    await pause(page);

    await clickFirst(page, ['#signIn\\.guestLogin\\.guestLogin', '[data-autom="guest-checkout"]', 'button#as-guest-continue'], 'ดำเนินการต่อแบบผู้เยี่ยมชม', 30000);
    await assertNotBlocked(page, 'ซื้อแบบผู้เยี่ยมชม');
    await pause(page);

    // หน้า "คุณต้องการรับสินค้าด้วยวิธีใด": เลือกมารับเองที่ร้าน แล้วค้นหาสาขาจากรหัสไปรษณีย์
    const pickup = page.locator('button, label, [role="radio"]').filter({ hasText: /มารับสินค้าด้วยตัวเอง/ }).first();
    await pickup.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {
      throw new Error('หาตัวเลือก "ฉันจะมารับสินค้าด้วยตัวเอง" ไม่เจอ');
    });
    await pickup.click();
    console.log('✅ เลือก "ฉันจะมารับสินค้าด้วยตัวเอง"');
    await pause(page);

    await searchPickupStores(page, settings.pickupPostalCode);
    console.log(`✅ ค้นหาสาขาด้วยรหัสไปรษณีย์ ${settings.pickupPostalCode}`);
    await assertNotBlocked(page, 'ค้นหาสาขา');

    await pause(page);
    await selectPickupSlot(page);
    await pause(page);
    await clickFirst(page, ['#rs-checkout-continue-button-bottom', '[data-autom="fulfillment-continue-button"]', 'button:has-text("ดำเนินการต่อ")'], 'ดำเนินการต่อ');
    await assertNotBlocked(page, 'ยืนยันสาขาและเวลารับ');

    // หน้า "ตอนนี้โปรดกรอกข้อมูลการรับสินค้าด้วยตัวเอง": ผู้รับคือตัวเอง แล้วกรอกชื่อ/อีเมล/เบอร์
    await page.getByText(/ตอนนี้โปรดกรอกข้อมูลการรับสินค้า/).first().waitFor({ timeout: 30000 }).catch(() => {
      throw new Error('ไม่ถึงหน้ากรอกข้อมูลการรับสินค้า');
    });
    const self = page.locator('button, label, [role="radio"]').filter({ hasText: /ฉันจะมารับสินค้า\s*ด้วยตัวเอง/ }).first();
    if (await self.isVisible().catch(() => false)) await self.click();
    await pause(page);

    await fillFirst(page, [page.getByLabel('ชื่อ', { exact: true }), ...field('firstName')], process.env.FIRST_NAME, 'ชื่อ');
    await fillFirst(page, [page.getByLabel('นามสกุล', { exact: true }), ...field('lastName')], process.env.LAST_NAME, 'นามสกุล');
    await fillFirst(page, [page.getByLabel('อีเมล', { exact: true }), ...field('emailAddress')], process.env.EMAIL, 'อีเมล');
    await fillFirst(page, [page.getByLabel(/หมายเลขโทรศัพท์มือถือ/), ...field('mobilePhone'), ...field('daytimePhone')], process.env.PHONE, 'หมายเลขโทรศัพท์มือถือ');
    console.log('✅ กรอกข้อมูลผู้มารับสินค้าแล้ว');
    await pause(page);
    await clickFirst(page, ['#rs-checkout-continue-button-bottom', 'button:has-text("ดำเนินการต่อที่การชำระเงิน")'], 'ดำเนินการต่อที่การชำระเงิน');
    await assertNotBlocked(page, 'ดำเนินการต่อที่การชำระเงิน');
    await pause(page);

    // หน้า "วิธีการชำระเงิน": เลือกบัตรเครดิต/เดบิต แล้วกรอกบัตร
    const cardOption = page.locator('button, label, [role="radio"]').filter({ hasText: /บัตรเครดิตหรือบัตรเดบิต/ }).locator('visible=true').first();
    await cardOption.waitFor({ timeout: 30000 }).catch(() => {
      throw new Error('ไม่ถึงหน้า "วิธีการชำระเงิน"');
    });
    await cardOption.click();
    await pause(page);

    const missing = [];
    const fill = async (label, value, name) => {
      if (!(await fillField(page, label, value, name))) missing.push(name);
    };
    if (process.env.CARD_NUMBER) {
      await fill(/หมายเลขบัตรเครดิต/, process.env.CARD_NUMBER, 'หมายเลขบัตร');
      await fill(/วันหมดอายุ/, process.env.CARD_EXP, 'วันหมดอายุ');
      await fill(/^CVV$|รหัสความปลอดภัย/, process.env.CARD_CVV, 'CVV');
    }

    // 1) ช่องข้อความของที่อยู่สำหรับเรียกเก็บเงินก่อน
    await fill(/^ชื่อ$/, process.env.FIRST_NAME, 'ชื่อ');
    await fill(/^นามสกุล$/, process.env.LAST_NAME, 'นามสกุล');
    await fill(/หมายเลขหรือชื่ออาคาร/, process.env.STREET_ADDRESS, 'หมายเลขหรือชื่ออาคาร, ชื่อถนน');
    await fill(/ชื่อถนน, ซอย, หมู่/, process.env.BILLING_STREET, 'ชื่อถนน, ซอย, หมู่');
    if (process.env.BILLING_ADDRESS_EXTRA) await fill(/ข้อมูลที่อยู่เพิ่มเติม/, process.env.BILLING_ADDRESS_EXTRA, 'ข้อมูลที่อยู่เพิ่มเติม');
    await fill(/^รหัสไปรษณีย์$/, process.env.POSTAL_CODE, 'รหัสไปรษณีย์');
    await pause(page);

    // 2) dropdown ที่อยู่ทีหลัง: จังหวัด → เขต/อำเภอ → แขวง/ตำบล ตามลำดับ (ตัวถัดไปจะโหลดหลังเลือกตัวก่อน)
    await selectByLabel(page, /จังหวัด/, process.env.BILLING_PROVINCE);
    await selectByLabel(page, /เขต\s*\/\s*อำเภอ/, process.env.BILLING_DISTRICT);
    await selectByLabel(page, /แขวง\s*\/\s*ตำบล/, process.env.BILLING_SUBDISTRICT);
    await pause(page);

    // 3) สุดท้ายก่อนกดตรวจทาน: บัตรเครดิตบางใบจะมี dropdown "เลือกจำนวนเดือนที่จะผ่อนชำระ" ขึ้นหลังกรอกเลขบัตร: เลือกตัวเลือกแรกเสมอ
    const installment = await findField(page, /จำนวนเดือนที่จะผ่อนชำระ/, 'select', 5000);
    if (installment) {
      const opt = await installment.evaluate((el) => {
        const o = [...el.options].find((x) => x.value && !x.disabled);
        return o && { value: o.value, text: o.textContent.trim() };
      });
      if (!opt) {
        missing.push('จำนวนเดือนที่จะผ่อนชำระ');
      } else {
        await installment.selectOption(opt.value);
        console.log(`✅ เลือกการผ่อนชำระ: ${opt.text}`);
      }
      await pause(page);
    }

    if (missing.length) {
      await dumpFields(page);
      throw new Error(`กรอกไม่สำเร็จ: ${missing.join(', ')} (ดูรายการช่องที่พบด้านบน)`);
    }
    console.log('✅ กรอกข้อมูลบัตรและที่อยู่สำหรับเรียกเก็บเงินแล้ว');

    // กด "ตรวจทานคำสั่งซื้อของคุณ" เพื่อไปหน้าสรุป — ปุ่มสั่งซื้อสุดท้ายให้ผู้ใช้กดเอง
    await pause(page);
    await clickFirst(page, ['#rs-checkout-continue-button-bottom', 'button:has-text("ตรวจทานคำสั่งซื้อของคุณ")'], 'ตรวจทานคำสั่งซื้อของคุณ');
    await assertNotBlocked(page, 'ตรวจทานคำสั่งซื้อ');

    // หน้าตรวจทาน: ตรวจยอดชำระก่อน แล้วกด "ส่งคำสั่งซื้อ" (ผู้ใช้ยืนยันใน popup ถัดไปเอง)
    const placeOrder = page.locator('button').filter({ hasText: /^\s*ส่งคำสั่งซื้อ\s*$/ }).locator('visible=true').first();
    await placeOrder.waitFor({ timeout: 30000 }).catch(() => {
      throw new Error('ไม่ถึงหน้าตรวจทานคำสั่งซื้อ (หาปุ่ม "ส่งคำสั่งซื้อ" ไม่เจอ)');
    });
    const total = await orderTotal(page);
    if (total == null) throw new Error('อ่านยอดชำระเงินไม่ได้ ไม่กดส่งคำสั่งซื้อ');
    console.log(`💰 ยอดชำระเงิน: ฿${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    if (settings.maxOrderTotal && total > settings.maxOrderTotal) {
      throw new Error(`ยอด ฿${total.toLocaleString()} เกินที่ตั้งไว้ ฿${settings.maxOrderTotal.toLocaleString()} (จำนวนในถุงอาจเกิน) ไม่กดส่งคำสั่งซื้อ`);
    }

    if (settings.autoPlaceOrder) {
      await pause(page);
      await placeOrder.click();
      notify(`กด "ส่งคำสั่งซื้อ" แล้ว (฿${total.toLocaleString()}) — ยืนยันใน popup เอง`);
    } else {
      notify('ถึงหน้าตรวจทานคำสั่งซื้อแล้ว ตรวจข้อมูล แล้วกด "ส่งคำสั่งซื้อ" เอง');
    }
  } catch (err) {
    if (lastRejectedResponse) {
      const rejected = lastRejectedResponse;
      console.warn(`🔎 คำขอที่ถูกปฏิเสธล่าสุด: HTTP ${rejected.status} ${rejected.method} ${rejected.path} (ช่วง ${rejected.step}) — อาจไม่ใช่สาเหตุของข้อผิดพลาดล่าสุด`);
    }
    notify(`อัตโนมัติหยุดที่: ${err.message} — ทำต่อเองในเบราว์เซอร์ได้เลย`);
  }

  // ไม่ปิดเบราว์เซอร์ บอทจะไม่กดสั่งซื้อให้ ต้องยืนยันเอง
  console.log('เบราว์เซอร์จะเปิดค้างไว้ กด Ctrl+C เมื่อทำรายการเสร็จ');
  await new Promise(() => {});
}

async function runCheckouts() {
  const count = 1;
  console.log(`🪟 เริ่มบอต ${count} หน้าต่าง แยกเซสชันกัน`);
  await Promise.all(Array.from({ length: count }, (_, index) =>
    runCheckout(index + 1).catch((err) => {
      console.error(`❌ เบราว์เซอร์ ${index + 1}: ${err.message}`);
      process.exitCode = 1;
    }),
  ));
}

async function main() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`❌ ยังไม่ได้ตั้งค่าใน .env: ${missing.join(', ')} (ดูตัวอย่างใน .env.example)`);
    process.exit(1);
  }

  console.log(`👀 เฝ้าสต็อก ${settings.partNumber} ใกล้ ${settings.location} ทุก ~${settings.checkIntervalMs / 1000} วินาที`);
  let consecutiveFailures = 0;
  for (;;) {
    let delayMs = Math.max(30000, settings.checkIntervalMs || 30000);
    try {
      const stores = await checkStock();
      consecutiveFailures = 0;
      if (stores.length) {
        notify(`มีของแล้ว: ${stores.join(', ')}`);
        return runCheckouts();
      }
      console.log(`[${now()}] ยังไม่มีของ`);
    } catch (err) {
      consecutiveFailures += 1;
      const cooldown = Math.min(
        (settings.errorBackoffMs || 60000) * 2 ** Math.min(consecutiveFailures - 1, 10),
        settings.maxBackoffMs || 900000,
      );
      delayMs = Math.max(delayMs, cooldown, err.retryAfterMs || 0);
      console.warn(`[${now()}] เช็กสต็อกไม่สำเร็จ: ${err.message}`);
    }
    delayMs += Math.random() * Math.max(0, settings.jitterMs ?? 30000);
    console.log(`[${now()}] เช็กอีกครั้งใน ~${Math.ceil(delayMs / 1000)} วินาที`);
    await sleep(delayMs);
  }
}

if (process.argv.includes('--checkout-only') || diagnoseBag) {
  runCheckouts().catch((err) => { console.error(err.message); process.exitCode = 1; });
} else {
  main().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
