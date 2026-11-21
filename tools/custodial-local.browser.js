import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from './wallet-browser-e2e/node_modules/@playwright/test/index.mjs';

// Real localhost browser/API acceptance. No routes, signatures or financial APIs are mocked.
const frontend = 'http://127.0.0.1:5173';
const backend = 'http://127.0.0.1:3000';
const output = join(tmpdir(), 'khmerfp-current-platform');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const contexts = [];
const get = async (page, path) => {
  const response = await page.request.get(backend + '/api/trading' + path);
  assert.equal(response.status(), 200);
  const value = await response.json();
  assert.equal(value.mode, 'LOCAL_MOCK_ONLY');
  return value;
};
async function login(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto(frontend);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('input[name=email]').fill(email);
  await page.locator('input[name=password]').fill('LocalTradingDemo!2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.locator('header')).toContainText('$');
  return page;
}
async function submit(page) {
  const pending = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === backend + '/api/trading/orders');
  await page.getByRole('button', { name: 'Submit order', exact: true }).click();
  const response = await pending;
  assert.equal(response.status(), 202);
  return response.json();
}
async function terminal(page, id, status) {
  await expect.poll(async () => (await get(page, '/me/orders?limit=100')).orders.find(order => order.id === String(id))?.status, { timeout: 15000 }).toBe(status);
}

try {
  const page = await login('buyer@local.khmerfp.test');
  const seller = await login('seller@local.khmerfp.test');
  await expect.poll(async () => (await get(page, '/markets?view=current')).markets.filter(m => m.trading_status === 'OPEN' && BigInt(m.volume_cents) > 0n).length, { timeout: 120000 }).toBe(4);
  let snapshot = await get(page, '/markets?view=current');
  assert.equal(snapshot.markets.length, 4);
  assert.equal(new Set(snapshot.markets.map(m => m.template_key)).size, 4);
  for (const market of snapshot.markets) {
    assert.equal(market.outcomes.length, market.market_type === 'BINARY' ? 2 : 6);
    assert.ok(market.outcomes.every(o => o.yesPriceCents !== null && o.noPriceCents !== null));
  }
  await expect(page.locator('.market-card')).toHaveCount(4);
  await expect(page.getByRole('navigation')).not.toContainText('0 markets');
  await page.getByRole('navigation').getByRole('button', { name: 'Economy', exact: true }).click();
  await expect(page.locator('.market-card')).toHaveCount(3);
  await page.getByRole('navigation').getByRole('button', { name: 'Crypto', exact: true }).click();
  await expect(page.locator('.market-card')).toHaveCount(1);
  await page.getByRole('navigation').getByRole('button', { name: 'Trending', exact: true }).click();
  await expect(page.locator('.market-card svg')).not.toHaveCount(0);
  await page.screenshot({ path: join(output, 'desktop-current-markets.png'), fullPage: true });

  const bitcoin = snapshot.markets.find(m => m.template_key === 'khmerfp-btc5m');
  const before = await get(page, '/me/portfolio');
  await page.locator(`[data-market-id="${bitcoin.id}"]`).click();
  await expect(page.getByRole('region', { name: 'Order book' })).toContainText('53 cents');
  await page.getByLabel('Limit price (cents)', { exact: true }).fill('55');
  const buy = await submit(page);
  await terminal(page, buy.orderId, 'FILLED');
  assert.equal(BigInt((await get(page, '/me/portfolio')).cash.posted), BigInt(before.cash.posted) - 53n);
  await page.screenshot({ path: join(output, 'desktop-bitcoin-trading.png') });
  await page.getByLabel('Limit price (cents)', { exact: true }).fill('1');
  const cancel = await submit(page);
  await terminal(page, cancel.orderId, 'OPEN');
  await page.getByRole('button', { name: 'Close market', exact: true }).click();
  await page.locator('header').getByRole('button').filter({ hasText: '$' }).first().click();
  await page.getByRole('button', { name: /Your positions/ }).click();
  await page.getByRole('tab', { name: 'Order history' }).click();
  const article = page.locator(`[data-order-id="${cancel.orderId}"]`);
  await article.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(article.getByText('Cancelled', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).first().click();

  const sellerBefore = await get(seller, '/me/portfolio');
  await seller.locator(`[data-market-id="${bitcoin.id}"]`).click();
  await seller.getByRole('button', { name: 'Sell', exact: true }).click();
  await seller.getByLabel('Limit price (cents)', { exact: true }).fill('48');
  const sale = await submit(seller);
  await terminal(seller, sale.orderId, 'FILLED');
  assert.equal(BigInt((await get(seller, '/me/portfolio')).cash.posted), BigInt(sellerBefore.cash.posted) + 48n);
  await seller.context().close();

  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(output, 'mobile-current-markets.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'km');
  await page.screenshot({ path: join(output, 'mobile-current-markets-km.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch language' }).click();
  // A deliberately wrong device wall clock must not close an open backend round.
  await page.evaluate(() => { window.originalDateNow = Date.now; Date.now = () => window.originalDateNow() + 86400000; });
  await page.locator(`[data-market-id="${bitcoin.id}"]`).click();
  await expect(page.getByRole('button', { name: 'Submit order', exact: true })).toBeEnabled();
  await page.evaluate(() => { Date.now = window.originalDateNow; });
  await page.getByRole('button', { name: 'Close market', exact: true }).click();

  const rounds = [];
  const limit = process.argv.includes('--observe-rounds') ? 3 : 1;
  const deadline = Date.now() + 700000;
  while (rounds.length < limit) {
    assert.ok(Date.now() < deadline, 'Two real five-minute transitions did not complete');
    snapshot = await get(page, '/markets?view=current');
    const current = snapshot.markets.find(m => m.template_key === 'khmerfp-btc5m');
    assert.equal(snapshot.markets.filter(m => m.template_key === current.template_key).length, 1);
    if (current.trading_status === 'OPEN' && !rounds.some(r => r.id === current.id)) {
      assert.equal(Date.parse(current.trading_ends_at) - Date.parse(current.trading_starts_at), 300000);
      assert.ok(Date.parse(snapshot.serverTime) >= Date.parse(current.trading_starts_at));
      assert.ok(Date.parse(snapshot.serverTime) < Date.parse(current.trading_ends_at));
      await expect(page.locator(`[data-market-id="${current.id}"]`)).toBeVisible({ timeout: 15000 });
      if (rounds.length) {
        const old = rounds.at(-1);
        assert.equal((await get(page, '/markets/' + old.id)).market.trading_status, 'CLOSED');
        assert.equal(Date.parse(old.trading_ends_at), Date.parse(current.trading_starts_at));
        await expect(page.locator(`[data-market-id="${old.id}"]`)).toHaveCount(0);
      }
      rounds.push(current);
      await page.screenshot({ path: join(output, `bitcoin-round-${rounds.length}.png`), fullPage: true });
      console.log(JSON.stringify({ observedLiveRound: rounds.length, id: current.id, serverTime: snapshot.serverTime, cutoff: current.trading_ends_at }));
    }
    if (rounds.length < limit) await page.waitForTimeout(5000);
  }
  await page.getByRole('link', { name: 'Rounds', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'View all rounds' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Will Bitcoin be up in the next 5 minutes?');
  await page.screenshot({ path: join(output, 'round-history.png'), fullPage: true });
  writeFileSync(join(output, process.argv.includes('--observe-rounds') ? 'observed-rounds.json' : 'smoke-evidence.json'), JSON.stringify({ rounds, mockFundsOnly: true, screenshots: output }, null, 2));
  console.log('Actual local browser/API workflow passed; artifacts:', output);
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
