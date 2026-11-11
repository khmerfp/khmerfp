import { getDatabasePool } from '../config/database.js'

export const BAKONG_TRANSACTION_ID_MAX_LENGTH = 25
export const BAKONG_NAME_MAX_LENGTH = 100
export const BAKONG_DESCRIPTION_MAX_LENGTH = 100
export const BAKONG_IDEMPOTENCY_KEY_MAX_LENGTH = 64

export const BAKONG_PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'EXPIRED',
  'FAILED',
]

export const BAKONG_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

const MD5_PATTERN = /^[a-f0-9]{32}$/
const STATUS_TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/

const mapBakongPayment = (row, includeSensitive = false) => {
  if (!row) return null

  const {
    id,
    user_id,
    tran_id,
    md5,
    qr_string,
    name,
    description,
    amount,
    amount_minor,
    currency,
    status,
    status_access_token_hash,
    idempotency_key,
    expires_at,
    paid_at,
    wallet_credited_at,
    provider_evidence,
    last_checked_at,
    created_at,
    updated_at,
  } = row

  const payment = {
    id,
    userId: user_id == null ? null : Number(user_id),
    tranId: tran_id,
    md5,
    qrString: qr_string,
    name,
    description,
    amount: Number(amount),
    amountMinor: Number(amount_minor),
    currency,
    status,
    idempotencyKey: idempotency_key,
    expiresAt: expires_at,
    paidAt: paid_at,
    walletCreditedAt: wallet_credited_at,
    providerEvidence: provider_evidence,
    lastCheckedAt: last_checked_at,
    createdAt: created_at,
    updatedAt: updated_at,
  }

  if (includeSensitive) {
    payment.statusAccessTokenHash = status_access_token_hash
  }

  return payment
}

function validateUserId(userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('User ID is required.')
  }
}

function validateAmountMinor(amountMinor) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Amount minor units must be a positive integer.')
  }
}

function validateIdempotencyKey(idempotencyKey) {
  if (idempotencyKey == null) return

  if (
    typeof idempotencyKey !== 'string'
    || !BAKONG_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
  ) {
    throw new Error(
      `Idempotency key must be ${BAKONG_IDEMPOTENCY_KEY_MAX_LENGTH} characters or fewer and contain only letters, numbers, hyphens, or underscores.`,
    )
  }
}

function validateCreateData(data) {
  validateUserId(data.userId)
  validateAmountMinor(data.amountMinor)
  validateIdempotencyKey(data.idempotencyKey)

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
        user_id,
        tran_id,
        md5,
        qr_string,
        name,
        description,
        amount,
        amount_minor,
        currency,
        status,
        status_access_token_hash,
        idempotency_key,
        expires_at,
        paid_at,
        provider_evidence
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `

    const values = [
      data.userId,
      data.tranId.trim(),
      data.md5,
      data.qrString,
      data.name.trim(),
      data.description ?? null,
      data.amount,
      data.amountMinor,
      data.currency,
      data.status ?? 'PENDING',
      data.statusAccessTokenHash ?? null,
      data.idempotencyKey ?? null,
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
    const db = options.client ?? getDatabasePool()
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

    const { rows } = await db.query(query, values)

    return mapBakongPayment(rows[0], options.includeSensitive === true)
  },

  async findByUserIdAndIdempotencyKey(userId, idempotencyKey) {
    validateUserId(userId)
    validateIdempotencyKey(idempotencyKey)

    if (idempotencyKey == null) return null

    const { rows } = await getDatabasePool().query(
      `SELECT *
       FROM bakong_payments
       WHERE user_id = $1 AND idempotency_key = $2
       LIMIT 1`,
      [userId, idempotencyKey],
    )

    return mapBakongPayment(rows[0])
  },

  async rotateStatusAccessToken(tranId, statusAccessTokenHash, userId) {
    validateUserId(userId)

    if (!STATUS_TOKEN_HASH_PATTERN.test(statusAccessTokenHash)) {
      throw new Error('Status access token hash must be a SHA-256 hex digest.')
    }

    const { rows } = await getDatabasePool().query(
      `UPDATE bakong_payments
       SET status_access_token_hash = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE tran_id = $1 AND user_id = $3
       RETURNING *`,
      [tranId, statusAccessTokenHash, userId],
    )

    return mapBakongPayment(rows[0])
  },

  async updateStatus(tranId, updates, options = {}) {
    const db = options.client ?? getDatabasePool()
    const allowedColumns = {
      status: 'status',
      paidAt: 'paid_at',
      providerEvidence: 'provider_evidence',
      lastCheckedAt: 'last_checked_at',
    }

    const fields = Object.entries(updates).filter(
      ([key, value]) =>
        Object.hasOwn(allowedColumns, key) && value !== undefined,
    )

    if (fields.length === 0) {
      return this.findByTranId(tranId, { client: options.client })
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

    const { rows } = await db.query(query, values)

    return mapBakongPayment(rows[0])
  },

  // Mark a verified payment PAID and credit the wallet exactly once. The row
  // lock plus wallet_credited_at make concurrent status polls safe.
  async creditVerifiedPayment({
    tranId,
    statusAccessTokenHash,
    userId,
    amountMinor,
    currency,
    paidAt,
    providerEvidence,
  }) {
    validateUserId(userId)
    validateAmountMinor(amountMinor)

    if (!['USD', 'KHR'].includes(currency)) {
      throw new Error('Currency must be USD or KHR.')
    }

    if (!STATUS_TOKEN_HASH_PATTERN.test(statusAccessTokenHash)) {
      throw new Error('Status access token hash must be a SHA-256 hex digest.')
    }

    if (!(paidAt instanceof Date) || Number.isNaN(paidAt.getTime())) {
      throw new Error('Paid time is required.')
    }

    const pool = getDatabasePool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const { rows } = await client.query(
        `SELECT *
         FROM bakong_payments
         WHERE tran_id = $1 AND status_access_token_hash = $2
         FOR UPDATE`,
        [tranId, statusAccessTokenHash],
      )

      const payment = rows[0]

      if (!payment) {
        await client.query('ROLLBACK')
        return null
      }

      if (Number(payment.user_id) !== userId) {
        throw new Error('Bakong payment does not belong to this user.')
      }

      if (
        payment.currency !== currency
        || Number(payment.amount_minor) !== amountMinor
      ) {
        throw new Error(
          'Verified Bakong amount does not match the stored payment.',
        )
      }

      // Another poll already applied the credit.
      if (payment.status === 'PAID' && payment.wallet_credited_at != null) {
        await client.query('COMMIT')
        return mapBakongPayment(payment)
      }

      if (payment.status !== 'PENDING' && payment.status !== 'PAID') {
        await client.query('COMMIT')
        return mapBakongPayment(payment)
      }

      let updated

      if (payment.status === 'PENDING') {
        updated = await client.query(
          `UPDATE bakong_payments
           SET status = 'PAID',
               paid_at = $2,
               wallet_credited_at = $2,
               provider_evidence = $3::jsonb,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status = 'PENDING'
           RETURNING *`,
          [
            payment.id,
            paidAt,
            providerEvidence == null
              ? null
              : JSON.stringify(providerEvidence),
          ],
        )
      } else {
        // Recover a PAID row whose wallet credit was never applied.
        updated = await client.query(
          `UPDATE bakong_payments
           SET wallet_credited_at = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND wallet_credited_at IS NULL
           RETURNING *`,
          [payment.id, paidAt],
        )
      }

      if (updated.rowCount === 0) {
        await client.query('ROLLBACK')
        return mapBakongPayment(payment)
      }

      await client.query(
        `INSERT INTO wallets (user_id, balance_minor, usd_balance_minor, currency)
         VALUES ($1, 0, 0, 'KHR')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId],
      )

      const balanceColumn = currency === 'KHR'
        ? 'balance_minor'
        : 'usd_balance_minor'

      const walletUpdate = await client.query(
        `UPDATE wallets
         SET ${balanceColumn} = ${balanceColumn} + $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1
         RETURNING *`,
        [userId, amountMinor],
      )

      if (walletUpdate.rowCount === 0) {
        throw new Error('Wallet is unavailable for this user.')
      }

      await client.query('COMMIT')

      return mapBakongPayment(updated.rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  },
}
