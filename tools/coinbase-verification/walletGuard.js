// restrict wallet requests to the reviewed ownership verification flow.
﻿import { TypedDataEncoder, getAddress, id } from 'ethers'
import { assertWalletLinkChallenge, walletLinkTypes } from '../../packages/domain/src/walletLinkProtocol.js'

// ethers may encode integer fields as decimal strings; compare their typed digest.
export function guardWalletProvider(raw, { wallet, origin, getChallenge, isApproved }) {
  return { request: async (request) => {
    if (!isApproved()) throw new Error('Manual test approval is required.')
    if (!['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'eth_signTypedData_v4'].includes(request.method)) {
      throw new Error('Wallet method blocked.')
    }
    if (request.method === 'eth_signTypedData_v4') {
      const challenge = getChallenge()
      const data = assertWalletLinkChallenge(challenge, { origin, wallet, userId: '1', action: 'LINK', domainSalt: id(origin) })
      const signed = JSON.parse(request.params[1])
      const types = { ...signed.types }; delete types.EIP712Domain
      if (getAddress(request.params[0]) !== wallet || signed.primaryType !== 'WalletLink' ||
          JSON.stringify(types) !== JSON.stringify(walletLinkTypes) ||
          JSON.stringify(signed.types.EIP712Domain) !== JSON.stringify(TypedDataEncoder.getPayload(data.domain, data.types, data.message).types.EIP712Domain) ||
          Object.keys(signed.domain).sort().join() !== 'chainId,name,salt,version' ||
          TypedDataEncoder.hash(signed.domain, types, signed.message) !== TypedDataEncoder.hash(data.domain, data.types, data.message)) {
        throw new Error('Unexpected signing payload.')
      }
    }
    return raw.request(request)
  } }
}
