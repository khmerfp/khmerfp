const { expect } = require('chai')
const { evaluatePrices, SOURCE } = require('../scripts/demo-price-policy')

describe('Local five-minute demo price policy', function () {
  const round = { startTime: 1000, tradingCutoff: 1300, resolutionTime: 1315 }
  const opening = { source: SOURCE, sourceTimestamp: 1000, recordedAt: 1001, priceUsd6: '100000000000' }
  const closing = { source: SOURCE, sourceTimestamp: 1300, recordedAt: 1301, priceUsd6: '100001000000' }
  it('uses YES for a rise and NO for a tie or fall', function () {
    expect(evaluatePrices(round, opening, closing, 1315).outcome).to.equal('YES')
    for (const priceUsd6 of ['100000000000', '99999000000']) {
      expect(evaluatePrices(round, opening, { ...closing, priceUsd6 }, 1315).outcome).to.equal('NO')
    }
  })
  it('keeps absent, invalid, late, stale, future or wrong-source evidence pending', function () {
    for (const sample of [null, { ...closing, priceUsd6: '0' }, { ...closing, priceUsd6: 'NaN' },
      { ...closing, priceUsd6: '1.2' }, { ...closing, source: 'unapproved' },
      { ...closing, sourceTimestamp: 1299 }, { ...closing, recordedAt: 1311 },
      { ...closing, recordedAt: 1299 }]) {
      expect(evaluatePrices(round, opening, sample, 1315).status).to.equal('PENDING')
    }
    expect(evaluatePrices(round, null, closing, 1315).status).to.equal('PENDING')
    expect(evaluatePrices(round, opening, closing, 1300).status).to.equal('PENDING')
    expect(evaluatePrices(round, opening, closing, 1314).status).to.equal('PENDING')
    expect(evaluatePrices(null, opening, closing, 1315).status).to.equal('PENDING')
    expect(evaluatePrices({ ...round, tradingCutoff: 1299 }, opening, closing, 1315).status).to.equal('PENDING')
  })
})
