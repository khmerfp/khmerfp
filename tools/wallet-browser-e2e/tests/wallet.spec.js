// exercise login, linking and recovery through the browser with test-only wallets.
import { test, expect } from '@playwright/test'
import { T } from '../../../client/src/lib/i18n.js'
const token = process.env.WALLET_BROWSER_TOKEN
const headers = { Origin: 'http://127.0.0.1:5187', 'X-Wallet-Test-Token': token }
const password = 'DisposableBrowserOnly!37'
let index = 0
async function login(page, context, scenario = 'success') {
  const number = ++index
  const address = '0x' + number.toString(16).padStart(40, '0')
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.addInitScript(({ token, scenario, address }) => {
    window.__WALLET_E2E_TOKEN = token
    window.__WALLET_E2E_SCENARIO = scenario
    window.__WALLET_E2E_ADDRESS = address
  }, { token, scenario, address })
  expect((await context.request.post('/__test/reset-clock', { headers })).ok()).toBeTruthy()
  const email = `browser-${number}-${Date.now()}@example.test`
  const registration = await context.request.post('/api/auth/register', { headers, data: { email, password, displayName: 'Browser tester', language: 'en' } })
  expect(registration.status()).toBe(201)
  await context.request.post('/api/auth/logout', { headers })
  await page.goto('/account/wallets')
  await page.getByRole('button', { name: 'Sign in to KhmerFP first' }).click()
  // Use the rendered locale rather than assuming a new session starts in Khmer.
  const language = await page.locator('html').getAttribute('lang')
  await page.getByRole('button', { name: T[language]?.email || T.en.email, exact: true }).click()
  await page.locator('input[name=email]').fill(email)
  await page.locator('input[name=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await expect(page.getByText(/KhmerFP account: Browser tester/)).toBeVisible()
  return address
}
async function connect(page) {
  await page.getByRole('button', { name: 'Connect Coinbase wallet on Base Sepolia' }).click()
  await expect(page.getByText('Wallet connected', { exact: true })).toBeVisible()
}

test('login, challenge, signature, persistence, refresh, unlink and relink', async ({ page, context }) => {
  const address = await login(page, context)
  await connect(page)
  await page.getByRole('button', { name: 'Sign ownership link' }).click()
  await expect(page.getByText('Waiting for signature', { exact: true })).toBeVisible()
  await expect(page.getByText('Verifying ownership', { exact: true })).toBeVisible()
  await expect(page.getByText(/Wallet ownership linked/)).toBeVisible()
  await expect(page.getByText('Verified link', { exact: true })).toBeVisible()
  await expect(page.getByText('Currently connected wallet', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText(address, { exact: true })).toBeVisible()
  await expect(page.getByText(/Chain 84532.*ACTIVE/)).toBeVisible()
  await connect(page)
  expect((await context.request.post('/__test/step-up', { headers })).status()).toBe(204)
  await page.getByRole('button', { name: 'Sign unlink proof' }).click()
  await expect(page.getByText(/Wallet link revoked/)).toBeVisible()
  await page.getByRole('button', { name: 'Sign relink proof' }).click()
  await expect(page.getByText(/Wallet ownership linked/)).toBeVisible()
})
for (const [scenario, error] of [
  ['reject-connection', /Wallet request cancelled/], ['wrong-network', /Base Sepolia is required/],
]) test(scenario, async ({ page, context }) => {
  await login(page, context, scenario)
  await page.getByRole('button', { name: 'Connect Coinbase wallet on Base Sepolia' }).click()
  await expect(page.getByText(error)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign ownership link' })).toHaveCount(0)
})
test('undeployed wallet blocks ownership verification', async ({ page, context }) => {
  await login(page, context, 'undeployed')
  await connect(page)
  await expect(page.getByRole('button', { name: 'Sign ownership link' })).toBeDisabled()
  await expect(page.getByText(/Wallet is undeployed/)).toBeVisible()
  await expect(page.getByText('Setup unavailable', { exact: true }).first()).toBeVisible()
})
for (const [scenario, error] of [
  ['reject-signature', /Wallet request cancelled/], ['invalid-signature', /Wallet ownership signature was rejected/],
  ['rpc-failure', /Wallet verification unavailable/],
  ['expired-challenge', /Challenge expired/], ['expired-session', /Your KhmerFP session expired/],
]) test(scenario, async ({ page, context }) => {
  await login(page, context, scenario)
  await connect(page)
  await page.getByRole('button', { name: 'Sign ownership link' }).click()
  await expect(page.getByText(error)).toBeVisible()
  await expect(page.getByText('Successfully linked', { exact: true })).toHaveCount(0)
})
test('concurrent verification and replay have exactly one winner', async ({ page, context }) => {
  const address = await login(page, context)
  const issued = await context.request.post('/api/wallet-links/challenges', { headers, data: { walletAddress: address, chainId: 84532, action: 'LINK' } })
  expect(issued.status()).toBe(201)
  const challenge = await issued.json()
  const signed = await context.request.post('/__test/sign', { headers, data: { challengeId: challenge.challengeId } })
  const { signature } = await signed.json()
  const data = { challengeId: challenge.challengeId, signature }
  const results = await Promise.all([context.request.post('/api/wallet-links/verify', { headers, data }), context.request.post('/api/wallet-links/verify', { headers, data })])
  expect(results.map(r => r.status()).sort()).toEqual([200, 409])
  expect((await context.request.post('/api/wallet-links/verify', { headers, data })).status()).toBe(409)
  await page.reload()
  await expect(page.getByText(address, { exact: true })).toBeVisible()
})
test('mobile layout has no horizontal overflow and supports keyboard connection', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, context)
  const connectButton = page.getByRole('button', { name: 'Connect Coinbase wallet on Base Sepolia' })
  await connectButton.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Wallet connected', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/wallet-mobile.png' })
})

test('cancel connection locally without requesting an ownership signature', async ({ page, context }) => {
  await login(page, context)
  let signatures = 0
  page.on('request', request => { if (request.url().endsWith('/__test/sign')) signatures++ })
  await page.getByRole('button', { name: 'Connect Coinbase wallet on Base Sepolia' }).click()
  await page.getByRole('button', { name: 'Cancel request' }).click()
  await expect(page.getByRole('button', { name: 'Connect Coinbase wallet on Base Sepolia' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Sign ownership link' })).toHaveCount(0)
  expect(signatures).toBe(0)
})

test('new-account entry uses hosted-flow adapter without signing automatically', async ({ page, context }) => {
  await login(page, context)
  let signatures = 0
  page.on('request', request => { if (request.url().endsWith('/__test/sign')) signatures++ })
  await page.getByRole('button', { name: 'New to Coinbase? Continue with Coinbase' }).click()
  await expect(page.getByText('Wallet connected', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign ownership link' })).toBeEnabled()
  expect(signatures).toBe(0)
})
