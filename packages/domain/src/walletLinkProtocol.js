export const WALLET_LINK_NAME = 'KhmerFP Wallet Ownership'
export const WALLET_LINK_VERSION = '1'
export const WALLET_LINK_CHAIN = 84532
export const WALLET_LINK_TTL_SECONDS = 120
export const WALLET_LINK_ACTIONS = ['LINK', 'UNLINK', 'RELINK']
export const isWalletLinkChallengeId = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export const walletLinkTypes = {
  WalletLink: [
    ['challengeId', 'string'],
    ['action', 'string'],
    ['userId', 'uint256'],
    ['wallet', 'address'],
    ['sessionBinding', 'bytes32'],
    ['appOrigin', 'string'],
    ['nonce', 'bytes32'],
    ['issuedAt', 'uint64'],
    ['expiresAt', 'uint64'],
  ].map(([name, type]) => ({ name, type })),
}

const keysEqual = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join()

// validate server data before presenting a wallet signature request.
export function assertWalletLinkChallenge(
  challenge,
  { origin, wallet, userId, action, domainSalt, now = Date.now() },
) {
  const data = challenge?.typedData,
    domain = data?.domain,
    message = data?.message
  if (
    !keysEqual(challenge, ['challengeId', 'typedData']) ||
    !keysEqual(data, ['domain', 'types', 'primaryType', 'message']) ||
    data.primaryType !== 'WalletLink' ||
    JSON.stringify(data.types) !== JSON.stringify(walletLinkTypes) ||
    !keysEqual(domain, ['name', 'version', 'chainId', 'salt']) ||
    domain.name !== WALLET_LINK_NAME ||
    domain.version !== WALLET_LINK_VERSION ||
    domain.chainId !== WALLET_LINK_CHAIN ||
    domain.salt !== domainSalt ||
    !keysEqual(
      message,
      walletLinkTypes.WalletLink.map((field) => field.name),
    ) ||
    message.appOrigin !== origin ||
    message.wallet?.toLowerCase() !== wallet.toLowerCase() ||
    message.userId !== String(userId) ||
    message.action !== action ||
    !WALLET_LINK_ACTIONS.includes(action) ||
    message.challengeId !== challenge.challengeId ||
    !isWalletLinkChallengeId(challenge.challengeId) ||
    !/^0x[0-9a-f]{64}$/i.test(message.sessionBinding) ||
    !/^0x[0-9a-f]{64}$/i.test(message.nonce) ||
    !Number.isSafeInteger(message.issuedAt) ||
    !Number.isSafeInteger(message.expiresAt) ||
    message.expiresAt - message.issuedAt !== WALLET_LINK_TTL_SECONDS ||
    message.expiresAt * 1000 <= now ||
    message.issuedAt * 1000 > now + 30000
  ) {
    throw new Error(
      'Wallet-link challenge does not match this user, wallet, session context or application.',
    )
  }
  return data
}
