import { createHash } from 'node:crypto'
import { deriveConditionId, deriveCollectionId, derivePositionId } from '../../contracts/src/ctfIdentifiers.js'

// Pure verification only. Enrollment requires separate migration-owner SQL privileges.
// A derived identity proves neither on-chain preparation nor inventory backing.
export function verifyMockTokenIdentity({ condition, token, collateralAddress }) {
  if (!['string', 'bigint'].includes(typeof token.index_set)) throw new TypeError('Index set requires an exact integer string or BigInt')
  const conditionId = deriveConditionId({ oracle: condition.oracle_address, questionId: condition.ctf_question_id, outcomeSlotCount: condition.outcome_slot_count })
  if (conditionId !== condition.condition_id) throw new Error('Condition identifier does not match its terms')
  if (String(token.condition_id) !== String(condition.id) || String(token.chain_id) !== String(condition.chain_id) ||
      String(token.collateral_asset_id) !== String(condition.collateral_asset_id) ||
      String(token.ctf_contract_deployment_id) !== String(condition.ctf_contract_deployment_id))
    throw new Error('Token registry references do not match its condition')
  if (token.parent_collection_id !== '0x' + '0'.repeat(64)) throw new Error('Nested positions are unsupported')
  const mask = BigInt(token.index_set)
  if (mask <= 0n || mask >= (1n << BigInt(condition.outcome_slot_count)) - 1n) throw new Error('Unsupported claim mask')
  const collectionId = deriveCollectionId({ conditionId, indexSet: mask })
  const positionId = BigInt(derivePositionId({ collateralAddress, collectionId })).toString()
  if (token.collection_id !== collectionId || token.position_id !== positionId) throw new Error('Token identifier does not match its terms')
  return Object.freeze({ tokenId: String(token.id), conditionId, collectionId, positionId, scope: 'MOCK_ONLY',
    evidenceHash: createHash('sha256').update(JSON.stringify([conditionId, collectionId, positionId])).digest('hex') })
}
