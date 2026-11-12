import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

const FIELD_MODULUS =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n
const ZERO_COLLECTION_ID = `0x${'0'.repeat(64)}`
const HEX_32_PATTERN = /^0x[0-9a-fA-F]{64}$/

// Asserts that a value is a 32-byte hex string
function assertBytes32(value, label) {
  if (typeof value !== 'string' || !HEX_32_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a 32-byte hex value`)
  }
  return value.toLowerCase()
}

// Asserts that a value is a valid Ethereum address
function assertAddress(value, label) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${label} must be a valid Ethereum address`)
  }

  const address = value.slice(2)
  const lower = address.toLowerCase()
  const upper = address.toUpperCase()
  if (address !== lower && address !== upper) {
    const checksum = bytesToHex(keccak_256(utf8ToBytes(lower)))
    const validChecksum = [...address].every((character, index) => (
      /[0-9]/.test(character)
      || (Number.parseInt(checksum[index], 16) >= 8
        ? character === character.toUpperCase()
        : character === character.toLowerCase())
    ))
    if (!validChecksum) {
      throw new TypeError(`${label} must be a valid Ethereum address`)
    }
  }
  return value.toLowerCase()
}

// Asserts that a value is a uint256 bigint
function assertUint256(value, label) {
  if (typeof value !== 'bigint' || value < 0n || value >= 1n << 256n) {
    throw new TypeError(`${label} must be a uint256 bigint`)
  }
  return value
}

// Reduces a bigint modulo the field modulus, ensuring a non-negative result
function mod(value) {
  const result = value % FIELD_MODULUS
  return result >= 0n ? result : result + FIELD_MODULUS
}

function uint256Bytes(value) {
  return hexToBytes(value.toString(16).padStart(64, '0'))
}

function packedKeccak(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const packed = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    packed.set(part, offset)
    offset += part.length
  }
  return `0x${bytesToHex(keccak_256(packed))}`
}

function modPow(base, exponent) {
  let result = 1n
  let factor = mod(base)
  let power = exponent
  while (power > 0n) {
    if ((power & 1n) === 1n) result = mod(result * factor)
    factor = mod(factor * factor)
    power >>= 1n
  }
  return result
}

function inverse(value) {
  if (mod(value) === 0n) throw new Error('cannot invert zero in the curve field')
  return modPow(value, FIELD_MODULUS - 2n)
}

function curveY(x, odd) {
  const yy = mod(x * x * x + 3n)
  let y = modPow(yy, (FIELD_MODULUS + 1n) / 4n)
  if (mod(y * y) !== yy) return null
  if ((y & 1n) !== (odd ? 1n : 0n)) y = FIELD_MODULUS - y
  return y
}

function addCurvePoints(first, second) {
  if (first === null) return second
  if (second === null) return first

  const [x1, y1] = first
  const [x2, y2] = second
  if (x1 === x2 && mod(y1 + y2) === 0n) return null

  const slope = x1 === x2
    ? mod(3n * x1 * x1 * inverse(2n * y1))
    : mod((y2 - y1) * inverse(x2 - x1))
  const x3 = mod(slope * slope - x1 - x2)
  const y3 = mod(slope * (x1 - x3) - y1)
  return [x3, y3]
}

function encodeCollectionPoint(point) {
  if (point === null) return ZERO_COLLECTION_ID
  let [x, y] = point
  if ((y & 1n) === 1n) x ^= 1n << 254n
  return `0x${x.toString(16).padStart(64, '0')}`
}

function decodeCollectionPoint(collectionId) {
  const encoded = BigInt(assertBytes32(collectionId, 'parentCollectionId'))
  if (encoded === 0n) return null
  const odd = ((encoded >> 254n) & 1n) === 1n
  const x = encoded & ((1n << 254n) - 1n)
  if (x >= FIELD_MODULUS) {
    throw new Error('parentCollectionId is not a valid alt_bn128 point')
  }
  const y = curveY(x, odd)
  if (y === null) throw new Error('parentCollectionId is not a valid alt_bn128 point')
  return [x, y]
}

export function deriveConditionId({ oracle, questionId, outcomeSlotCount }) {
  const normalizedOracle = assertAddress(oracle, 'oracle')
  const normalizedQuestionId = assertBytes32(questionId, 'questionId')
  if (
    !Number.isInteger(outcomeSlotCount)
    || outcomeSlotCount < 2
    || outcomeSlotCount > 256
  ) {
    throw new RangeError('outcomeSlotCount must be an integer from 2 through 256')
  }
  return packedKeccak([
    hexToBytes(normalizedOracle.slice(2)),
    hexToBytes(normalizedQuestionId.slice(2)),
    uint256Bytes(BigInt(outcomeSlotCount)),
  ])
}

export function deriveCollectionId({
  parentCollectionId = ZERO_COLLECTION_ID,
  conditionId,
  indexSet,
}) {
  const normalizedConditionId = assertBytes32(conditionId, 'conditionId')
  const normalizedIndexSet = assertUint256(indexSet, 'indexSet')
  if (normalizedIndexSet === 0n) {
    throw new RangeError('indexSet must select at least one outcome')
  }

  const digest = BigInt(packedKeccak([
    hexToBytes(normalizedConditionId.slice(2)),
    uint256Bytes(normalizedIndexSet),
  ]))
  const odd = (digest >> 255n) === 1n
  let x = digest
  let y = null
  do {
    x = mod(x + 1n)
    y = curveY(x, odd)
  } while (y === null)

  const combined = addCurvePoints(
    [x, y],
    decodeCollectionPoint(parentCollectionId),
  )
  return encodeCollectionPoint(combined)
}

export function derivePositionId({ collateralAddress, collectionId }) {
  const normalizedCollateral = assertAddress(collateralAddress, 'collateralAddress')
  const normalizedCollection = assertBytes32(collectionId, 'collectionId')
  return packedKeccak([
    hexToBytes(normalizedCollateral.slice(2)),
    hexToBytes(normalizedCollection.slice(2)),
  ])
}

export { FIELD_MODULUS, ZERO_COLLECTION_ID }
