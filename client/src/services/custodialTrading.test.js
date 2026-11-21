import { describe, it, expect } from 'vitest';
import { exactDecimal, shares, orderTerms } from './custodialTrading.js';
describe('custodial exact financial boundary', () => {
  it('formats large integer cents without Number precision loss', () => expect(exactDecimal('9007199254740993')).toBe('90071992547409.93'));
  it('keeps missing balances unavailable', () => expect(exactDecimal(null)).toBe('Unavailable'));
  it('formats negative integer values exactly', () => expect(exactDecimal('-101')).toBe('-1.01'));
  it('converts whole shares to exact token base units', () => expect(orderTerms({
    marketId: 'm',
    tokenId: 't',
    side: 'BUY',
    quantity: '1000000001',
    priceCents: '65',
    orderType: 'LIMIT'
  }).quantity).toBe('1000000001000000'));
  it('rejects fractional quantities', () => expect(() => orderTerms({
    quantity: '1.5',
    priceCents: '60'
  })).toThrow());
  it('rejects prices outside signed protection', () => expect(() => orderTerms({
    quantity: '1',
    priceCents: '100'
  })).toThrow());
  it('requires explicit market BUY spending cap', () => expect(() => orderTerms({
    quantity: '1',
    priceCents: '60',
    orderType: 'MARKET',
    side: 'BUY'
  })).toThrow());
  it('preserves exact cap and canonical selection', () => expect(orderTerms({
    marketId: 'm',
    tokenId: '17',
    side: 'BUY',
    quantity: '2',
    priceCents: '65',
    maxSpendCents: '120',
    orderType: 'MARKET'
  })).toEqual({
    marketId: 'm',
    tokenId: '17',
    side: 'BUY',
    quantity: '2000000',
    priceCents: '65',
    maxSpendCents: '120',
    orderType: 'MARKET'
  }));
  it('does not invent positions', () => expect(shares(null)).toBe('Unavailable'));
});
