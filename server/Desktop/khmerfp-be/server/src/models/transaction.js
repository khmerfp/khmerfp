
import { getDatabasePool } from '../config/database.js'

export const NAME_MAX_LENGTH = 100
export const ACCOUNT_NUMBER_MAX_LENGTH = 64

export const TRANSACTION_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'CANCELLED',
]

const mapTransaction = (row, includeSensitive = false) => {
  if (!row) return null

  const {
    id,
    tran_id,
    name,
    account_number,
    amount,
    currency,
    status,
    payway_response_code,
    paid_at,
    verification_evidence,
    status_access_token_hash,
    created_at,
    updated_at,
  } = row

  const transaction = {
    id,
    tranId: tran_id,
    name,
    accountNumber: account_number,
    amount: Number(amount),
    currency,
    status,
    paywayResponseCode: payway_response_code,
    paidAt: paid_at,
    verificationEvidence: verification_evidence,
    createdAt: created_at,
    updatedAt: updated_at,
  }

  if (includeSensitive) {
    transaction.statusAccessTokenHash = status_access_token_hash
  }

  return transaction
}

function validateTransaction(data) {
  if (
    typeof data.name !== 'string' ||
    !data.name.trim() ||
    data.name.trim().length > NAME_MAX_LENGTH
  ) {
    throw new Error(
      `Name is required and must not exceed ${NAME_MAX_LENGTH} characters.`,
    )
  }

  if (
    typeof data.accountNumber !== 'string' ||
    !data.accountNumber.trim() ||
    data.accountNumber.trim().length > ACCOUNT_NUMBER_MAX_LENGTH
  ) {
    throw new Error(
      `Account number is required and must not exceed ${ACCOUNT_NUMBER_MAX_LENGTH} characters.`,
    )
  }

  if (!Number.isSafeInteger(data.amount) || data.amount <= 0) {
    throw new Error(
      'Amount must be a positive safe integer representing whole KHR.',
    )
  }

  if (data.currency !== undefined && data.currency !== 'KHR') {
    throw new Error('Currency must be KHR.')
  }

  if (
    data.status !== undefined &&
    !TRANSACTION_STATUSES.includes(data.status)
  ) {
    throw new Error('Invalid transaction status.')
  }

  if (
    data.statusAccessTokenHash != null &&
    !/^[a-f0-9]{64}$/.test(data.statusAccessTokenHash)
  ) {
    throw new Error(
      'Status access token hash must be a SHA-256 hex digest.',
    )
  }
}

export const Transaction = {
  async create(data) {
    validateTransaction(data)

    if (typeof data.tranId !== 'string' || !data.tranId.trim()) {
      throw new Error('Transaction ID is required.')
    }

    const query = `
      INSERT INTO transactions (
        tran_id,
        name,
        account_number,
        amount,
        currency,
        status,
        payway_response_code,
        paid_at,
        verification_evidence,
        status_access_token_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `

    const values = [
      data.tranId.trim(),
      data.name.trim(),
      data.accountNumber.trim(),
      data.amount,
      data.currency ?? 'KHR',
      data.status ?? 'PENDING',
      data.paywayResponseCode ?? null,
      data.paidAt ?? null,
      data.verificationEvidence == null
        ? null
        : JSON.stringify(data.verificationEvidence),
      data.statusAccessTokenHash ?? null,
    ]

    const { rows } = await getDatabasePool().query(query, values)

    return mapTransaction(rows[0])
  },

  async findById(id, options = {}) {
    const query = `
      SELECT *
      FROM transactions
      WHERE id = $1
      LIMIT 1
    `

    const { rows } = await getDatabasePool().query(query, [id])

    return mapTransaction(rows[0], options.includeSensitive === true)
  },

  async findByTranId(tranId, options = {}) {
    const values = [tranId]
    let query = `
      SELECT *
      FROM transactions
      WHERE tran_id = $1
    `

    // Enforce the status access token inside the query so a wrong token
    // can never resolve a transaction.
    if (options.statusAccessTokenHash !== undefined) {
      values.push(options.statusAccessTokenHash)
      query += ` AND status_access_token_hash = $${values.length}`
    }

    query += ' LIMIT 1'

    const { rows } = await getDatabasePool().query(query, values)

    return mapTransaction(rows[0], options.includeSensitive === true)
  },

  async findAll() {
    const { rows } = await getDatabasePool().query(`
      SELECT *
      FROM transactions
      ORDER BY created_at DESC
    `)

    return rows.map((row) => mapTransaction(row))
  },

  async updateByTranId(tranId, updates, options = {}) {
    const allowedColumns = {
      status: 'status',
      paywayResponseCode: 'payway_response_code',
      paidAt: 'paid_at',
      verificationEvidence: 'verification_evidence',
    }

    const fields = Object.entries(updates).filter(
      ([key, value]) =>
        Object.hasOwn(allowedColumns, key) && value !== undefined,
    )

    if (fields.length === 0) {
      return this.findByTranId(tranId)
    }

    if (
      updates.status !== undefined &&
      !TRANSACTION_STATUSES.includes(updates.status)
    ) {
      throw new Error('Invalid transaction status.')
    }

    const values = []

    const setClauses = fields.map(([key, value]) => {
      values.push(
        key === 'verificationEvidence' && value !== null
          ? JSON.stringify(value)
          : value,
      )

      return `${allowedColumns[key]} = $${values.length}${
        key === 'verificationEvidence' ? '::jsonb' : ''
      }`
    })

    values.push(tranId)

    let whereClause = `tran_id = $${values.length}`

    if (options.expectedStatus !== undefined) {
      values.push(options.expectedStatus)
      whereClause += ` AND status = $${values.length}`
    }

    if (options.expectedPaidAtNull === true) {
      whereClause += ' AND paid_at IS NULL'
    }

    const query = `
      UPDATE transactions
      SET ${setClauses.join(', ')},
          updated_at = CURRENT_TIMESTAMP
      WHERE ${whereClause}
      RETURNING *
    `

    const { rows } = await getDatabasePool().query(query, values)

    return mapTransaction(rows[0])
  },
}
