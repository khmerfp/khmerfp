import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deriveCollectionId,
  deriveConditionId,
  derivePositionId,
  FIELD_MODULUS,
  ZERO_COLLECTION_ID,
} from '../src/ctfIdentifiers.js'

const oracle = '0x1337aBcdef1337abCdEf1337ABcDeF1337AbcDeF'
const questionId =
  '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabc1234'
const conditionId =
  '0x67eb23e8932765c1d7a094838c928476df8c50d1d3898f278ef1fb2a62afab63'
const collectionId =
  '0x229b067e142fce0aea84afb935095c6ecbea8647b8a013e795cc0ced3210a3d5'

test('derives the official categorical condition reference vector', () => {
  assert.equal(
    deriveConditionId({ oracle, questionId, outcomeSlotCount: 3 }),
    conditionId,
  )
})

test('derives the official alt_bn128 collection reference vector', () => {
  assert.equal(
    deriveCollectionId({
      parentCollectionId: ZERO_COLLECTION_ID,
      conditionId,
      indexSet: 3n,
    }),
    collectionId,
  )
})

test('derives the official nested collection point-addition vector', () => {
  const scalarConditionId =
    '0x3bdb7de3d0860745c0cac9c1dcc8e0d9cb7d33e6a899c2c298343ccedf1d66cf'
  assert.equal(
    deriveCollectionId({ conditionId: scalarConditionId, indexSet: 1n }),
    '0x560ae373ed304932b6f424c8a243842092c117645533390a3c1c95ff481587c2',
  )
  assert.equal(
    deriveCollectionId({
      parentCollectionId: collectionId,
      conditionId: scalarConditionId,
      indexSet: 1n,
    }),
    '0x6f722aa250221af2eba9868fc9d7d43994794177dd6fa7766e3e72ba3c111909',
  )
})

test('derives the official collateral position reference vector', () => {
  assert.equal(
    derivePositionId({
      collateralAddress: '0xD011ad011ad011AD011ad011Ad011Ad011Ad011A',
      collectionId,
    }),
    '0x5355fd8106a08b14aedf99935210b2c22a7f92abaf8bb00b60fcece1032436b7',
  )
})

test('different CTF inputs produce different identifiers', () => {
  assert.notEqual(
    deriveConditionId({ oracle, questionId, outcomeSlotCount: 2 }),
    conditionId,
  )
  assert.notEqual(
    deriveCollectionId({ conditionId, indexSet: 1n }),
    collectionId,
  )
  assert.notEqual(
    derivePositionId({
      collateralAddress: '0x0000000000000000000000000000000000000001',
      collectionId,
    }),
    '0x5355fd8106a08b14aedf99935210b2c22a7f92abaf8bb00b60fcece1032436b7',
  )
})

test('rejects malformed or unsafe identifiers', () => {
  assert.throws(
    () => deriveConditionId({ oracle: '0x1234', questionId, outcomeSlotCount: 2 }),
    /valid Ethereum address/,
  )
  assert.throws(
    () => deriveConditionId({
      oracle: oracle.replace('a', 'A'),
      questionId,
      outcomeSlotCount: 2,
    }),
    /valid Ethereum address/,
  )
  assert.throws(
    () => deriveConditionId({ oracle, questionId: '0x1234', outcomeSlotCount: 2 }),
    /32-byte hex/,
  )
  assert.throws(
    () => deriveConditionId({ oracle, questionId, outcomeSlotCount: 1 }),
    /2 through 256/,
  )
  assert.throws(
    () => deriveCollectionId({ conditionId, indexSet: 0n }),
    /at least one outcome/,
  )
  assert.throws(
    () => deriveCollectionId({ conditionId, indexSet: 1 }),
    /uint256 bigint/,
  )
  assert.throws(
    () => deriveCollectionId({ conditionId, indexSet: 1n << 256n }),
    /uint256 bigint/,
  )
  assert.throws(
    () => deriveCollectionId({
      parentCollectionId: `0x${'4'.padStart(64, '0')}`,
      conditionId,
      indexSet: 1n,
    }),
    /valid alt_bn128 point/,
  )
  assert.throws(
    () => deriveCollectionId({
      parentCollectionId: `0x${FIELD_MODULUS.toString(16).padStart(64, '0')}`,
      conditionId,
      indexSet: 1n,
    }),
    /valid alt_bn128 point/,
  )
})
