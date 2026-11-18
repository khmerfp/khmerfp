// test ownership signatures against an isolated local test contract.
﻿const { expect } = require('chai')
const { ethers } = require('hardhat')

// local mock contract only; no Coinbase passkey or public chain is used.
describe('Isolated wallet ownership signature', function () {
  it('accepts the shared ownership digest and rejects changed terms and signers', async function () {
    const { walletLinkTypes } = await import('../../packages/domain/src/walletLinkProtocol.js')
    const [owner, other] = await ethers.getSigners()
    const wallet = await ethers.deployContract('Mock1271Wallet', [owner.address])
    const domain = { name: 'KhmerFP Wallet Ownership', version: '1', chainId: 84532, salt: ethers.id('http://127.0.0.1:5173') }
    const now = (await ethers.provider.getBlock('latest')).timestamp
    const message = {
      challengeId: '11111111-1111-4111-8111-111111111111', action: 'LINK', userId: '1',
      wallet: await wallet.getAddress(), sessionBinding: ethers.id('isolated-session'),
      appOrigin: 'http://127.0.0.1:5173', nonce: ethers.id('isolated-nonce'), issuedAt: now, expiresAt: now + 120,
    }
    const signature = await owner.signTypedData(domain, walletLinkTypes, message)
    const digest = ethers.TypedDataEncoder.hash(domain, walletLinkTypes, message)
    expect(await wallet.isValidSignature(digest, signature)).to.equal('0x1626ba7e')
    const changed = ethers.TypedDataEncoder.hash(domain, walletLinkTypes, { ...message, userId: '2' })
    expect(await wallet.isValidSignature(changed, signature)).to.equal('0xffffffff')
    const wrong = await other.signTypedData(domain, walletLinkTypes, message)
    expect(await wallet.isValidSignature(digest, wrong)).to.equal('0xffffffff')
    const wrongChain = ethers.TypedDataEncoder.hash({ ...domain, chainId: 8453 }, walletLinkTypes, message)
    expect(await wallet.isValidSignature(wrongChain, signature)).to.equal('0xffffffff')
  })
})
