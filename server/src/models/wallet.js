import { getDatabasePool } from '../config/database.js'

function mapWallet(row) {
  if (!row) return null

  return {
    userId: row.user_id,
    currency: row.currency,
    khrBalanceMinor: Number(row.balance_minor),
    usdBalanceMinor: Number(row.usd_balance_minor),
    updatedAt: row.updated_at,
  }
}

export const Wallet = {
  // Read a wallet, creating an empty one for accounts that predate wallets.
  async getOrCreateByUserId(userId) {
    const pool = getDatabasePool()

    const inserted = await pool.query(
      `INSERT INTO wallets (user_id, balance_minor, usd_balance_minor, currency)
       VALUES ($1, 0, 0, 'KHR')
       ON CONFLICT (user_id) DO NOTHING
       RETURNING *`,
      [userId],
    )

    if (inserted.rows[0]) {
      return mapWallet(inserted.rows[0])
    }

    const existing = await pool.query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [userId],
    )

    return mapWallet(existing.rows[0])
  },
}
