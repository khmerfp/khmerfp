import { createHmac, timingSafeEqual } from 'node:crypto'

const SAFE_CALLBACK_KEY = /^[A-Za-z_]\w*$/
const BASE64_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/

export class UnsupportedCallbackPayloadError extends Error {
  // create a safe serialization error
  constructor(message = 'Callback payload cannot be serialized safely.') {
    super(message)
    this.name = 'UnsupportedCallbackPayloadError'
  }
}

// check one plain parsed json object
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// encode a php-compatible json string
function encodePhpJsonString(value) {
  let encoded = '"'

  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index)

    if (code > 0xffff) {
      const offset = code - 0x10000
      const highSurrogate = 0xd800 + (offset >> 10)
      const lowSurrogate = 0xdc00 + (offset & 0x3ff)
      encoded += String.raw`\u${highSurrogate.toString(16).padStart(4, '0')}`
      encoded += String.raw`\u${lowSurrogate.toString(16).padStart(4, '0')}`
      index += 1
      continue
    }

    if (code >= 0xd800 && code <= 0xdfff) {
      throw new UnsupportedCallbackPayloadError()
    }

    const escapes = {
      0x08: String.raw`\b`,
      0x09: String.raw`\t`,
      0x0a: String.raw`\n`,
      0x0c: String.raw`\f`,
      0x0d: String.raw`\r`,
      0x22: String.raw`\"`,
      0x2f: String.raw`\/`,
      0x5c: String.raw`\\`,
    }

    if (Object.hasOwn(escapes, code)) {
      encoded += escapes[code]
    } else if (code < 0x20 || code > 0x7e) {
      encoded += String.raw`\u${code.toString(16).padStart(4, '0')}`
    } else {
      encoded += value[index]
    }
  }

  return `${encoded}"`
}

// format numbers supported by php json rules
function encodeSupportedNumber(value) {
  if (!Number.isFinite(value) || Object.is(value, -0)) {
    throw new UnsupportedCallbackPayloadError()
  }

  if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new UnsupportedCallbackPayloadError()
  }

  const encoded = String(value)
  const decimalPlaces = encoded.includes('.') ? encoded.split('.')[1].length : 0
  if (encoded.includes('e') || decimalPlaces > 2) {
    throw new UnsupportedCallbackPayloadError()
  }

  return encoded
}

// reproduce default php json encoding for supported values
export function serializePhpJsonValue(value) {
  if (value === null) return 'null'
  if (typeof value === 'string') return encodePhpJsonString(value)
  if (typeof value === 'number') return encodeSupportedNumber(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'

  if (Array.isArray(value)) {
    return `[${value.map(serializePhpJsonValue).join(',')}]`
  }

  if (isPlainObject(value)) {
    return `{${Object.entries(value).map(([key, nestedValue]) => {
      if (/^(0|[1-9]\d*)$/.test(key)) {
        throw new UnsupportedCallbackPayloadError()
      }
      return `${encodePhpJsonString(key)}:${serializePhpJsonValue(nestedValue)}`
    }).join(',')}}`
  }

  throw new UnsupportedCallbackPayloadError()
}

// compare safe ascii keys without locale rules
function compareAsciiKeys(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

// serialize one php concatenation value
function serializeTopLevelValue(value) {
  if (value === null || value === false) return ''
  if (value === true) return '1'
  if (typeof value === 'string') {
    encodePhpJsonString(value)
    return value
  }
  if (typeof value === 'number') return encodeSupportedNumber(value)
  if (Array.isArray(value) || isPlainObject(value)) {
    return serializePhpJsonValue(value)
  }
  throw new UnsupportedCallbackPayloadError()
}

// build the sorted callback signing input
export function buildCallbackSigningInput(payload) {
  if (!isPlainObject(payload)) {
    throw new UnsupportedCallbackPayloadError()
  }

  const keys = Object.keys(payload)
  if (keys.some((key) => !SAFE_CALLBACK_KEY.test(key))) {
    throw new UnsupportedCallbackPayloadError()
  }

  const sortedKeys = keys.toSorted(compareAsciiKeys)
  return sortedKeys
    .map((key) => serializeTopLevelValue(payload[key]))
    .join('')
}

// decode one canonical sha512 signature
function decodeSignature(signature) {
  if (typeof signature !== 'string' || !BASE64_SIGNATURE.test(signature)) {
    return null
  }

  const decoded = Buffer.from(signature, 'base64')
  return decoded.length === 64 && decoded.toString('base64') === signature
    ? decoded
    : null
}

// verify the callback hmac in constant time
export function verifyCallbackSignature(payload, receivedSignature, secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new TypeError('Callback secret is required.')
  }

  const received = decodeSignature(receivedSignature)
  if (!received) return false

  const input = buildCallbackSigningInput(payload)
  const expected = createHmac('sha512', secret).update(input, 'utf8').digest()
  return timingSafeEqual(expected, received)
}
