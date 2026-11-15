import { readFile, open, rename, mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Contract, JsonRpcProvider, TypedDataEncoder, verifyTypedData, keccak256, getAddress, id } from 'ethers'

const root = fileURLToPath(new URL('../../', import.meta.url))
export const contractsRoot = path.resolve(root, '../contracts')
export const orderTypes = { Order: [
  ['maker', 'address'], ['tokenId', 'uint256'], ['side', 'uint8'], ['makerAmount', 'uint256'],
  ['takerAmount', 'uint256'], ['nonce', 'uint256'], ['expiration', 'uint256'],
].map(([name, type]) => ({ name, type })) }
export function reject(message, status = 400) { const error = new Error(message); error.status = status; throw error }
export function unsigned(value, max = (1n << 256n) - 1n) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > max) reject('Invalid integer amount.')
  return BigInt(value)
}
export async function validSignature(provider, maker, digest, signature, recover) {
  if (typeof signature !== 'string' || !/^0x([a-fA-F0-9]{2}){1,4096}$/.test(signature)) return false
  try {
    if (await provider.getCode(maker) === '0x') return getAddress(recover()) === getAddress(maker)
    const wallet = new Contract(maker, ['function isValidSignature(bytes32,bytes) view returns (bytes4)'], provider)
    return await wallet.isValidSignature(digest, signature) === '0x1626ba7e'
  } catch { return false }
}

export async function createDemoService({ directory = path.resolve(root, '.local-demo') } = {}) {
  if (process.env.NODE_ENV !== 'development' || process.env.LOCAL_DEMO_ENABLED !== 'true') reject('Local demo is disabled.', 503)
  const config = JSON.parse(await readFile(path.join(contractsRoot, 'deployments/local-bitcoin-demo.json'), 'utf8'))
  if (!config.demoOnly || config.chainId !== 31337 || config.rpcUrl !== 'http://127.0.0.1:8545' || !config.instanceId || !config.codeHashes) reject('Run the latest local demo setup.', 503)
  const provider = new JsonRpcProvider(config.rpcUrl, undefined, { cacheTimeout: -1 })
  const abi = async name => {
    const location = path.resolve(contractsRoot, config.abiLocations[name])
    if (!location.startsWith(path.join(contractsRoot, 'artifacts') + path.sep)) reject('Invalid ABI path.', 503)
    const artifact = JSON.parse(await readFile(location, 'utf8'))
    if (artifact.contractName !== name) reject('Invalid ABI artifact.', 503)
    return artifact
  }
  const exchange = new Contract(config.addresses.exchange, (await abi('KhmerFPExchange')).abi, provider)
  const collateralArtifact = await abi('MockCollateral')
  const collateral = new Contract(config.addresses.collateral, collateralArtifact.abi, provider)
  const ctf = new Contract(config.addresses.ctf, (await abi('ConditionalTokens')).abi, provider)
  const domain = { name: 'KhmerFP Exchange', version: '1', chainId: 31337, verifyingContract: config.addresses.exchange }

  async function verifyEnvironment() {
    if (process.env.NODE_ENV !== 'development' || process.env.LOCAL_DEMO_ENABLED !== 'true') reject('Local demo disabled.', 503)
    const metadata = await provider.send('hardhat_metadata', [])
    if (Number(await provider.send('eth_chainId', [])) !== 31337 || metadata.instanceId !== config.instanceId || metadata.forkedNetwork
      || !/^HardhatNetwork\//.test(await provider.send('web3_clientVersion', []))) reject('Local chain changed; restart with a fresh journal.', 503)
    for (const name of ['collateral', 'ctf', 'exchange']) {
      const code = await provider.getCode(config.addresses[name])
      if (code === '0x' || keccak256(code) !== config.codeHashes[name]) reject('Deployment code mismatch.', 503)
    }
    if ((await provider.getCode(config.addresses.collateral)).toLowerCase() !== collateralArtifact.deployedBytecode.toLowerCase()
      || await collateral.decimals() !== 6n
      || getAddress(await exchange.collateral()) !== getAddress(config.addresses.collateral)
      || getAddress(await exchange.conditionalTokens()) !== getAddress(config.addresses.ctf)) reject('Contract configuration mismatch.', 503)
    const market = await exchange.markets(config.round.conditionId)
    if (market.yesTokenId.toString() !== config.tokens[0].tokenId || market.noTokenId.toString() !== config.tokens[1].tokenId
      || market.tradingCutoff.toString() !== String(config.round.tradingCutoff)) reject('Market configuration mismatch.', 503)
  }

  try {
    await verifyEnvironment()
    if (getAddress(await exchange.defaultAdmin()) !== getAddress(config.accounts.admin)
      || !await exchange.hasRole(id('OPERATOR_ROLE'), config.accounts.operator)
      || !await exchange.hasRole(id('EMERGENCY_ROLE'), config.accounts.guardian)) reject('Configured demo roles do not match the chain.', 503)
  } catch (error) { provider.destroy(); throw error }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const lockPath = path.join(directory, 'process.lock')
  // a single local process owns the journal; stale crash locks require explicit recovery.
  let lock
  try { lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid)) }
  catch { provider.destroy(); reject('Demo journal is locked. Confirm its process stopped before removing process.lock.', 503) }
  const journal = path.join(directory, 'orders.json')
  let state = { version: 1, instanceId: config.instanceId, orders: {}, settlements: {} }
  try {
    try { state = JSON.parse(await readFile(journal, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (state.version !== 1 || state.instanceId !== config.instanceId) reject('Journal belongs to another local chain; archive it before restart.', 503)
  } catch (error) { await lock.close(); await unlink(lockPath); provider.destroy(); throw error }
  async function save() {
    const file = await open(`${journal}.tmp`, 'w', 0o600)
    try { await file.writeFile(JSON.stringify(state, null, 2)); await file.sync() } finally { await file.close() }
    await rename(`${journal}.tmp`, journal)
  }
  let queue = Promise.resolve()
  const serial = operation => {
    const next = queue.then(operation)
    queue = next.catch(() => {})
    return next
  }
  const owned = (user, maker) => user?.demoWallet && getAddress(user.demoWallet) === getAddress(maker)
  const publicOrder = record => { const copy = { ...record }; delete copy.signature; return copy }

  async function validate(record) {
    await verifyEnvironment()
    const order = record.order
    if (record.marketId !== config.round.roundId || !config.tokens.some(t => t.tokenId === order.tokenId)) reject('Unknown market or token.')
    const block = await provider.getBlock('latest')
    const now = Math.max(block.timestamp, Math.floor(Date.now() / 1000))
    if (now >= config.round.tradingCutoff || BigInt(order.expiration) <= BigInt(now)
      || BigInt(order.expiration) > BigInt(config.round.tradingCutoff)) reject('Order expired or market closed.')
    if (await exchange.paused() || !(await exchange.markets(config.round.conditionId)).enabled) reject('Trading unavailable.', 409)
    if (await exchange.cancelled(record.id)) reject('Order cancelled.', 409)
    if (!await validSignature(provider, order.maker, record.id, record.signature, () => verifyTypedData(domain, orderTypes, order, record.signature))) reject('Invalid order signature.')
    const filled = await exchange.filledOutcomeAmount(record.id)
    const payment = await exchange.filledCollateralAmount(record.id)
    const total = BigInt(order.side === 0 ? order.takerAmount : order.makerAmount)
    if (filled >= total) reject('Order fully filled.', 409)
    const remaining = total - filled
    if (order.side === 0) {
      const budget = BigInt(order.makerAmount) - payment
      if (await collateral.balanceOf(order.maker) < budget || await collateral.allowance(order.maker, config.addresses.exchange) < budget) reject('Insufficient collateral or allowance.')
    } else if (await ctf.balanceOf(order.maker, order.tokenId) < remaining || !await ctf.isApprovedForAll(order.maker, config.addresses.exchange)) reject('Insufficient outcome tokens or approval.')
    return { remaining, payment, filled }
  }

  async function reconcile() {
    await verifyEnvironment()
    for (const settlement of Object.values(state.settlements)) {
      if (!settlement.hash && settlement.status === 'PENDING') {
        // recover a crash after broadcast but before persisting its hash, using reserved nonce.
        const latest = await provider.getBlockNumber()
        if (latest - settlement.startBlock > 1000) reject('Manual recovery required for old uncertain transaction.', 503)
        for (let n = settlement.startBlock; n <= latest; n++) {
          const block = await provider.send('eth_getBlockByNumber', [`0x${n.toString(16)}`, true])
          const tx = block.transactions.find(t => getAddress(t.from) === getAddress(config.accounts.operator)
            && Number(t.nonce) === settlement.nonce && t.to?.toLowerCase() === config.addresses.exchange.toLowerCase()
            && t.input === settlement.data)
          if (tx) { settlement.hash = tx.hash; settlement.status = 'SUBMITTED'; break }
        }
      }
      if (!settlement.hash) continue
      const receipt = await provider.getTransactionReceipt(settlement.hash)
      if (!receipt) {
        if (['CONFIRMED', 'FAILED'].includes(settlement.status)) settlement.status = 'REORGED'
        continue
      }
      const canonical = await provider.getBlock(receipt.blockNumber)
      if (canonical?.hash !== receipt.blockHash) { settlement.status = 'REORGED'; continue }
      if (receipt.status !== 1) { settlement.status = 'FAILED'; settlement.blockHash = receipt.blockHash; continue }
      const event = receipt.logs.filter(log => log.address.toLowerCase() === config.addresses.exchange.toLowerCase())
        .map(log => { try { return exchange.interface.parseLog(log) } catch { return null } })
        .find(log => log?.name === 'TradeExecuted' && log.args.buyOrderHash === settlement.buyId && log.args.sellOrderHash === settlement.sellId)
      if (!event || event.args.outcomeAmount.toString() !== settlement.quantity || event.args.collateralAmount.toString() !== settlement.payment) reject('Settlement event mismatch; manual recovery required.', 503)
      settlement.status = 'CONFIRMED'; settlement.blockHash = receipt.blockHash; settlement.blockNumber = receipt.blockNumber
    }
    for (const record of Object.values(state.orders)) {
      const filled = await exchange.filledOutcomeAmount(record.id)
      record.remainingQuantity = (BigInt(record.order.side === 0 ? record.order.takerAmount : record.order.makerAmount) - filled).toString()
      record.filledCollateral = (await exchange.filledCollateralAmount(record.id)).toString()
      record.status = await exchange.cancelled(record.id) ? 'CANCELLED' : record.remainingQuantity === '0' ? 'FILLED' : filled > 0n ? 'PARTIALLY_FILLED' : 'OPEN'
      const settlement = Object.values(state.settlements).filter(s => s.buyId === record.id || s.sellId === record.id).at(-1)
      record.settlementStatus = settlement?.status ?? null
      record.transactionHash = settlement?.hash ?? null
    }
    await save()
  }

  return {
    config, provider, exchange, collateral, ctf, domain,
    verifyEnvironment,
    async close() { await queue; await lock.close(); await unlink(lockPath); provider.destroy() },
    async reconcile() { return serial(reconcile) },
    async submit(user, body) { return serial(async () => {
      if (!body || Object.keys(body).sort().join() !== ['domain', 'marketId', 'order', 'signature'].sort().join()) reject('Invalid submission fields.')
      const order = body?.order
      if (!order || Object.keys(order).sort().join() !== Object.keys(Object.fromEntries(orderTypes.Order.map(f => [f.name, true]))).sort().join()) reject('Invalid order fields.')
      if (!owned(user, order.maker)) reject('Maker wallet is not authenticated.', 403)
      if (!body.domain || Object.keys(body.domain).length !== 4 || Object.entries(domain).some(([key, value]) => body.domain[key] !== value)) reject('Wrong signing domain.')
      if (order.side !== 0 && order.side !== 1) reject('Invalid side.')
      for (const field of ['makerAmount', 'takerAmount']) if (unsigned(order[field], (1n << 128n) - 1n) === 0n) reject('Zero amount.')
      for (const field of ['tokenId', 'nonce', 'expiration']) unsigned(order[field])
      // binary limit price must lie strictly between zero and one collateral unit per share.
      if (order.side === 0 ? BigInt(order.makerAmount) >= BigInt(order.takerAmount) : BigInt(order.takerAmount) >= BigInt(order.makerAmount)) reject('Binary price must be between zero and one.')
      const hash = TypedDataEncoder.hash(domain, orderTypes, order)
      if (await exchange.hashOrder(order) !== hash) reject('Order hash mismatch.', 503)
      const record = { id: hash, maker: getAddress(order.maker), marketId: body.marketId, order: structuredClone(order), signature: body.signature, submittedAt: new Date().toISOString(), status: 'OPEN' }
      await validate(record)
      if (state.orders[hash]) return publicOrder(state.orders[hash])
      if (Object.keys(state.orders).length >= 1000) reject('Demo order capacity reached.', 429)
      state.orders[hash] = record
      await reconcile()
      return publicOrder(record)
    }) },
    async list(user) { return serial(async () => { await reconcile(); return Object.values(state.orders).filter(r => owned(user, r.maker)).map(publicOrder) }) },
    async operatorOrders(user) { return serial(async () => {
      if (!owned(user, config.accounts.operator) || !await exchange.hasRole(id('OPERATOR_ROLE'), config.accounts.operator)) reject('Demo operator required.', 403)
      await reconcile(); return Object.values(state.orders).map(publicOrder)
    }) },
    async settlements(user) { return serial(async () => {
      if (!owned(user, config.accounts.operator)) reject('Demo operator required.', 403)
      await reconcile(); return Object.values(state.settlements).map(({ data: _data, ...record }) => record)
    }) },
    async match(user, body) { return serial(async () => {
      if (!owned(user, config.accounts.operator)) reject('Demo operator required.', 403)
      if (!body || Object.keys(body).sort().join() !== ['buyId', 'sellId', 'quantity', 'payment'].sort().join()) reject('Stored IDs and fill amounts are required.')
      await reconcile()
      if (Object.values(state.settlements).some(s => ['PENDING', 'SUBMITTED', 'REORGED'].includes(s.status))) reject('A settlement requires reconciliation before another submission.', 409)
      const buy = state.orders[body?.buyId], sell = state.orders[body?.sellId]
      if (!buy || !sell || buy.order.side !== 0 || sell.order.side !== 1 || buy.order.tokenId !== sell.order.tokenId || buy.maker === sell.maker) reject('Incompatible stored orders.')
      const b = await validate(buy), s = await validate(sell)
      const quantity = unsigned(body.quantity, (1n << 128n) - 1n), payment = unsigned(body.payment, (1n << 128n) - 1n)
      if (!quantity || !payment || quantity > b.remaining || quantity > s.remaining
        || payment + b.payment > BigInt(buy.order.makerAmount)
        || payment * BigInt(buy.order.takerAmount) > quantity * BigInt(buy.order.makerAmount)
        || payment * BigInt(sell.order.makerAmount) < quantity * BigInt(sell.order.takerAmount)) reject('Invalid fill or execution price.')
      if (!await exchange.hasRole(id('OPERATOR_ROLE'), config.accounts.operator)) reject('Operator role revoked.', 403)
      const signer = await provider.getSigner(config.accounts.operator)
      const call = exchange.connect(signer).matchOrders
      const args = [buy.order, buy.signature, sell.order, sell.signature, quantity, payment]
      await call.staticCall(...args)
      const gasLimit = (await call.estimateGas(...args)) * 12n / 10n
      const data = exchange.interface.encodeFunctionData('matchOrders', args)
      const nonce = await provider.getTransactionCount(config.accounts.operator, 'pending')
      const record = { id: randomUUID(), buyId: buy.id, sellId: sell.id, quantity: quantity.toString(), payment: payment.toString(), status: 'PENDING', nonce, data, startBlock: await provider.getBlockNumber(), submittedAt: new Date().toISOString() }
      state.settlements[record.id] = record
      await save()
      try {
        const tx = await signer.sendTransaction({ to: config.addresses.exchange, data, nonce, gasLimit })
        record.hash = tx.hash; record.status = 'SUBMITTED'; await save()
        await provider.waitForTransaction(tx.hash, 1, 15000)
      } catch {
        // leave ambiguous submissions pending; never auto-resend after a timeout.
      }
      await reconcile()
      const result = { ...record }; delete result.data
      return result
    }) },
  }
}
