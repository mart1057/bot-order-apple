const playwright = require('playwright');
const settings = require('./settings.json');
const createBrowserSession = require('./browser-session');
const contexts = [];

async function main() {
  const results = await Promise.allSettled([1, 2, 3].map(async (number) => {
    const type = settings.browser || 'chromium';
    const sessionDirectory = createBrowserSession(number);
    console.log(`หน้าต่าง ${number}: โปรไฟล์ใหม่ ${sessionDirectory}`);
    const context = await playwright[type].launchPersistentContext(
      sessionDirectory,
      {
        headless: false,
        channel: type === 'chromium' ? settings.browserChannel || undefined : undefined,
        locale: 'th-TH',
        viewport: null,
      },
    );
    contexts.push(context);
    console.log(`เปิดเบราว์เซอร์ ${number} แล้ว`);
    const page = context.pages()[0] || await context.newPage();
    await page.goto(settings.productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    console.log(`หน้าต่าง ${number}: เปิดหน้าสินค้าแล้ว (ยังไม่ checkout)`);
  }));
  for (let index = 0; index < results.length; index++) {
    if (results[index].status === 'rejected') {
      console.error(`หน้าต่าง ${index + 1}: ${results[index].reason.message}`);
      process.exitCode = 1;
    }
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await Promise.allSettled(contexts.map((context) => context.close()));
  });
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
