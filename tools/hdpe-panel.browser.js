import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from './wallet-browser-e2e/node_modules/@playwright/test/index.mjs';
import { tradingLabels } from '../client/src/lib/tradingText.js';
import { T } from '../client/src/lib/i18n.js';
import { estimateBook } from '../client/src/services/bookEstimate.js';

// Opt-in local acceptance only. Uses existing mock-funded users and existing
// resting orders; never credits cash, creates inventory or inserts fake fills.
const api = 'http://127.0.0.1:3000/api/trading';
const site = 'http://127.0.0.1:5173';
const output = join(tmpdir(), 'khmerfp-hdpe-panel');
mkdirSync(output, { recursive: true });
const evidence = [], browser = await chromium.launch({ headless: true });
const contexts = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function get(page, path) {
  let response;
  for (let attempt = 0; ; attempt++) {
    response = await page.request.get(api + path);
    if (response.status() !== 429 || attempt >= 2) break;
    const seconds = Number(response.headers()['retry-after']);
    assert.ok(Number.isFinite(seconds) && seconds >= 1 && seconds <= 60);
    console.log('Read rate limit respected:', path, seconds, 'seconds.');
    await pause((seconds + 1) * 1000);
  }
  assert.equal(response.status(), 200, path);
  const data = await response.json();
  assert.equal(data.mode, 'LOCAL_MOCK_ONLY');
  return data;
}
async function pageFor(width, email) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
  contexts.push(context);
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  if (email) {
    const response = await context.request.post('http://127.0.0.1:3000/api/auth/login', {
      headers: { Origin: site }, data: { email, password: 'LocalTradingDemo!2026' },
    });
    assert.equal(response.status(), 200);
  }
  const page = await context.newPage();
  page.on('pageerror', error => console.error('Browser error:', error.message));
  await page.goto(site);
  return page;
}
async function open(page, market, lang, width) {
  if (lang === 'km') await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await page.locator(`.market-card[data-market-id="${market.id}"]`).click();
  await expect(page.locator('[data-outcome-selector]')).toBeVisible();
  for (const details of [page.locator('[data-price-history]'), page.getByRole('region', { name: tradingLabels(lang).book }).locator('details').first(), page.locator('[data-outcome-selector]')]) {
    if (width === 390) await expect(details).not.toHaveAttribute('open', '');
    else await expect(details).toHaveAttribute('open', '');
  }
}
async function select(page, market, detail, index, polarity, lang) {
  const t = { ...T[lang], ...tradingLabels(lang) };
  await page.getByRole('button', { name: polarity === 'YES' ? t.yes : t.no, exact: true }).click();
  const target = detail.claims.find(c => c.outcome_index === index && c.polarity === polarity);
  const selector = page.locator('[data-outcome-selector]');
  if (!await selector.evaluate(e => e.open)) await selector.locator('summary').click();
  await selector.locator(`[data-outcome-id="${target.outcome_id}"]`).click();
  const ticket = page.getByRole('region', { name: t.ticket, exact: true });
  await expect(ticket).toHaveAttribute('data-token-id', target.token_id);
  const book = page.getByRole('region', { name: t.book, exact: true });
  await expect(book).toHaveAttribute('data-token-id', target.token_id);
  const identities = await page.evaluate(() => [document.querySelector('[data-price-history]'), document.querySelector('section[data-snapshot-id][aria-label]:not([aria-label="Order book"])'), ...document.querySelectorAll('section[data-snapshot-id][aria-label]')].filter(Boolean).map(e => [e.dataset.marketId, e.dataset.tokenId, e.dataset.snapshotId]));
  for (const identity of identities) {
    assert.equal(identity[0], market.id); assert.equal(identity[1], target.token_id); assert.ok(identity[2]);
    assert.equal(identity[2], identities[0][2]);
  }
  // Check every displayed historical price against the corresponding registry
  // claim, independently of the selected token's executable estimate.
  const fresh = (await get(page, '/markets/' + market.id)).market;
  for (const claim of fresh.claims.filter(c => c.polarity === polarity)) {
    const row = selector.locator(`[data-price-token-id="${claim.token_id}"]`);
    await expect(row.locator('[data-outcome-price]')).toHaveText(claim.last_price_cents == null ? t.unavailable : `${claim.last_price_cents} ${t.cents}`);
  }
  const persisted = await get(page, `/markets/${market.id}/book/${target.token_id}`);
  const ids = persisted.trades.slice().reverse().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map(f => f.id).join(',');
  await expect(page.locator('svg[data-trade-ids]')).toHaveAttribute('data-trade-ids', ids);
  assert.equal(await page.locator('.detail-sheet').evaluate(e => e.scrollWidth <= e.clientWidth), true);
  return target;
}
const position = (portfolio, token) => BigInt(portfolio.positions.find(p => p.token_id === token)?.posted || '0');
function record(value) {
  evidence.push(value);
  writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
try {
  const probe = await pageFor(1440);
  const catalog = (await get(probe, '/markets?view=current')).markets;
  const market = catalog.find(m => m.template_key === 'khmerfp-hdpe-monthly');
  let bitcoinCutoff = Date.parse(catalog.find(m => m.template_key === 'khmerfp-btc5m').trading_ends_at);
  async function avoidConcurrentFixtureTrades(page) {
    // The existing local coordinator uses these same mock users for Bitcoin
    // fixture fills. Do not overlap its scheduled trades with a cash-delta sample.
    if (Date.now() >= bitcoinCutoff - 10000) {
      await pause(Math.max(0, bitcoinCutoff + 15000 - Date.now()));
      const current = (await get(page, '/markets?view=current')).markets.find(m => m.template_key === 'khmerfp-btc5m');
      bitcoinCutoff = Date.parse(current.trading_ends_at);
      assert.ok(bitcoinCutoff > Date.now() + 10000);
    }
  }
  assert.ok(market && market.trading_status === 'OPEN');
  const detail = (await get(probe, '/markets/' + market.id)).market;
  assert.equal(new Set(detail.claims.map(c => c.outcome_id)).size, 6);
  assert.equal(new Set(detail.claims.map(c => c.token_id)).size, 12);
  for (const claim of detail.claims) {
    const book = await get(probe, `/markets/${market.id}/book/${claim.token_id}`);
    for (const [side, price] of [['BUY', '48'], ['SELL', '53']]) {
      assert.ok(BigInt(book.levels.find(level => level.side === side && level.price_cents === price)?.quantity || '0') >= 4000000n, 'Existing liquidity insufficient; do not fabricate or refill it.');
    }
  }
  await probe.context().close();
  for (const width of [1440, 390]) {
    console.log('Respecting shared-IP request window before', width, 'authenticated matrix.');
    await pause(61000);
    const buyer = await pageFor(width, 'buyer@local.khmerfp.test');
    const seller = await pageFor(width, 'seller@local.khmerfp.test');
    for (const page of [buyer, seller]) await open(page, market, 'en', width);
    let rangeStarted = Date.now();
    for (let index = 0; index < 6; index++) {
      if (index > 0) {
        console.log('Respecting next request window before range', index);
        await pause(Math.max(0, 61000 - (Date.now() - rangeStarted)));
        rangeStarted = Date.now();
      }
      for (const polarity of ['YES', 'NO']) for (const side of ['BUY', 'SELL']) {
        const page = side === 'BUY' ? buyer : seller;
        const previousSide = await page.getByRole('button', { name: 'Sell', exact: true }).getAttribute('aria-pressed');
        const previousType = await page.getByRole('button', { name: 'Market', exact: true }).getAttribute('aria-pressed');
        const claim = await select(page, market, detail, index, polarity, 'en');
        assert.equal(await page.getByRole('button', { name: 'Sell', exact: true }).getAttribute('aria-pressed'), previousSide);
        assert.equal(await page.getByRole('button', { name: 'Market', exact: true }).getAttribute('aria-pressed'), previousType);
        await page.getByRole('button', { name: side === 'BUY' ? 'Buy' : 'Sell', exact: true }).click();
        for (const type of ['LIMIT', 'MARKET']) {
          await page.getByRole('button', { name: type === 'LIMIT' ? 'Limit' : 'Market', exact: true }).click();
          await page.getByLabel(type === 'LIMIT' ? 'Limit price (cents)' : 'Protected price (cents)', { exact: true }).fill(side === 'BUY' ? '60' : '40');
          if (type === 'MARKET' && side === 'BUY') {
            if (index === 0 && polarity === 'YES') {
              await page.getByLabel('Maximum spend (USD cents)', { exact: true }).fill('52');
              await expect(page.getByText('Estimated total', { exact: true }).locator('..')).toContainText('Unavailable');
            }
            await page.getByLabel('Maximum spend (USD cents)', { exact: true }).fill('60');
          }
          await expect(page.getByText('Estimated total', { exact: true }).locator('..')).toContainText(side === 'BUY' ? '$0.53' : '$0.48');
          await avoidConcurrentFixtureTrades(page);
          const before = await get(page, '/me/portfolio');
          const snapshot = await get(page, `/markets/${market.id}/book/${claim.token_id}`);
          const terms = { marketId: market.id, tokenId: claim.token_id, side, quantity: '1000000', priceCents: side === 'BUY' ? '60' : '40', ...(side === 'BUY' ? { maxSpendCents: '60' } : {}) };
          const response = await page.request.post(api + '/quotes', { headers: { Origin: site }, data: terms });
          assert.equal(response.status(), 200);
          const sql = await response.json(), preview = estimateBook({ ...terms, snapshot, userId: snapshot.viewerUserId });
          for (const key of ['estimatedExecutableQuantity', 'estimatedUnfilledQuantity', 'estimatedTotalCents', 'estimatedAverageExecutionPriceCents']) assert.deepEqual(preview[key], sql[key]);
          const submitted = page.waitForResponse(r => r.url() === api + '/orders' && r.request().method() === 'POST');
          await page.getByRole('button', { name: 'Submit order', exact: true }).click();
          const accepted = await submitted; assert.equal(accepted.status(), 202);
          const order = await accepted.json();
          await expect.poll(async () => (await get(page, '/me/orders?limit=100')).orders.find(o => o.id === String(order.orderId))?.status, { timeout: 20000 }).toBe('FILLED');
          const after = await get(page, '/me/portfolio');
          assert.equal(BigInt(after.cash.posted) - BigInt(before.cash.posted), BigInt(sql.estimatedTotalCents) * (side === 'BUY' ? -1n : 1n));
          assert.equal(position(after, claim.token_id) - position(before, claim.token_id), side === 'BUY' ? 1000000n : -1000000n);
          assert.equal(after.cash.reserved, before.cash.reserved);
          assert.equal(after.positions.find(p => p.token_id === claim.token_id).reserved, before.positions.find(p => p.token_id === claim.token_id).reserved);
          record({ width, lang: 'en', index, polarity, side, type, marketId: market.id, tokenId: claim.token_id, orderId: order.orderId, sqlQuoteParity: true, exactCashAndPositionDelta: true, reservationsReleased: true });
        }
      }
      console.log('Passed authenticated range', index, 'at', width);
    }
    await buyer.getByRole('dialog').getByRole('heading').first().scrollIntoViewIfNeeded();
    await buyer.screenshot({ path: join(output, `en-${width}.png`) });
    await Promise.all([buyer, seller].map(page => page.context().close()));
    console.log('Respecting request window before Khmer read-only matrix.'); await pause(61000);
    const guest = await pageFor(width);
    await open(guest, market, 'km', width);
    const t = { ...T.km, ...tradingLabels('km') };
    for (let index = 0; index < 6; index++) for (const polarity of ['YES', 'NO']) {
      const claim = await select(guest, market, detail, index, polarity, 'km');
      for (const side of ['BUY', 'SELL']) for (const type of ['LIMIT', 'MARKET']) {
        await guest.getByRole('button', { name: side === 'BUY' ? t.buy : t.sell, exact: true }).click();
        await guest.getByRole('button', { name: type === 'LIMIT' ? t.limit : t.market, exact: true }).click();
        await guest.getByLabel(`${type === 'LIMIT' ? t.price : t.protection} (${t.cents})`, { exact: true }).fill(side === 'BUY' ? '60' : '40');
        if (type === 'MARKET' && side === 'BUY') await guest.getByLabel(t.maxSpend, { exact: true }).fill('60');
        await expect(guest.getByText(t.estimate, { exact: true }).locator('..')).toContainText(side === 'BUY' ? '$0.53' : '$0.48');
        await expect(guest.getByRole('button', { name: t.signInToTrade, exact: true })).toBeDisabled();
        record({ width, lang: 'km', index, polarity, side, type, marketId: market.id, tokenId: claim.token_id, readOnly: true });
      }
    }
    await guest.getByRole('dialog').getByRole('heading').first().scrollIntoViewIfNeeded();
    await guest.screenshot({ path: join(output, `km-${width}.png`) });
    await guest.context().close();
  }
  assert.equal(evidence.length, 192);
  console.log('Passed 192 HDPE cases, including 96 actual local fills. No funding, inventory or liquidity was added. Evidence:', output);
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
