import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ContractFactory } from 'ethers'
import { createDemoService, contractsRoot, orderTypes } from '../src/demo/orderService.js'
import { createDemoApp } from '../src/demo/app.js'

test('local demo API and durable settlement lifecycle', { skip: process.env.LOCAL_DEMO_INTEGRATION !== 'true', timeout: 120000 }, async t => {
  process.env.NODE_ENV = 'development'
  process.env.LOCAL_DEMO_ENABLED = 'true'
  execFileSync(process.execPath, ['node_modules/hardhat/internal/cli/cli.js', 'run', '--no-compile', 'scripts/setup-bitcoin-demo.js', '--network', 'localhost'], { cwd: contractsRoot, stdio: 'pipe' })
  const directory = await mkdtemp(path.join(tmpdir(), 'khmerfp-demo-api-'))
  let service = await createDemoService({ directory })
  const config = service.config
  const buyer = await service.provider.getSigner(config.accounts.buyer)
  const seller = await service.provider.getSigner(config.accounts.seller)
  const admin = await service.provider.getSigner(config.accounts.admin)
  const operator = { demoWallet: config.accounts.operator }
  const user = { demoWallet: config.accounts.buyer }
  const sellUser = { demoWallet: config.accounts.seller }
  let nonce = 100
  async function signed(signer, side, changes = {}) {
    const order = { maker: await signer.getAddress(), tokenId: config.tokens[0].tokenId, side,
      makerAmount: side === 0 ? '650000' : '1000000', takerAmount: side === 0 ? '1000000' : '600000',
      nonce: String(nonce++), expiration: String(config.round.tradingCutoff), ...changes }
    const currentSigner = await service.provider.getSigner(await signer.getAddress())
    return { marketId: config.round.roundId, domain: service.domain, order, signature: await currentSigner.signTypedData(service.domain, orderTypes, order) }
  }
  try {
    await t.test('refuses a second process using the same journal', async () => {
      await assert.rejects(createDemoService({ directory }), /locked/)
    })
    await t.test('rejects signatures, ownership, domains, tokens, expiry, cancellations and allowances', async () => {
      const good = await signed(buyer, 0)
      await assert.rejects(service.submit(sellUser, good), /not authenticated/)
      await assert.rejects(service.submit(user, { ...good, signature: '0x1234' }), /signature/)
      await assert.rejects(service.submit(user, { ...good, domain: { ...good.domain, chainId: 84532 } }), /domain/)
      await assert.rejects(service.submit(user, { ...good, domain: { ...good.domain, verifyingContract: config.addresses.ctf } }), /domain/)
      await assert.rejects(service.submit(user, await signed(buyer, 0, { tokenId: '123' })), /Unknown/)
      await assert.rejects(service.submit(user, await signed(buyer, 0, { expiration: '1' })), /expired/)
      const cancelled = await signed(buyer, 0)
      await (await service.exchange.connect(buyer).cancelOrder(cancelled.order)).wait()
      await assert.rejects(service.submit(user, cancelled), /cancelled/)
      await (await service.collateral.connect(buyer).approve(config.addresses.exchange, 0)).wait()
      await assert.rejects(service.submit(user, good), /allowance/)
      await (await service.collateral.connect(buyer).approve(config.addresses.exchange, 10000000)).wait()
    })
    await t.test('requires wallet proof through existing auth middleware and operator authorization', async () => {
      const server = createDemoApp(service).listen(0, '127.0.0.1')
      await new Promise(resolve => server.once('listening', resolve))
      const base = `http://127.0.0.1:${server.address().port}`
      try {
        assert.equal((await fetch(`${base}/api/demo/orders`)).status, 401)
        assert.equal((await fetch(`${base}/api/demo/orders`, { headers: { Origin: 'https://evil.example' } })).status, 403)
        const post = (endpoint, body, cookie) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
        const proof = await (await post('/api/demo/auth/challenge', { wallet: config.accounts.buyer })).json()
        const login = await post('/api/demo/auth/verify', { nonce: proof.nonce, signature: await buyer.signMessage(proof.message) })
        assert.equal(login.status, 200)
        const cookie = login.headers.get('set-cookie').split(';')[0]
        assert.equal((await fetch(`${base}/api/demo/config`)).status, 200)
        assert.equal((await fetch(`${base}/api/demo/operator/orders`, { headers: { cookie } })).status, 403)
        await assert.rejects(service.operatorOrders(user), /operator required/)
        assert.ok(Array.isArray(await service.operatorOrders(operator)))
        assert.ok(cookie.startsWith('khmerfp_demo_session='))
        assert.equal((await fetch(`${base}/api/demo/orders`, { headers: { cookie } })).status, 200)
        const posted = await post('/api/demo/orders', await signed(buyer, 0), cookie)
        assert.equal(posted.status, 201)
        assert.equal((await posted.json()).signature, undefined)
        assert.equal((await post('/api/demo/matches', {}, cookie)).status, 403)
        assert.equal((await post('/api/demo/auth/verify', { nonce: proof.nonce, signature: await buyer.signMessage(proof.message) })).status, 401)
        assert.equal((await post('/api/demo/auth/logout', {}, cookie)).status, 200)
        assert.equal((await fetch(`${base}/api/demo/orders`, { headers: { cookie } })).status, 401)
      } finally { await new Promise(resolve => server.close(resolve)) }
    })
    await t.test('validates EIP-1271 signed orders for a proved smart wallet', async () => {
      const artifact = JSON.parse(await readFile(path.join(contractsRoot, 'artifacts/src/mocks/Mock1271Wallet.sol/Mock1271Wallet.json'), 'utf8'))
      const wallet = await new ContractFactory(artifact.abi, artifact.bytecode, admin).deploy(config.accounts.admin)
      await wallet.waitForDeployment()
      const address = await wallet.getAddress()
      await (await service.collateral.connect(admin).mint(address, 1000000)).wait()
      await (await wallet.execute(config.addresses.collateral, service.collateral.interface.encodeFunctionData('approve', [config.addresses.exchange, 650000]))).wait()
      const record = await service.submit({ demoWallet: address }, await signed(admin, 0, { maker: address }))
      assert.equal(record.remainingQuantity, '1000000')
    })
    let buyRecord, sellRecord
    await t.test('stores signed orders and revalidates pause/operator revocation', async () => {
      buyRecord = await service.submit(user, await signed(buyer, 0))
      sellRecord = await service.submit(sellUser, await signed(seller, 1))
      assert.equal(buyRecord.remainingQuantity, '1000000')
      const request = { buyId: buyRecord.id, sellId: sellRecord.id, quantity: '1000000', payment: '620000' }
      await assert.rejects(service.match(user, request), /operator required/)
      const guardian = await service.provider.getSigner(config.accounts.guardian)
      await (await service.exchange.connect(guardian).pause()).wait()
      await assert.rejects(service.match(operator, request), /unavailable/)
      await (await service.exchange.connect(admin).unpause()).wait()
      await (await service.exchange.connect(admin).revokeRole(await service.exchange.OPERATOR_ROLE(), config.accounts.operator)).wait()
      await assert.rejects(service.match(operator, request), /revoked/)
      await (await service.exchange.connect(admin).grantRole(await service.exchange.OPERATOR_ROLE(), config.accounts.operator)).wait()
    })
    await t.test('serializes duplicate settlement, confirms events, and survives restart', async () => {
      const request = { buyId: buyRecord.id, sellId: sellRecord.id, quantity: '1000000', payment: '620000' }
      const results = await Promise.allSettled([service.match(operator, request), service.match(operator, request)])
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
      assert.equal(results.find(r => r.status === 'fulfilled').value.status, 'CONFIRMED')
      assert.equal((await service.list(user)).find(r => r.id === buyRecord.id).remainingQuantity, '0')
      await service.close()
      // reproduce the crash window after broadcast but before saving the transaction hash.
      const file = path.join(directory, 'orders.json')
      const journal = JSON.parse(await readFile(file, 'utf8'))
      const pending = Object.values(journal.settlements)[0]
      delete pending.hash
      pending.status = 'PENDING'
      await writeFile(file, JSON.stringify(journal))
      service = await createDemoService({ directory })
      await service.reconcile()
      assert.equal((await service.settlements(operator))[0].status, 'CONFIRMED')
      await assert.rejects(service.match(operator, request), /fully filled/)
    })
    await t.test('tracks reverted transactions and retries only after confirmed failure', async () => {
      const b = await service.submit(user, await signed(buyer, 0))
      const s = await service.submit(sellUser, await signed(seller, 1))
      const request = { buyId: b.id, sellId: s.id, quantity: '1000000', payment: '620000' }
      const original = service.provider.getSigner.bind(service.provider)
      // reproduce a guardian pause after simulation but before operator broadcast.
      service.provider.getSigner = async address => {
        const signer = await original(address)
        const send = signer.sendTransaction.bind(signer)
        signer.sendTransaction = async tx => {
          const guardian = await original(config.accounts.guardian)
          await (await service.exchange.connect(guardian).pause()).wait()
          return send(tx)
        }
        return signer
      }
      const failed = await service.match(operator, request)
      service.provider.getSigner = original
      assert.equal(failed.status, 'FAILED')
      assert.equal((await service.list(user)).find(r => r.id === b.id).remainingQuantity, '1000000')
      const currentAdmin = await original(config.accounts.admin)
      await (await service.exchange.connect(currentAdmin).unpause()).wait()
      assert.equal((await service.match(operator, request)).status, 'CONFIRMED')
    })
    await t.test('detects a reverted local block and blocks blind resubmission', async () => {
      const b = await service.submit(user, await signed(buyer, 0))
      const s = await service.submit(sellUser, await signed(seller, 1))
      const request = { buyId: b.id, sellId: s.id, quantity: '1000000', payment: '620000' }
      const snapshot = await service.provider.send('evm_snapshot', [])
      assert.equal((await service.match(operator, request)).status, 'CONFIRMED')
      await service.provider.send('evm_revert', [snapshot])
      const records = await service.settlements(operator)
      assert.equal(records.at(-1).status, 'REORGED')
      await assert.rejects(service.match(operator, request), /requires reconciliation/)
    })
    await t.test('rejects on-chain closed market and chain reset', async () => {
      await service.provider.send('evm_setNextBlockTimestamp', [config.round.tradingCutoff])
      await service.provider.send('evm_mine', [])
      await assert.rejects(service.submit(user, await signed(buyer, 0)), /closed/)
      await service.provider.send('hardhat_reset', [])
      await assert.rejects(service.verifyEnvironment(), /chain changed/)
    })
  } finally {
    await service.close()
    await rm(directory, { recursive: true, force: true })
  }
})
