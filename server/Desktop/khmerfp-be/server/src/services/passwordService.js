import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

// scrypt parameters: N=16384 cost, r=8 block size, p=1 parallelization, 64-byte key
const KEY_LENGTH = 64
const SALT_BYTES = 16
const COST = 16384
const BLOCK_SIZE = 8
const PARALLELIZATION = 1

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 200

export class PasswordPolicyError extends Error {
  constructor(message = 'Password does not meet the policy.') {
    super(message)
    this.name = 'PasswordPolicyError'
  }
}

// Reject obviously weak or malformed passwords before any hashing work.
export function assertPasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordPolicyError(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    )
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new PasswordPolicyError(
      `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`,
    )
  }
}

// Hash a password with a fresh random salt. Returns "scrypt$N$r$p$salt$hash".
export async function hashPassword(password) {
  assertPasswordPolicy(password)

  const salt = randomBytes(SALT_BYTES)
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  })

  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('hex'),
    Buffer.from(derived).toString('hex'),
  ].join('$')
}

// Constant-time comparison of a candidate password against a stored hash.
export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false
  }

  const parts = storedHash.split('$')

  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const cost = Number(parts[1])
  const blockSize = Number(parts[2])
  const parallelization = Number(parts[3])
  const saltHex = parts[4]
  const expectedHex = parts[5]

  if (
    !Number.isInteger(cost)
    || !Number.isInteger(blockSize)
    || !Number.isInteger(parallelization)
    || !saltHex
    || !expectedHex
  ) {
    return false
  }

  let salt
  let expected

  try {
    salt = Buffer.from(saltHex, 'hex')
    expected = Buffer.from(expectedHex, 'hex')
  } catch {
    return false
  }

  let derived

  try {
    derived = await scryptAsync(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
    })
  } catch {
    return false
  }

  return timingSafeEqual(Buffer.from(derived), expected)
}
