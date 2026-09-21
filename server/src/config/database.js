import mongoose from 'mongoose'

export const DATABASE_CONNECTION_TIMEOUT_MS = 5000

let hasConnected = false

export async function connectToDatabase(uri, options = {}) {

  // validate the URI before attempting to connect
  if (typeof uri !== 'string' || uri.trim() === '') {
    throw new Error('MONGODB_URI is required.')
  }

  // attempt to connect to the database with a timeout
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: DATABASE_CONNECTION_TIMEOUT_MS,
    ...options,
  })
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1
}

export async function disconnectFromDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
  }
}

//======> event listeners for mongoose connection events
mongoose.connection.on('connected', () => {
  hasConnected = true
})

mongoose.connection.on('disconnected', () => {
  if (hasConnected) {
    console.warn('MongoDB connection lost; readiness checks will fail until it reconnects.')
  }
})

mongoose.connection.on('reconnected', () => {
  console.info('MongoDB connection restored.')
})

mongoose.connection.on('error', () => {
  console.error('MongoDB connection error; connection details have been redacted.')
})
