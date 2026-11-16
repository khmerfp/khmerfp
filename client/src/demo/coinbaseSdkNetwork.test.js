import { describe, expect, it } from 'vitest'
// use the installed, pinned SDK's actual network definitions; no wallet is mocked here.
import {
  SUPPORTED_TESTNET_CHAINS,
  getClient,
} from '../../../node_modules/@base-org/account/dist/store/chain-clients/utils.js'

describe('installed Coinbase SDK network configuration - not a passkey integration test', () => {
  it('includes Base Sepolia in its default testnet list', () => {
    expect(SUPPORTED_TESTNET_CHAINS.map((chain) => chain.id)).toContain(84532)
    expect(getClient(84532).chain.id).toBe(84532)
  })
  it('has no default Hardhat network or fallback client', () => {
    expect(SUPPORTED_TESTNET_CHAINS.map((chain) => chain.id)).not.toContain(31337)
    expect(getClient(31337)).toBeUndefined()
  })
})
