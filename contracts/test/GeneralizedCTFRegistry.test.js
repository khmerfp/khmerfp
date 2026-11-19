const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('Generalized registry identifiers against official Gnosis CTF', function () {
  it('derives all six singleton/complement tokens and redeems the selected pair correctly', async function () {
    const { deriveConditionId, deriveCollectionId, derivePositionId } = await import('../../packages/contracts/src/ctfIdentifiers.js')
    const [oracle] = await ethers.getSigners()
    const collateral = await ethers.deployContract('MockCollateral')
    const ctf = await ethers.deployContract('ConditionalTokens')
    await Promise.all([collateral.waitForDeployment(), ctf.waitForDeployment()])
    const questionId = ethers.id('isolated six-range registry fixture')
    const conditionId = deriveConditionId({ oracle: oracle.address, questionId, outcomeSlotCount: 6 })
    expect(await ctf.getConditionId(oracle.address, questionId, 6)).to.equal(conditionId)
    await ctf.prepareCondition(oracle.address, questionId, 6)
    for (let i = 0; i < 6; i++) {
      for (const mask of [1n << BigInt(i), 63n ^ (1n << BigInt(i))]) {
        const collectionId = deriveCollectionId({ conditionId, indexSet: mask })
        expect(await ctf.getCollectionId(ethers.ZeroHash, conditionId, mask)).to.equal(collectionId)
        expect(await ctf.getPositionId(await collateral.getAddress(), collectionId)).to.equal(
          BigInt(derivePositionId({ collateralAddress: await collateral.getAddress(), collectionId })))
      }
    }
    const unit = 1000000n
    await collateral.mint(oracle.address, 2n * unit)
    await collateral.approve(await ctf.getAddress(), 2n * unit)
    await ctf.splitPosition(await collateral.getAddress(), ethers.ZeroHash, conditionId, [4, 59], 2n * unit)
    const token = async mask => ctf.getPositionId(await collateral.getAddress(), await ctf.getCollectionId(ethers.ZeroHash, conditionId, mask))
    expect(await ctf.balanceOf(oracle.address, await token(4))).to.equal(2n * unit)
    expect(await ctf.balanceOf(oracle.address, await token(59))).to.equal(2n * unit)
    // Slot 3 wins: YES(slot 2) loses and its NO complement wins.
    await ctf.reportPayouts(questionId, [0, 0, 0, 1, 0, 0])
    await ctf.redeemPositions(await collateral.getAddress(), ethers.ZeroHash, conditionId, [4, 59])
    expect(await collateral.balanceOf(oracle.address)).to.equal(2n * unit)
    expect(await ctf.balanceOf(oracle.address, await token(4))).to.equal(0)
    expect(await ctf.balanceOf(oracle.address, await token(59))).to.equal(0)
  })
  for (const [market, slots] of [['Bitcoin', 2], ['Premier League', 6], ['Gasoline', 6], ['HDPE', 6]]) {
    it(`${market}: every winner pays exactly the backed YES/NO truth table`, async function () {
      const [oracle, stranger] = await ethers.getSigners()
      const collateral = await ethers.deployContract('MockCollateral')
      const ctf = await ethers.deployContract('ConditionalTokens')
      await Promise.all([collateral.waitForDeployment(), ctf.waitForDeployment()])
      const unit = 1000000n
      await collateral.mint(oracle.address, BigInt(slots * slots) * unit)
      await collateral.approve(await ctf.getAddress(), BigInt(slots * slots) * unit)
      const full = (1n << BigInt(slots)) - 1n
      for (let winner = 0; winner < slots; winner++) {
        const question = ethers.id(`${market}-winner-${winner}`)
        await ctf.prepareCondition(oracle.address, question, slots)
        const condition = await ctf.getConditionId(oracle.address, question, slots)
        // Each complementary pair is split from its own full collateral unit.
        for (let i = 0; i < slots; i++) {
          const yes = 1n << BigInt(i)
          await ctf.splitPosition(await collateral.getAddress(), ethers.ZeroHash, condition, [yes, full ^ yes], unit)
        }
        // Fixture policy only: CTF itself also supports fractional payouts. Production resolution is not implemented.
        const validateEvidence = values => {
          if (values.length !== slots || values.some(v => v !== 0 && v !== 1) || values.reduce((a, b) => a + b, 0) !== 1)
            throw new Error('unsupported or conflicting resolution evidence')
        }
        const payouts = Array.from({ length: slots }, (_, i) => i === winner ? 1 : 0)
        validateEvidence(payouts)
        expect(() => validateEvidence(Array(slots).fill(1))).to.throw('unsupported')
        expect(() => validateEvidence(Array(slots).fill(0))).to.throw('unsupported')
        expect(() => validateEvidence([0.5, 0.5])).to.throw('unsupported')
        await expect(ctf.connect(stranger).reportPayouts(question, payouts)).to.be.reverted
        await ctf.reportPayouts(question, payouts)
        await expect(ctf.reportPayouts(question, payouts)).to.be.reverted
        // Binary claims alias each other: two splits create two units of each canonical token.
        const seen = new Set()
        for (let i = 0; i < slots; i++) {
          for (const mask of [1n << BigInt(i), full ^ (1n << BigInt(i))]) {
            if (seen.has(mask.toString())) continue
            seen.add(mask.toString())
            const before = await collateral.balanceOf(oracle.address)
            const token = await ctf.getPositionId(await collateral.getAddress(), await ctf.getCollectionId(ethers.ZeroHash, condition, mask))
            const quantity = await ctf.balanceOf(oracle.address, token)
            await ctf.redeemPositions(await collateral.getAddress(), ethers.ZeroHash, condition, [mask])
            expect((await collateral.balanceOf(oracle.address)) - before).to.equal((mask & (1n << BigInt(winner))) !== 0n ? quantity : 0n)
            expect(await ctf.balanceOf(oracle.address, token)).to.equal(0)
          }
        }
        expect(await collateral.balanceOf(await ctf.getAddress())).to.equal(0)
      }
    })
  }

})
