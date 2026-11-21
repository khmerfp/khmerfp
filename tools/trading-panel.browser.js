import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from './wallet-browser-e2e/node_modules/@playwright/test/index.mjs';
import { estimateBook } from '../client/src/services/bookEstimate.js';

// Opt-in acceptance against the verified local mock platform. No wallet signing,
// public RPC, production URL, mock provider or financial projection edits.
const api = 'http://127.0.0.1:3000/api/trading';
const site = 'http://127.0.0.1:5173';
const artifacts = join(tmpdir(), 'khmerfp-trading-panel');
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const contexts = [], evidence = [];
async function get(page, path) {
  const response = await page.request.get(api + path);
  assert.equal(response.status(), 200);
  const data = await response.json();
  assert.equal(data.mode, 'LOCAL_MOCK_ONLY');
  return data;
}
async function pageFor(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  if (email) {
    const response = await context.request.post('http://127.0.0.1:3000/api/auth/login', {
      headers: { Origin: site }, data: { email, password: 'LocalTradingDemo!2026' },
    });
    assert.equal(response.status(), 200);
  }
  const page = await context.newPage();
  page.on('response',response=>{if(response.status()>=400&&response.url().includes('/api/trading'))console.error('Panel HTTP:',response.status(),new URL(response.url()).pathname)});
  page.on('pageerror',error=>console.error('Panel page error:',error.message));
  await page.goto(site);
  return page;
}
async function open(page, market, polarity, side, type) {
  await page.locator(`[data-market-id="${market.id}"].market-card`).click();
  await page.getByRole('button', { name: polarity === 'YES' ? 'Yes' : 'No', exact: true }).click();
  await page.getByRole('button', { name: side === 'BUY' ? 'Buy' : 'Sell', exact: true }).click();
  await page.getByRole('button', { name: type === 'MARKET' ? 'Market' : 'Limit', exact: true }).click();
  await page.getByLabel(type === 'LIMIT' ? 'Limit price (cents)' : 'Protected price (cents)', { exact: true }).fill(side === 'BUY' ? '60' : '40');
  if (type === 'MARKET' && side === 'BUY') await page.getByLabel('Maximum spend (USD cents)', { exact: true }).fill('60');
}
async function identity(page, market, tokenId) {
  await expect(page.getByRole('region', { name: 'Order book' })).toHaveAttribute('data-token-id', tokenId);
  const ids = await page.evaluate(() => {
    const ticket = document.querySelector('section[aria-label="Trade"]');
    const book = document.querySelector('section[aria-label="Order book"]');
    const chart = document.querySelector('[data-price-history]');
    return [ticket, book, chart].map(element => [element.dataset.marketId, element.dataset.tokenId, element.dataset.snapshotId]);
  });
  assert.deepEqual(ids[0], ids[1]); assert.deepEqual(ids[0], ids[2]);
  assert.equal(ids[0][0], market.id); assert.equal(ids[0][1], tokenId); assert.ok(ids[0][2]);
  return ids[0][2];
}
const close = page => page.getByRole('button', { name: 'Close market', exact: true }).click();
const position = (portfolio, token) => BigInt(portfolio.positions.find(row => row.token_id === token)?.posted || '0');
try {
  const guest = await pageFor();
  let market;
  await expect.poll(async () => {
    market = (await get(guest, '/markets?view=current')).markets.find(row => row.template_key === 'khmerfp-btc5m');
    return market?.trading_status === 'OPEN' && BigInt(market.volume_cents) > 0n && Date.parse(market.trading_ends_at) - Date.now() > 270000;
  }, { timeout: 330000, intervals: [3000] }).toBe(true);
  const detail = (await get(guest, '/markets/' + market.id)).market;
  const token = polarity => detail.claims.find(claim => claim.outcome_index === 0 && claim.polarity === polarity).token_id;
  assert.notEqual(token('YES'), token('NO'));
  for (const width of [1440, 390]) {
    await guest.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const polarity of ['YES', 'NO']) for (const side of ['BUY', 'SELL']) for (const type of ['LIMIT', 'MARKET']) {
      await open(guest, market, polarity, side, type);
      await expect(guest.getByText('Estimated total', { exact: true }).locator('..')).toContainText(side === 'BUY' ? '$0.53' : '$0.48');
      await expect(guest.getByRole('button', { name: 'Estimate execution', exact: true })).toBeEnabled();
      await expect(guest.getByRole('button', { name: 'Sign in to trade', exact: true })).toBeDisabled();
      const snapshotId = await identity(guest, market, token(polarity));
      const book = await get(guest, `/markets/${market.id}/book/${token(polarity)}?userId=99999`);
      assert.equal(book.viewerUserId, null);
      assert.ok(!JSON.stringify(book.executionDepth).includes('user_id'));
      await expect(guest.getByText('Reference observation', { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText('Unavailable');
      await expect(guest.getByText('Not determined', { exact: true })).toBeVisible();
      evidence.push({ authenticated: false, width, polarity, side, type, tokenId: token(polarity), snapshotId });
      if (polarity === 'YES' && side === 'BUY' && type === 'LIMIT') await guest.screenshot({ path: join(artifacts, `guest-${width}.png`), fullPage: false });
      await close(guest);
    }
  }
  const forbidden = await guest.request.post(api + '/orders', { headers: { Origin: site }, data: {} });
  assert.equal(forbidden.status(), 401);
  await guest.context().close();

  console.log('Guest matrix passed; waiting for the real shared-IP rate window.');
  await new Promise(resolve=>setTimeout(resolve,61000));
  const buyer = await pageFor('buyer@local.khmerfp.test');
  const seller = await pageFor('seller@local.khmerfp.test');
  for (const width of [1440, 390]) {
    if(width===390){console.log('Desktop trade matrix passed; waiting for the next real rate window.');await new Promise(resolve=>setTimeout(resolve,61000));}
    await Promise.all([buyer, seller].map(page => page.setViewportSize({ width, height: width === 390 ? 844 : 900 })));
    for (const polarity of ['YES', 'NO']) for (const side of ['BUY', 'SELL']) for (const type of ['LIMIT', 'MARKET']) {
      const page = side === 'BUY' ? buyer : seller;
      await open(page, market, polarity, side, type);
      await expect(page.getByText('Estimated total', { exact: true }).locator('..')).toContainText(side === 'BUY' ? '$0.53' : '$0.48');
      const snapshotId = await identity(page, market, token(polarity));
      const before = await get(page, '/me/portfolio');
      const book = await get(page, `/markets/${market.id}/book/${token(polarity)}`);
      const terms = { marketId: market.id, tokenId: token(polarity), side, quantity: '1000000', priceCents: side === 'BUY' ? '60' : '40', ...(side === 'BUY' ? { maxSpendCents: '60' } : {}) };
      const reference = await page.request.post(api + '/quotes', { headers: { Origin: site }, data: terms });
      assert.equal(reference.status(), 200);
      const sql = await reference.json(), preview = estimateBook({ ...terms, userId: book.viewerUserId, snapshot: book });
      for (const field of ['estimatedExecutableQuantity', 'estimatedUnfilledQuantity', 'estimatedTotalCents', 'estimatedAverageExecutionPriceCents', 'stoppedReason']) assert.deepEqual(preview[field], sql[field], 'Approved SQL quote parity: ' + field);
      const responsePromise = page.waitForResponse(response => response.url() === api + '/orders' && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Submit order', exact: true }).click();
      const response = await responsePromise; assert.equal(response.status(), 202);
      const order = await response.json();
      await expect.poll(async () => (await get(page, '/me/orders?limit=100')).orders.find(row => row.id === String(order.orderId))?.status, { timeout: 15000 }).toBe('FILLED');
      const after = await get(page, '/me/portfolio');
      const delta = BigInt(sql.estimatedTotalCents) * (side === 'BUY' ? -1n : 1n);
      assert.equal(BigInt(after.cash.posted) - BigInt(before.cash.posted), delta);
      assert.equal(after.cash.reserved,before.cash.reserved);
      assert.equal(after.positions.find(p=>p.token_id===token(polarity)).reserved,before.positions.find(p=>p.token_id===token(polarity)).reserved);
      assert.equal(position(after, token(polarity)) - position(before, token(polarity)), side === 'BUY' ? 1000000n : -1000000n);
      const persisted = await get(page, `/markets/${market.id}/book/${token(polarity)}`);
      const ids = persisted.trades.slice().reverse().sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)).map(fill => fill.id).join(',');
      await expect(page.locator('svg[data-trade-ids]')).toHaveAttribute('data-trade-ids', ids, { timeout: 15000 });
      evidence.push({ authenticated: true, width, polarity, side, type, tokenId: token(polarity), snapshotId, orderId: order.orderId, totalCents: sql.estimatedTotalCents, sqlQuoteParity: true, cashAndPositionDeltaVerified: true });
      if (polarity === 'YES' && side === 'BUY' && type === 'LIMIT') await page.screenshot({ path: join(artifacts, `signed-in-${width}.png`) });
      await close(page);
    }
  }
  await open(buyer, market, 'YES', 'SELL', 'LIMIT');
  await expect(buyer.getByText('Your own resting order prevents this match.', { exact: true })).toBeVisible();
  writeFileSync(join(artifacts, 'evidence.json'), JSON.stringify({ cases: evidence, anonymousSubmissionRejected: true, selfTradePreventionVerified: true, mockFundsOnly: true }, null, 2));
  console.log('Passed:', evidence.length, 'panel cases; SQL quote parity and actual ledger deltas verified. Artifacts:', artifacts);
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
