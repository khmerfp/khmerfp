// test installed sdk routing at a mocked boundary, not live account support.
import test, { after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createStoreInstance } from '../../node_modules/@base-org/account/dist/store/store.js'
import { Signer } from '../../node_modules/@base-org/account/dist/sign/base-account/Signer.js'
import { guardPreparationProvider } from './connection.js'

const deniedNetwork = mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden in offline compatibility tests.') })
after(() => assert.equal(deniedNetwork.mock.callCount(), 0))

const wallet = '0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC'
function isolatedSigner() {
  const storeInstance = createStoreInstance({ persist: false })
  storeInstance.setState({ account: { accounts: [wallet], chain: { id: 84532 } } })
  const signer = new Signer({ storeInstance, metadata: { appChainIds: [84532] },
    communicator: { waitForPopupLoaded: () => { throw new Error('Real popup forbidden in offline test.') } },
  })
  return signer
}
for (const version of ['1.0', '2.0.0']) {
  test(`installed SDK routes ${version} unchanged to a mocked popup boundary; account acceptance is not tested`, async () => {
    const signer = isolatedSigner()
    const request = { method: 'wallet_sendCalls', params: [{ version, from: wallet, chainId: '0x14a34', atomicRequired: true, calls: [{ to: wallet, value: '0x0', data: '0x' }] }] }
    let captured
    signer.sendRequestToPopup = async value => { captured = structuredClone(value); return 'OFFLINE_ONLY' }
    assert.equal(await signer.request(request), 'OFFLINE_ONLY')
    assert.deepEqual(captured, request)
  })
}
test('universal prepare has no explicit popup route in this installed dispatcher', async () => {
  const signer = isolatedSigner()
  let popup = false
  signer.sendRequestToPopup = async () => { popup = true }
  await assert.rejects(signer.request({ method: 'wallet_prepareCalls', params: [] }), /No RPC URL set for chain/)
  assert.equal(popup, false)
})
test('local preparation guard rejects both send-call versions before forwarding', () => {
  let forwarded = false
  const provider = guardPreparationProvider({ request: () => { forwarded = true } })
  for (const version of ['1.0', '2.0.0']) assert.throws(() => provider.request({ method: 'wallet_sendCalls', params: [{ version }] }))
  assert.equal(forwarded, false)
})
