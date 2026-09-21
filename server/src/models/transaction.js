import mongoose from 'mongoose'

export const NAME_MAX_LENGTH = 100
export const ACCOUNT_NUMBER_MAX_LENGTH = 64
export const TRANSACTION_STATUSES = ['PENDING', 'PAID', 'FAILED', 'CANCELLED']

export const transactionSchema = new mongoose.Schema(
  {
    tranId: {
      type: String,
      required: true,
      immutable: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: NAME_MAX_LENGTH,
    },
    accountNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: ACCOUNT_NUMBER_MAX_LENGTH,
    },
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (value) => Number.isSafeInteger(value) && value > 0,
        message: 'Amount must be a positive safe integer representing whole KHR.',
      },
    },
    currency: {
      type: String,
      enum: ['KHR'],
      default: 'KHR',
    },
    status: {
      type: String,
      enum: TRANSACTION_STATUSES,
      default: 'PENDING',
    },
    paywayResponseCode: {
      type: String,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
)

export const Transaction = mongoose.model('Transaction', transactionSchema)

