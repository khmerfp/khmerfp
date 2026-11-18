// test isolated ownership verification with controlled wallet and rpc responses.
﻿import test from 'node:test'
import assert from 'node:assert/strict'
import { Interface, TypedDataEncoder } from 'ethers'
import { harnessConfig, createHarness, assertReadOnlyRequest, ORIGIN } from './harness.js'
import { guardWalletProvider } from './walletGuard.js'

const wallet = '0x1111111111111111111111111111111111111111'
const other = '0x2222222222222222222222222222222222222222'
const env = { COINBASE_PROBE_ENABLED: 'true', COINBASE_PROBE_ACK: 'ISOLATED_TEST_ONLY', COINBASE_PROBE_WALLET: wallet }
const abi = new Interface(['function isValidSignature(bytes32,bytes) view returns(bytes4)'])
function fixture() {
  let time = Date.now(), chain = 84532n, code = '0x6000', magic = '0x1626ba7e', digest, calls = 0, destroyed = 0
  const factory = () => ({
    getNetwork: async () => ({ chainId: chain }), getBlock: async () => ({ number: 10, hash: `0x${'ab'.repeat(32)}` }),
    getCode: async () => code, destroy: () => destroyed++,
    call: async (tx) => {
      calls++
      assert.equal(tx.to.toLowerCase(), wallet)
      const [actual, signature] = abi.decodeFunctionData('isValidSignature', tx.data)
      return abi.encodeFunctionResult('isValidSignature', [actual === digest && signature === '0x1234' ? magic : '0xffffffff'])
    },
  })
  const harness = createHarness(harnessConfig(env), { rpcFactory: factory, now: () => time })
  return { harness, factory, setChain: v => { chain = v }, setCode: v => { code = v }, setMagic: v => { magic = v }, advance: v => { time += v },
    get calls() { return calls }, get destroyed() { return destroyed },
    async proof() { const challenge = await harness.issue(); const t = challenge.typedData; digest = TypedDataEncoder.hash(t.domain,t.types,t.message); return { challenge, walletAddress: wallet, signature: '0x1234' } },
  }
}

test('configuration requires opt-in, valid wallet, fixed chain/magic and public RPC', () => {
  assert.throws(() => harnessConfig({}))
  for (const change of [{ COINBASE_PROBE_WALLET: '<TESTER_DEPLOYED_WALLET>' }, { COINBASE_PROBE_WALLET: `0x${'0'.repeat(40)}` },
    { COINBASE_PROBE_CHAIN_ID: '8453' }, { COINBASE_PROBE_MAGIC: '0xffffffff' },
    { COINBASE_PROBE_RPC_URL: 'http://127.0.0.1:8545' }, { COINBASE_PROBE_RPC_URL: 'https://user:secret@rpc.example.com' }]) {
    assert.throws(() => harnessConfig({ ...env, ...change }))
  }
  assert.equal(harnessConfig(env).chainId, 84532)
})
test('read-only RPC guard rejects transactions, arbitrary calls and wrong wallet', () => {
  for (const method of ['eth_sendTransaction','eth_sendRawTransaction','eth_sendUserOperation','wallet_sendCalls']) {
    assert.throws(() => assertReadOnlyRequest(method, [], wallet))
  }
  assert.throws(() => assertReadOnlyRequest('eth_getCode', [other,'latest'], wallet))
  assert.throws(() => assertReadOnlyRequest('eth_call', [{ to: wallet, data: '0xdeadbeef' }], wallet))
  assert.throws(() => assertReadOnlyRequest('eth_call', [{ to: wallet, data: '0x1626ba7e', value: '0x1' }], wallet))
  assert.doesNotThrow(() => assertReadOnlyRequest('eth_call', [{ to: wallet, data: '0x1626ba7e', gas: '0x7a120' }], wallet))
})
test('preflight checks deployment without calling signature validation', async () => {
  const f = fixture(); assert.equal((await f.harness.preflight()).deployed,true); assert.equal(f.calls,0); assert.equal(f.destroyed,1)
})
test('wrong RPC chain and undeployed/delegated wallets fail closed', async () => {
  const f = fixture(); f.setChain(8453n); await assert.rejects(f.harness.preflight(), /chain/)
  f.setChain(84532n); f.setCode('0x'); await assert.rejects(f.harness.issue(), /code/)
  f.setCode('0xef01001122'); await assert.rejects(f.harness.preflight(), /Delegated/)
  assert.equal(f.calls,0)
})
test('fresh challenge uses real shared verifier and returns sanitized evidence', async () => {
  const f = fixture(), body = await f.proof(); const result = await f.harness.verify(body)
  assert.equal(result.verified,true); assert.equal(result.magicValue,'0x1626ba7e'); assert.equal(f.calls,1)
  assert.equal('signature' in result,false); assert.equal('challenge' in result,false); assert.equal('wallet' in result,false)
  await assert.rejects(f.harness.verify(body), /used/)
})
test('wrong wallet, altered terms and wrong domain are rejected before eth_call', async () => {
  for (const mutate of [b => { b.walletAddress=other }, b => { b.challenge.typedData.message.nonce=`0x${'ff'.repeat(32)}` },
    b => { b.challenge.typedData.message.sessionBinding=`0x${'ff'.repeat(32)}` }, b => { b.challenge.typedData.domain.chainId=8453 }]) {
    const f = fixture(), body = await f.proof(); mutate(body); await assert.rejects(f.harness.verify(body)); assert.equal(f.calls,0)
  }
})
test('expired challenges reject before validation', async () => {
  const f=fixture(), body=await f.proof(); f.advance(120001); await assert.rejects(f.harness.verify(body)); assert.equal(f.calls,0)
})
test('invalid signature, non-magic results and 6492 are rejected and consumed', async () => {
  for (const signature of ['0x','not-hex','0xffff',`0x1234${'6492'.repeat(16)}`]) {
    const f=fixture(), body=await f.proof(); body.signature=signature
    await assert.rejects(f.harness.verify(body)); await assert.rejects(f.harness.verify(body), /used/)
  }
  const f=fixture(),body=await f.proof(); f.setMagic('0xffffffff'); await assert.rejects(f.harness.verify(body))
})
test('concurrent verification has one winner', async () => {
  const f=fixture(),body=await f.proof(); const result=await Promise.allSettled([f.harness.verify(body),f.harness.verify(body)])
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1); assert.equal(f.calls,1)
})
test('timeout destroys read provider and permits a new preflight attempt', async () => {
  let destroyed=0
  const f=createHarness(harnessConfig(env), { timeoutMs: 5, rpcFactory: () => ({ getNetwork: () => new Promise(()=>{}), destroy: () => destroyed++ }) })
  await assert.rejects(f.preflight(), /timed out/); await assert.rejects(f.preflight(), /timed out/); assert.equal(destroyed,2)
})
test('provider creation errors do not leave the preflight locked', async () => {
  let calls=0; const f=createHarness(harnessConfig(env), {rpcFactory:()=>{calls++;throw Error('mock unavailable')} })
  await assert.rejects(f.preflight(),/unavailable/); await assert.rejects(f.preflight(),/unavailable/); assert.equal(calls,2)
})
test('wallet guard accepts ethers numeric encoding but blocks changed payloads and transactions', async () => {
  const f=fixture(),body=await f.proof(); const t=body.challenge.typedData
  let calls=0, approved=true
  const provider=guardWalletProvider({request:async()=>{calls++;return '0x1234'}}, {wallet,origin:ORIGIN,getChallenge:()=>body.challenge,isApproved:()=>approved})
  const payload=TypedDataEncoder.getPayload(t.domain,t.types,t.message)
  const request={method:'eth_signTypedData_v4',params:[wallet,JSON.stringify(payload)]}
  assert.equal(await provider.request(request),'0x1234')
  const changed=structuredClone(payload); changed.message.userId='2'
  await assert.rejects(provider.request({...request,params:[wallet,JSON.stringify(changed)]}))
  await assert.rejects(provider.request({...request,params:[other,JSON.stringify(payload)]}))
  await assert.rejects(provider.request({method:'eth_sendTransaction',params:[]}))
  approved=false; await assert.rejects(provider.request(request)); assert.equal(calls,1)
})


test('expiry during signature RPC is rejected even when the account returns magic', async () => {
  let clock=Date.now()
  const rpcFactory=()=>({getNetwork:async()=>({chainId:84532n}),getCode:async()=>'0x6000',
    getBlock:async()=>({number:10,hash:'0x'+'ab'.repeat(32)}),destroy:()=>{},
    call:async()=>{clock+=120001;return abi.encodeFunctionResult('isValidSignature',['0x1626ba7e'])}})
  const checked=createHarness(harnessConfig(env),{now:()=>clock,rpcFactory})
  const challenge=await checked.issue()
  await assert.rejects(checked.verify({challenge,walletAddress:wallet,signature:'0x1234'}))
})

test('wallet guard preserves EIP-712 domain types and rejects expired signing requests', async () => {
  const f=fixture(), body=await f.proof(), t=body.challenge.typedData
  let calls=0
  const provider=guardWalletProvider({request:async()=>{calls++;return '0x1234'}}, {wallet,origin:ORIGIN,getChallenge:()=>body.challenge,isApproved:()=>true})
  const payload=TypedDataEncoder.getPayload(t.domain,t.types,t.message)
  payload.types.EIP712Domain=[]
  await assert.rejects(provider.request({method:'eth_signTypedData_v4',params:[wallet,JSON.stringify(payload)]}))
  body.challenge.typedData.message.issuedAt=Math.floor(Date.now()/1000)-121
  body.challenge.typedData.message.expiresAt=body.challenge.typedData.message.issuedAt+120
  const expired=TypedDataEncoder.getPayload(t.domain,t.types,t.message)
  await assert.rejects(provider.request({method:'eth_signTypedData_v4',params:[wallet,JSON.stringify(expired)]}))
  assert.equal(calls,0)
})
