import { Wallet } from '../models/wallet.js'

// Create the authenticated wallet read handler.
export function createGetWalletHandler(
  getWallet = Wallet.getOrCreateByUserId,
) {
  return async function getWalletHandler(request, response, next) {
    try {
      const wallet = await getWallet(request.authUser.id)

      if (!wallet) {
        response.status(404).json({ message: 'Wallet is unavailable.' })
        return
      }

      response.status(200).json({ wallet })
    } catch (error) {
      next(error)
    }
  }
}
