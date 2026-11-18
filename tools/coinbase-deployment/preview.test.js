// test factory identity and deployment checks with controlled rpc data.
﻿import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Interface, zeroPadValue } from 'ethers'
import { inspectDeployment, compareSdkFactoryData, readOnlyFactory, FACTORY, IMPLEMENTATION, FACTORY_ABI } from './preview.js'
import { connectPreparation, guardPreparationProvider } from './connection.js'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/public-contracts.json', import.meta.url)))
const wallet = '0x1111111111111111111111111111111111111111'
const other = '0x2222222222222222222222222222222222222222'
const abi = new Interface(FACTORY_ABI)
function mock() {
  const state = { chain: 84532n, walletCode: '0x', factoryCode: fixture.factoryCode,
    implementation: IMPLEMENTATION, implementationCode: fixture.implementationCode, destroyed: 0, blockChanged: false }
  state.factory = () => ({
    getNetwork: async () => ({ chainId: state.chain }),
    getBlock: async tag => ({ number: fixture.blockNumber, hash: tag === 'latest' || !state.blockChanged ? fixture.blockHash : `0x${'ff'.repeat(32)}` }),
    getCode: async address => address === FACTORY ? state.factoryCode : address === IMPLEMENTATION ? state.implementationCode : state.walletCode,
    getBalance: async () => 0n,
    call: async tx => { assert.equal(tx.to, FACTORY); return abi.encodeFunctionResult('implementation', [state.implementation]) },
    destroy: () => { state.destroyed++ },
  })
  return state
}
test('verified factory reads preserve missing account metadata and unknown gas as blockers', async () => {
  const m = mock(), result = await inspectDeployment(wallet, { rpcFactory: m.factory })
  assert.equal(result.factory, FACTORY); assert.equal(result.implementation, IMPLEMENTATION)
  assert.equal(result.deploymentStatus, 'NO_CODE'); assert.equal(result.submissionEnabled, false)
  for (const key of ['owners', 'deploymentNonce', 'predictedAddress', 'gasEstimate', 'maximumFeeWei', 'sponsored']) assert.equal(result[key], null)
  assert.equal(m.destroyed, 1)
})
test('code existence does not prove Coinbase ownership or approve delegation', async () => {
  const m = mock(); m.walletCode = '0x6000'
  assert.equal((await inspectDeployment(wallet, { rpcFactory: m.factory })).deploymentStatus, 'CODE_PRESENT_ACCOUNT_IDENTITY_PENDING')
  m.walletCode = '0xef01001122'
  assert.equal((await inspectDeployment(wallet, { rpcFactory: m.factory })).deploymentStatus, 'DELEGATED_ACCOUNT_REQUIRES_REVIEW')
})
test('wrong chain, changed factory or implementation, changed block all reject', async () => {
  for (const change of [{ chain: 8453n }, { factoryCode: '0x' }, { factoryCode: '0x6000' },
    { implementation: other }, { implementationCode: '0x6000' }, { blockChanged: true }]) {
    const m = Object.assign(mock(), change)
    await assert.rejects(inspectDeployment(wallet, { rpcFactory: m.factory })); assert.equal(m.destroyed, 1)
  }
})
test('invalid and zero addresses reject before any RPC', async () => {
  for (const address of ['<TESTER_WALLET>', `0x${'0'.repeat(40)}`, 'not-an-address']) {
    await assert.rejects(inspectDeployment(address, { rpcFactory: () => { throw Error('must not connect') } }))
  }
})
test('read timeout cleans the provider', async () => {
  let destroyed = 0
  await assert.rejects(inspectDeployment(wallet, { timeoutMs: 5,
    rpcFactory: () => ({ getNetwork: () => new Promise(() => {}), destroy: () => destroyed++ }) }), /timed out/)
  assert.equal(destroyed, 1)
})
test('SDK factory metadata comparison uses actual encoded nonce and rejects a wrong prediction', async () => {
  const owners = [zeroPadValue(wallet, 32)], nonce = 13n
  const data = { wallet, factory: FACTORY, factoryData: abi.encodeFunctionData('createAccount', [owners, nonce]) }
  const result = await compareSdkFactoryData(data, async (actualOwners, actualNonce) => {
    assert.deepEqual(actualOwners, owners); assert.equal(actualNonce, nonce); return wallet
  })
  assert.equal(result.deploymentNonce, '13')
  await assert.rejects(compareSdkFactoryData(data, async () => other), /differs/)
  await assert.rejects(compareSdkFactoryData({ ...data, factory: other }, async () => wallet))
  await assert.rejects(compareSdkFactoryData({ ...data, factoryData: `${data.factoryData}00` }, async () => wallet))
  await assert.rejects(compareSdkFactoryData({ ...data, factoryData: abi.encodeFunctionData('createAccount', [[], 0n]) }, async () => wallet))
})
test('preparation provider cannot send, sign, deploy, switch networks or add subaccounts', async () => {
  let calls = 0
  const provider = guardPreparationProvider({ request: async () => { calls++; return null } })
  for (const method of ['wallet_sendCalls', 'wallet_sendPreparedCalls', 'eth_sendTransaction', 'eth_sendRawTransaction',
    'eth_sendUserOperation', 'eth_signTypedData_v4', 'wallet_grantPermissions', 'wallet_addSubAccount', 'wallet_switchEthereumChain']) {
    assert.throws(() => provider.request({ method }), /disabled/)
  }
  assert.equal(calls, 0)
})
test('connection capabilities never become a sponsorship promise or owner metadata', async () => {
  const methods = []
  const provider = { request: async ({ method }) => {
    methods.push(method)
    if (method === 'eth_chainId') return '0x14a34'
    if (method === 'wallet_getCapabilities') return { '0x14a34': { paymasterService: { supported: true } } }
    return [wallet]
  } }
  const result = await connectPreparation(provider)
  assert.equal(result.wallet, wallet); assert.equal(result.sponsorshipCapability, 'SUPPORTED_NOT_QUOTED')
  assert.equal(result.metadataAvailable, false); assert.equal(result.submissionEnabled, false)
  assert.equal(methods.includes('wallet_sendCalls'), false)
})
test('wrong network and account switching reject preparation', async () => {
  await assert.rejects(connectPreparation({ request: async ({ method }) => method === 'eth_chainId' ? '0x2105' : [wallet] }))
  await assert.rejects(connectPreparation({ request: async ({ method }) => {
    if (method === 'eth_chainId') return '0x14a34'
    if (method === 'eth_requestAccounts') return [wallet]
    if (method === 'eth_accounts') return [other]
    return {}
  } }))
})


test('RPC transport refuses writes and non-factory calls before opening a connection', async () => {
  const rpc=readOnlyFactory()
  try {
    for(const method of ['eth_sendTransaction','eth_sendRawTransaction','eth_sendUserOperation','wallet_sendCalls']) {
      await assert.rejects(rpc.send(method,[]), /rejected/)
    }
    await assert.rejects(rpc.send('eth_call',[{to:other,data:abi.encodeFunctionData('implementation')}]), /Only factory/)
    await assert.rejects(rpc.send('eth_call',[{to:FACTORY,data:abi.encodeFunctionData('createAccount',[[zeroPadValue(wallet,32)],0n])}]), /Only factory/)
    await assert.rejects(compareSdkFactoryData({wallet,factory:FACTORY,factoryData:abi.encodeFunctionData('createAccount',[['0x1234'],0n])},async()=>wallet))
  } finally {rpc.destroy()}
})
