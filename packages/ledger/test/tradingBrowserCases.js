import { captureOriginalUi } from './originalUiReference.js';
import {runMarketOrderUiCases,runRoundTransitionUi,observeTradingRequests,captureTradingTicket} from './tradingUiAcceptance.js';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
// Reuse the project's existing pinned Playwright installation, not a new dependency.
import { chromium, expect } from '../../../tools/wallet-browser-e2e/node_modules/@playwright/test/index.mjs';
export async function runTradingBrowserCases({
  origin,
  buyer,
  seller,
  market,
  scenarios = [],
  createRecurring,
  reconcile
}) {
  const vite = await createServer({
    root: fileURLToPath(new URL('../../../client/', import.meta.url)),
    envDir: tmpdir(),
    configFile: fileURLToPath(new URL('../../../client/vite.config.js', import.meta.url)),
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false
    },
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(origin),
      'import.meta.env.VITE_CUSTODIAL_TRADING_LOCAL': JSON.stringify('true'),
      'import.meta.env.VITE_SIMULATED_TRADING': JSON.stringify('false')
    }
  });
  await vite.listen();
  const browser = await chromium.launch({
      headless: true
    }),
    url = `http://127.0.0.1:${vite.httpServer.address().port}`,
    contexts = [];
  async function login(person, viewport) {
    const context = await browser.newContext(viewport?{viewport}:{});
    contexts.push(context);
    await context.route('**/*', r => ['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort());
    const page = await context.newPage();
    observeTradingRequests(page);
    page.setDefaultTimeout(10000);
    page.on('response',response=>{if(response.status()>=400&&response.url().includes('/api/trading'))console.error('Trading request failed:',response.status(),new URL(response.url()).pathname)});
    await page.goto(url, {
      waitUntil: 'domcontentloaded'
    });
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'});
    await expect(page.getByRole('navigation', {
      name: 'Market categories'
    })).toBeVisible();
    await page.getByRole('button', {
      name: 'Sign in',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Email',
      exact: true
    }).click();
    await page.locator('input[name=email]').fill(person.email);
    await page.locator('input[name=password]').fill(person.secret);
    await page.getByRole('button', {
      name: 'Log in',
      exact: true
    }).click();
    await expect(page.locator('header').getByRole('button').filter({
      hasText: '$'
    }).first()).toBeVisible();
    return page;
  }
  async function open(page, m, polarity = 'No') {
    // Successful recovery can restore the already-selected market's dialog.
    if (!await page.getByRole('dialog').isVisible()) {
      await page.locator(`.market-card[data-market-id="${m.marketId}"]`).click();
    }
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', {
      name: polarity,
      exact: true
    }).click();
    try {
      await expect(page.getByRole('button', { name: 'Submit order', exact: true })).toBeEnabled();
    } catch (error) {
      await captureTradingTicket(page, origin, 'open-submit-disabled', true);
      throw error;
    }
    await captureTradingTicket(page, origin, 'open-submit-enabled');
    await expect(page.getByRole('navigation', {
      name: 'Market categories'
    })).toBeVisible();
    await expect(page.getByRole('dialog')).not.toContainText(m.marketId);
    await expect(page.getByRole('dialog')).not.toContainText('Canonical token');
    if (m.type === 'CATEGORICAL') {
      await expect(page.getByRole('region', { name: 'Event information', exact: true })).toBeVisible();
    } else {
      const reference = page.getByRole('region', { name: 'Live price', exact: true });
      await expect(reference).toBeVisible();
      await expect(reference).toContainText('Reference price unavailable.');
      assert.equal(await reference.locator('svg').count(), 0, 'mock observations cannot become reference charts');
    }
    await expect(page.getByRole('dialog').getByText('Executed price history', {
      exact: true
    })).toBeVisible();
    await expect(page.getByRole('region', {
      name: 'Order book'
    })).toBeVisible();
  }
  async function portfolio(page) {
    await page.locator('header').getByRole('button').filter({
      hasText: '$'
    }).first().click();
    await page.getByRole('button', {
      name: /Your positions/
    }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Your positions'
    });
    await expect(dialog).toBeVisible();
    return dialog;
  }
  try {
    const referenceLayouts=await captureOriginalUi(browser);
    const a = await login(buyer),
      b = await login(seller);
    // Exercise the real browser's EventSource error path without relaxing the
    // server's connection limits. Snapshot reads remain authoritative.
    let rejectedStreams = 0;
    const streamPattern = '**/api/trading/**events';
    await a.route(streamPattern, route => {
      rejectedStreams++;
      return route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":{"code":"TOO_MANY_STREAMS"}}' });
    });
    await a.reload();
    await expect.poll(() => rejectedStreams).toBeGreaterThan(0);
    await expect(a.locator('header')).toContainText('$');
    await open(a, market);
    await a.route('**/api/trading/me/portfolio', route => route.fulfill({
      status: 503, contentType: 'application/json', body: '{"error":{"code":"TRADING_UNAVAILABLE"}}',
    }));
    await a.getByRole('button', { name: 'Estimate execution', exact: true }).click();
    await expect(a.locator('header')).toContainText('Unavailable');
    await expect(a.getByRole('button', { name: 'Submit order', exact: true })).toHaveCount(0);
    await a.unroute('**/api/trading/me/portfolio');
    await a.unroute(streamPattern);
    await a.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(a.locator('header')).toContainText('$');
    console.log(JSON.stringify({ browserAcceptance: 'SSE-429-read-recovery', staleFinancialDisplaysCleared: true, authenticatedSnapshotRecovered: true }));
    await open(a, market);
    await open(b, market);
    await a.screenshot({
      path: join(tmpdir(), 'khmerfp-original-ui-detail.png')
    });
    await a.getByLabel('Limit price (cents)', {
      exact: true
    }).fill('65');
    const previous = await (await a.request.get(origin + '/api/trading/me/orders?limit=100')).json();
    let lost = false;
    await a.route('**/api/trading/orders', async r => {
      if (!lost && r.request().method() === 'POST') {
        lost = true;
        await r.fetch();
        await r.abort('failed');
      } else await r.continue();
    });
    await a.getByRole('button', {
      name: 'Submit order',
      exact: true
    }).click();
    await expect(a.getByRole('button', {
      name: 'Retry original request'
    })).toBeVisible();
    await a.getByRole('button', {
      name: 'Retry original request'
    }).click();
    await expect(a.getByText('Order accepted. Awaiting execution.')).toBeVisible();
    await b.getByRole('button', {
      name: 'Sell',
      exact: true
    }).click();
    await b.getByRole('button', {
      name: 'Submit order',
      exact: true
    }).click();
    await expect(b.getByText('Order accepted. Awaiting execution.')).toBeVisible();
    await a.getByRole('button', {
      name: 'Close market',
      exact: true
    }).click();
    let panel = await portfolio(a);
    await expect(panel.getByRole('button').filter({
      hasText: 'Available: 0Reserved: 0'
    })).toHaveCount(0);
    await panel.getByRole('tab', {
      name: 'Order history'
    }).click();
    await expect(panel.getByText('Filled', {
      exact: true
    }).first()).toBeVisible({
      timeout: 15000
    });
    assert.equal((await (await a.request.get(origin + '/api/trading/me/orders?limit=100')).json()).orders.length, previous.orders.length + 1);
    await expect(panel).not.toContainText(market.marketId);
    await panel.getByRole('button', {
      name: 'Cancel',
      exact: true
    }).click();
    await a.reload();
    panel = await portfolio(a);
    await panel.getByRole('tab', {
      name: 'Order history'
    }).click();
    await expect(panel.getByText('Filled', {
      exact: true
    }).first()).toBeVisible();
    await panel.getByRole('button', {
      name: 'Cancel',
      exact: true
    }).click();
    await a.context().setOffline(true);
    await a.waitForTimeout(100);
    await a.context().setOffline(false);
    await open(a, market);
    await a.getByLabel('Limit price (cents)', {
      exact: true
    }).fill('1');
    await a.getByRole('button', {
      name: 'Submit order',
      exact: true
    }).click();
    await expect(a.getByText('Order accepted. Awaiting execution.')).toBeVisible();
    await a.getByRole('button', {
      name: 'Close market',
      exact: true
    }).click();
    panel = await portfolio(a);
    await panel.getByRole('tab', {
      name: 'Order history'
    }).click();
    const latest = panel.locator('article').first();
    await latest.getByRole('button', {
      name: 'Cancel',
      exact: true
    }).click();
    await expect(latest.getByText('Cancelled', {
      exact: true
    })).toBeVisible({
      timeout: 15000
    });
    await panel.getByRole('button', {
      name: 'Cancel',
      exact: true
    }).click();
    await a.screenshot({
      path: join(tmpdir(), 'khmerfp-original-ui-home.png')
    });
    await a.setViewportSize({
      width: 390,
      height: 844
    });
    assert.equal(await a.locator('body').evaluate(e => e.scrollWidth <= window.innerWidth), true);
    await a.getByRole('link', {
      name: 'Rounds',
      exact: true
    }).click();
    await expect(a.getByRole('heading', {
      name: 'View all rounds'
    })).toBeVisible();
    await a.getByRole('link', {
      name: 'Back to markets',
      exact: true
    }).click();
    await a.getByRole('button', {
      name: 'Switch language'
    }).click();
    await expect(a.locator('html')).toHaveAttribute('lang', 'km');
    await Promise.all(contexts.map(c => c.close()));
    for (const scenario of scenarios) {
      const pages = [await login(scenario.buyer), await login(scenario.seller)];
      for (const page of pages) await open(page, scenario.market, 'Yes');
      await pages[0].getByLabel('Limit price (cents)', {
        exact: true
      }).fill('65');
      await pages[0].getByRole('button', {
        name: 'Submit order',
        exact: true
      }).click();
      await expect(pages[0].getByText('Order accepted. Awaiting execution.')).toBeVisible();
      await pages[1].getByRole('button', {
        name: 'Sell',
        exact: true
      }).click();
      await pages[1].getByRole('button', {
        name: 'Submit order',
        exact: true
      }).click();
      await expect(pages[1].getByText('Order accepted. Awaiting execution.')).toBeVisible();
      await pages[0].getByRole('button', {
        name: 'Close market',
        exact: true
      }).click();
      const p = await portfolio(pages[0]);
      await p.getByRole('tab', {
        name: 'Order history'
      }).click();
      await expect(p.getByText('Filled', {
        exact: true
      }).first()).toBeVisible({
        timeout: 15000
      });
      await Promise.all(pages.map(page => page.context().close()));
    }
    // Close previous users so their polling cannot consume the shared IP rate budget.
    await Promise.all(contexts.map(context=>context.close()));
    // Public previews use real read snapshots; only order execution needs login.
    // Respect the existing shared-IP window rather than weakening its limits.
    await new Promise(resolve => setTimeout(resolve, 61000));
    const guestContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(guestContext);
    await guestContext.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const guest = await guestContext.newPage();
    await guest.goto(url);
    await guest.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'});
    await guest.locator(`.market-card[data-market-id="${market.marketId}"]`).click();
    for (const width of [1440, 390]) {
      await guest.setViewportSize({ width, height: 900 });
      for (const polarity of ['Yes', 'No']) for (const side of ['Buy', 'Sell']) for (const type of ['Limit', 'Market']) {
        await guest.getByRole('button', { name: polarity, exact: true }).click();
        await guest.getByRole('button', { name: side, exact: true }).click();
        await guest.getByRole('button', { name: type, exact: true }).click();
        await expect(guest.getByRole('button', { name: 'Estimate execution', exact: true })).toBeEnabled();
        await expect(guest.getByRole('button', { name: 'Sign in to trade', exact: true })).toBeDisabled();
        const identityViews = guest.locator('[data-price-history],section[data-snapshot-id][aria-label]');
        await expect(identityViews).toHaveCount(3, { timeout: 15000 });
        const identities = await identityViews.evaluateAll(elements => elements.map(e => [e.dataset.marketId, e.dataset.tokenId, e.dataset.snapshotId]));
        assert.equal(identities.length, 3);
        for (const identity of identities) { assert.equal(identity[0], market.marketId); assert.ok(identity[2]); assert.deepEqual(identity, identities[0]); }
      }
    }
    assert.equal((await guest.request.post(origin + '/api/trading/orders', { headers: { Origin: origin }, data: {} })).status(), 401);
    await guestContext.close();
    console.log(JSON.stringify({ browserAcceptance: 'public-estimates-authenticated-execution', cases: 16, canonicalSnapshotsVerified: true }));
    await runMarketOrderUiCases({origin,url,browser,login,open,portfolio,scenarios:[{market,buyer,seller},...scenarios],reconcile,referenceLayouts});
    await runRoundTransitionUi({origin,login,open,portfolio,createRecurring,reconcile});
    await reconcile();
  } finally {
    await Promise.all(contexts.map(c => c.close()));
    await browser.close();
    await vite.close();
  }
}
