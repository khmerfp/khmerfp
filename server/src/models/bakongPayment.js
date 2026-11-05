import { getDatabasePool } from '../config/database.js'

export const BAKONG_TRANSACTION_ID_MAX_LENGTH = 25
export const BAKONG_NAME_MAX_LENGTH = 100
export const BAKONG_DESCRIPTION_MAX_LENGTH = 100

export const BAKONG_PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'EXPIRED',
  'FAILED',
]

const MD5_PATTERN = /^[a-f0-9]{32}$/
const STATUS_TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/

const mapBakongPayment = (row, includeSensitive = false) => {
  if (!row) return null

  const {
    id,
    tran_id,
    md5,
    qr_string,
    name,
    description,
    amount,
    currency,
    status,
    status_access_token_hash,
    expires_at,
    paid_at,
    provider_evidence,
    created_at,
    updated_at,
  } = row

  const payment = {
    id,
    tranId: tran_id,
    md5,
    qrString: qr_string,
    name,
    description,
    amount: Number(amount),
    currency,
    status,
    expiresAt: expires_at,
    paidAt: paid_at,
    providerEvidence: provider_evidence,
    createdAt: created_at,
    updatedAt: updated_at,
  }

  if (includeSensitive) {
    payment.statusAccessTokenHash = status_access_token_hash
  }

  return payment
}

function validateCreateData(data) {
  if (
    typeof data.tranId !== 'string'
    || !data.tranId.trim()
    || data.tranId.length > BAKONG_TRANSACTION_ID_MAX_LENGTH
  ) {
    throw new Error(
      `Transaction ID is required and must not exceed ${BAKONG_TRANSACTION_ID_MAX_LENGTH} characters.`,
    )
  }

  if (typeof data.md5 !== 'string' || !MD5_PATTERN.test(data.md5)) {
    throw new Error('MD5 must be a 32-character lowercase hex digest.')
  }

  if (typeof data.qrString !== 'string' || data.qrString.trim() === '') {
    throw new Error('QR string is required.')
  }

  if (
    typeof data.name !== 'string'
    || !data.name.trim()
    || data.name.trim().length > BAKONG_NAME_MAX_LENGTH
  ) {
    throw new Error(
      `Name is required and must not exceed ${BAKONG_NAME_MAX_LENGTH} characters.`,
    )
  }

  if (
    data.description != null
    && (
      typeof data.description !== 'string'
      || data.description.length > BAKONG_DESCRIPTION_MAX_LENGTH
    )
  ) {
    throw new Error(
      `Description must not exceed ${BAKONG_DESCRIPTION_MAX_LENGTH} characters.`,
    )
  }

  if (typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount <= 0) {
    throw new Error('Amount must be a positive number.')
  }

  if (!['USD', 'KHR'].includes(data.currency)) {
    throw new Error('Currency must be USD or KHR.')
  }

  if (data.status !== undefined && !BAKONG_PAYMENT_STATUSES.includes(data.status)) {
    throw new Error('Invalid Bakong payment status.')
  }

  if (
    data.statusAccessTokenHash != null
    && !STATUS_TOKEN_HASH_PATTERN.test(data.statusAccessTokenHash)
  ) {
    throw new Error('Status access token hash must be a SHA-256 hex digest.')
  }

  if (!(data.expiresAt instanceof Date) || Number.isNaN(data.expiresAt.getTime())) {
    throw new Error('Expiration time is required.')
  }
}

export const BakongPayment = {
  async create(data) {
    validateCreateData(data)

    const query = `
      INSERT INTO bakong_payments (
        tran_id,
        md5,
        qr_string,
        name,
        description,
        amount,
        currency,
        status,
        status_access_token_hash,
        expires_at,
        paid_at,
        provider_evidence
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `

    const values = [
      data.tranId.trim(),
      data.md5,
      data.qrString,
      data.name.trim(),
      data.description ?? null,
      data.amount,
      data.currency,
      data.status ?? 'PENDING',
      data.statusAccessTokenHash ?? null,
      data.expiresAt,
      data.paidAt ?? null,
      data.providerEvidence == null
        ? null
        : JSON.stringify(data.providerEvidence),
    ]

    const { rows } = await getDatabasePool().query(query, values)

    return mapBakongPayment(rows[0])
  },

  async findByTranId(tranId, options = {}) {
    const values = [tranId]
    let query = `
      SELECT *
      FROM bakong_payments
      WHERE tran_id = $1
    `

    // Enforce the status access token inside the query so a wrong token
    // can never resolve a payment.
    if (options.statusAccessTokenHash !== undefined) {
      values.push(options.statusAccessTokenHash)
      query += ` AND status_access_token_hash = $${values.length}`
    }

    query += ' LIMIT 1'

    const { rows } = await getDatabasePool().query(query, values)

    return mapBakongPayment(rows[0], options.includeSensitive === true)
  },

  async updateStatus(tranId, updates, options = {}) {
    const allowedColumns = {
      status: 'status',
      paidAt: 'paid_at',
      providerEvidence: 'provider_evidence',
    }

    const fields = Object.entries(updates).filter(
      ([key, value]) =>
        Object.hasOwn(allowedColumns, key) && value !== undefined,
    )

    if (fields.length === 0) {
      return this.findByTranId(tranId)
    }

    if (
      updates.status !== undefined
      && !BAKONG_PAYMENT_STATUSES.includes(updates.status)
    ) {
      throw new Error('Invalid Bakong payment status.')
    }

    const values = []

    const setClauses = fields.map(([key, value]) => {
      values.push(
        key === 'providerEvidence' && value !== null
          ? JSON.stringify(value)
          : value,
      )

      return `${allowedColumns[key]} = $${values.length}${
        key === 'providerEvidence' ? '::jsonb' : ''
      }`
    })

    values.push(tranId)

    let whereClause = `tran_id = $${values.length}`

    if (options.expectedStatus !== undefined) {
      values.push(options.expectedStatus)
      whereClause += ` AND status = $${values.length}`
    }

    const query = `
      UPDATE bakong_payments
      SET ${setClauses.join(', ')},
          updated_at = CURRENT_TIMESTAMP
      WHERE ${whereClause}
      RETURNING *
    `

    const { rows } = await getDatabasePool().query(query, values)

    return mapBakongPayment(rows[0])
  },
}
