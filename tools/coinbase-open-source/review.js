// prepare a separate test wallet draft and ownership signature format without signing.
﻿import { AbiCoder, Interface, TypedDataEncoder, getAddress } from 'ethers'
import { FACTORY, IMPLEMENTATION, FACTORY_ABI } from '../coinbase-deployment/preview.js'

export const EXISTING_TESTER = '0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC'
export const REVIEWED_UPSTREAM = 'a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da'
const coder = AbiCoder.defaultAbiCoder()
const factory = new Interface(FACTORY_ABI)
const address = value => {
  const result = getAddress(value)
  if (/^0x0{40}$/i.test(result)) throw new Error('Nonzero public address required.')
  return result
}

// pure review data only; no wallet connection, secret, RPC, signing or deployment.
export function prepareSeparateWallet(input) {
  if (!input || Object.keys(input).sort().join() !== 'chainId,deploymentNonce,ownerAddress') {
    throw new Error('Provide an explicit public owner, chosen nonce and chain.')
  }
  if (input.chainId !== 84532) throw new Error('Only Base Sepolia is allowed.')
  const owner = address(input.ownerAddress)
  if ([EXISTING_TESTER, FACTORY, IMPLEMENTATION].includes(owner)) throw new Error('Use a separate approved tester-controlled EOA.')
  if (typeof input.deploymentNonce !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(input.deploymentNonce) ||
      BigInt(input.deploymentNonce) >= 2n ** 256n) throw new Error('Explicit uint256 deployment nonce required.')
  const owners = [coder.encode(['address'], [owner])]
  const nonce = BigInt(input.deploymentNonce)
  return {
    scope: 'SEPARATE_EOA_OWNED_TEST_ONLY', chainId: 84532,
    factory: FACTORY, implementation: IMPLEMENTATION,
    owner, owners, deploymentNonce: nonce.toString(), ownerIndex: '0',
    predictedAddress: null, ownerControlVerified: false, executionEnabled: false,
    transactionDraft: { to: FACTORY, value: '0x0', data: factory.encodeFunctionData('createAccount', [owners, nonce]) },
    provesExistingSdkAccount: false,
  }
}

// this rejects substitution; it does not independently derive an account address.
export function assertSeparatePrediction(predictedAddress, ownerAddress) {
  const predicted = address(predictedAddress)
  if ([EXISTING_TESTER, FACTORY, IMPLEMENTATION, address(ownerAddress)].includes(predicted)) {
    throw new Error('Prediction must identify a new separate test wallet.')
  }
  return predicted
}

export function replaySafeOwnershipData({ chainId, wallet, ownershipDigest }) {
  if (chainId !== 84532) throw new Error('Only Base Sepolia is allowed.')
  if (!/^0x[0-9a-f]{64}$/i.test(ownershipDigest)) throw new Error('Original bytes32 digest required.')
  return {
    domain: { name: 'Coinbase Smart Wallet', version: '1', chainId, verifyingContract: address(wallet) },
    types: { CoinbaseSmartWalletMessage: [{ name: 'hash', type: 'bytes32' }] },
    message: { hash: ownershipDigest },
  }
}

export function replaySafeOwnershipHash(input) {
  const data = replaySafeOwnershipData(input)
  return TypedDataEncoder.hash(data.domain, data.types, data.message)
}

// an encoded signature is not proof that any owner signed it; verification is separate.
export function wrapEoaOwnerSignature({ ownerIndex, signature }) {
  if (ownerIndex !== '0') throw new Error('This plan has one explicit owner at index zero only.')
  if (!/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error('Expected an owner-provided 65-byte signature.')
  return coder.encode(['tuple(uint256 ownerIndex,bytes signatureData)'], [[0n, signature]])
}
