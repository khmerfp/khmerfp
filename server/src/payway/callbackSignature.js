import { createHmac, timingSafeEqual } from 'node:crypto'

const SAFE_CALLBACK_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
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
    const code = value.charCodeAt(index)

    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = value.charCodeAt(index + 1)
      if (Number.isNaN(nextCode) || nextCode < 0xdc00 || nextCode > 0xdfff) {
        throw new UnsupportedCallbackPayloadError()
      }
      encoded += `\\u${code.toString(16).padStart(4, '0')}`
      encoded += `\\u${nextCode.toString(16).padStart(4, '0')}`
      index += 1
      continue
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new UnsupportedCallbackPayloadError()
    }

    const escapes = {
      0x08: '\\b',
      0x09: '\\t',
      0x0a: '\\n',
      0x0c: '\\f',
      0x0d: '\\r',
      0x22: '\\"',
      0x2f: '\\/',
      0x5c: '\\\\',
    }

    if (Object.hasOwn(escapes, code)) {
      encoded += escapes[code]
    } else if (code < 0x20 || code > 0x7e) {
      encoded += `\\u${code.toString(16).padStart(4, '0')}`
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
      if (/^(0|[1-9][0-9]*)$/.test(key)) {
        throw new UnsupportedCallbackPayloadError()
      }
      return `${encodePhpJsonString(key)}:${serializePhpJsonValue(nestedValue)}`
    }).join(',')}}`
  }

  throw new UnsupportedCallbackPayloadError()
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

  return keys
    .sort()
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
