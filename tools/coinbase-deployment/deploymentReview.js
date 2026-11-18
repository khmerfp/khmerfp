// report missing deployment evidence without authorizing account setup.
import { getAddress } from 'ethers'
import { FACTORY, IMPLEMENTATION, FACTORY_HASH, IMPLEMENTATION_HASH } from './preview.js'

export const REVIEWED_TESTER = '0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC'

// pure review data only; there is deliberately no provider or submit method.
export function deploymentReview(inspection) {
  if (!inspection || inspection.chainId !== 84532 || getAddress(inspection.wallet) !== REVIEWED_TESTER) {
    throw new Error('This preview is limited to the reviewed tester account on Base Sepolia.')
  }
  if (inspection.sdkConnected !== true || inspection.factory !== FACTORY || inspection.implementation !== IMPLEMENTATION ||
      inspection.factoryCodeHash !== FACTORY_HASH || inspection.implementationCodeHash !== IMPLEMENTATION_HASH ||
      !Number.isSafeInteger(inspection.factoryVerifiedAtBlock) || !/^0x[0-9a-f]{64}$/i.test(inspection.blockHash || '')) {
    throw new Error('Fresh SDK connection and reviewed public contract evidence are required.')
  }
  if (inspection.deploymentStatus !== 'NO_CODE') throw new Error('Account state changed; review before preparing deployment.')
  return {
    status: 'BLOCKED', submissionEnabled: false, signingEnabled: false,
    account: REVIEWED_TESTER, chainId: 84532,
    currentDocumentationVersion: '2.0.0', installedSdkHelperVersion: '1.0',
    sdkCompatibilityVerified: false, firstUseDeploymentVerified: false,
    gasEstimate: null, maximumFeeWei: null, sponsorshipConfirmed: false,
    // this is a schema example, not an operation prepared or quoted by the wallet.
    documentationDraft: {
      method: 'wallet_sendCalls', params: [{ version: '2.0.0', from: REVIEWED_TESTER,
        chainId: '0x14a34', atomicRequired: true,
        calls: [{ to: REVIEWED_TESTER, value: '0x0', data: '0x' }],
      }],
    },
    blockers: [
      'No documented non-submitting preparation flow has been verified for this universal account.',
      'Current documentation and the installed SDK helper use different request versions; compatibility is unverified.',
      'Wallet-managed deployment or delegation effects for this account are unknown.',
      'No complete fee quote or account-specific sponsorship commitment is available.',
    ],
    scope: 'One explicit zero-value self-call; wallet setup and gas effects remain unreviewed. No operation may be submitted.',
  }
}
