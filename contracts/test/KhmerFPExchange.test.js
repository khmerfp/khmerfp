const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('KhmerFPExchange', function () {
  const YES = 101n
  const NO = 102n
  const ONE = 1_000_000n
  const PRICE = 600_000n

  async function fixture(official = false) {
    const [deployer, buyer, seller, matcher, other] = await ethers.getSigners()
    const collateral = await ethers.deployContract('MockCollateral')
    const ctf = await ethers.deployContract(official ? 'ConditionalTokens' : 'MockConditionalTokens')
    const exchange = await ethers.deployContract('KhmerFPExchange', [
      await collateral.getAddress(),
      await ctf.getAddress(),
    ])
    await Promise.all([
      collateral.waitForDeployment(),
      ctf.waitForDeployment(),
      exchange.waitForDeployment(),
    ])

    await collateral.mint(buyer.address, 10n * ONE)
    let tokens = [YES, NO]
    let conditionId
    if (official) {
      const questionId = ethers.id('local official binary condition')
      await ctf.prepareCondition(deployer.address, questionId, 2)
      conditionId = await ctf.getConditionId(deployer.address, questionId, 2)
      tokens = await Promise.all([1, 2].map(async (indexSet) => {
        const collection = await ctf.getCollectionId(ethers.ZeroHash, conditionId, indexSet)
        return ctf.getPositionId(await collateral.getAddress(), collection)
      }))
      await collateral.mint(seller.address, 10n * ONE)
      await collateral.connect(seller).approve(await ctf.getAddress(), 10n * ONE)
      await ctf.connect(seller).splitPosition(await collateral.getAddress(), ethers.ZeroHash, conditionId, [1, 2], 10n * ONE)
    } else {
      await ctf.mint(seller.address, YES, 10n * ONE)
      await ctf.mint(seller.address, NO, 10n * ONE)
    }
    await collateral.connect(buyer).approve(await exchange.getAddress(), 10n * ONE)
    await ctf.connect(seller).setApprovalForAll(await exchange.getAddress(), true)

    return { deployer, buyer, seller, matcher, other, collateral, ctf, exchange, tokens, conditionId }
  }

  async function domain(exchange, chainId) {
    const network = await ethers.provider.getNetwork()
    return {
      name: 'KhmerFP Exchange',
      version: '1',
      chainId: chainId ?? network.chainId,
      verifyingContract: await exchange.getAddress(),
    }
  }

  const orderTypes = {
    Order: [
      { name: 'maker', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'side', type: 'uint8' },
      { name: 'makerAmount', type: 'uint256' },
      { name: 'takerAmount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiration', type: 'uint256' },
    ],
  }

  async function makeOrders(ctx, options = {}) {
    const timestamp = BigInt((await ethers.provider.getBlock('latest')).timestamp)
    const tokenId = options.tokenId ?? YES
    const buy = {
      maker: options.buyerAddress ?? ctx.buyer.address,
      tokenId,
      side: 0,
      makerAmount: options.buyCollateral ?? PRICE,
      takerAmount: options.buyOutcome ?? ONE,
      nonce: options.buyNonce ?? 1n,
      expiration: options.expiration ?? timestamp + 3600n,
    }
    const sell = {
      maker: options.sellerAddress ?? ctx.seller.address,
      tokenId: options.sellTokenId ?? tokenId,
      side: 1,
      makerAmount: options.sellOutcome ?? ONE,
      takerAmount: options.sellCollateral ?? PRICE,
      nonce: options.sellNonce ?? 2n,
      expiration: options.expiration ?? timestamp + 3600n,
    }
    const signingDomain = await domain(ctx.exchange, options.signingChainId)
    const buySignature = await (options.buySigner ?? ctx.buyer)
      .signTypedData(signingDomain, orderTypes, buy)
    const sellSignature = await (options.sellSigner ?? ctx.seller)
      .signTypedData(signingDomain, orderTypes, sell)
    return { buy, sell, buySignature, sellSignature }
  }

  async function match(ctx, orders, amount = ONE) {
    return ctx.exchange.connect(ctx.matcher).matchOrders(
      orders.buy,
      orders.buySignature,
      orders.sell,
      orders.sellSignature,
      amount,
    )
  }

  it('settles official CTF YES/NO positions and preserves split/merge collateral', async function () {
    const ctx = await fixture(true)
    expect(ctx.tokens[0]).not.to.equal(ctx.tokens[1])
    for (const tokenId of ctx.tokens) {
      const orders = await makeOrders(ctx, { tokenId })
      await ctx.ctf.connect(ctx.seller).setApprovalForAll(await ctx.exchange.getAddress(), false)
      await expect(match(ctx, orders)).to.be.revertedWithCustomError(ctx.exchange, 'MissingOutcomeApproval')
      expect(await ctx.exchange.filledOutcomeAmount(await ctx.exchange.hashOrder(orders.buy))).to.equal(0)
      await ctx.ctf.connect(ctx.seller).setApprovalForAll(await ctx.exchange.getAddress(), true)
      expect(await ctx.exchange.hashOrder(orders.buy)).to.equal(
        ethers.TypedDataEncoder.hash(await domain(ctx.exchange), orderTypes, orders.buy),
      )
      await match(ctx, orders)
      expect(await ctx.ctf.balanceOf(ctx.buyer.address, tokenId)).to.equal(ONE)
    }
    const before = await ctx.collateral.balanceOf(ctx.buyer.address)
    await ctx.ctf.connect(ctx.buyer).mergePositions(await ctx.collateral.getAddress(), ethers.ZeroHash, ctx.conditionId, [1, 2], ONE)
    expect(await ctx.collateral.balanceOf(ctx.buyer.address)).to.equal(before + ONE)
    for (const token of ctx.tokens) expect(await ctx.ctf.balanceOf(ctx.buyer.address, token)).to.equal(0)
  })

  it('checks seeded fill invariants against official CTF across 32 orders', async function () {
    const ctx = await fixture(true)
    let seed = 731n
    for (let i = 0; i < 32; i++) {
      seed = (seed * 1664525n + 1013904223n) % (2n ** 32n)
      const quantity = (seed % 1000n + 2n) * 5n
      const first = ((seed % (quantity / 5n - 1n)) + 1n) * 5n
      const payment = quantity * 3n / 5n
      const orders = await makeOrders(ctx, {
        tokenId: ctx.tokens[i % 2], buyNonce: BigInt(i + 100), sellNonce: BigInt(i + 200),
        buyOutcome: quantity, sellOutcome: quantity, buyCollateral: payment, sellCollateral: payment,
      })
      const buyerBefore = await ctx.collateral.balanceOf(ctx.buyer.address)
      const sellerBefore = await ctx.collateral.balanceOf(ctx.seller.address)
      await match(ctx, orders, first)
      await expect(match(ctx, orders, quantity)).to.be.revertedWithCustomError(ctx.exchange, 'OrderOverfilled')
      await match(ctx, orders, quantity - first)
      for (const order of [orders.buy, orders.sell]) {
        expect(await ctx.exchange.filledOutcomeAmount(await ctx.exchange.hashOrder(order))).to.equal(quantity)
      }
      expect(await ctx.collateral.balanceOf(ctx.buyer.address)).to.equal(buyerBefore - payment)
      expect(await ctx.collateral.balanceOf(ctx.seller.address)).to.equal(sellerBefore + payment)
      await expect(match(ctx, orders, 5n)).to.be.revertedWithCustomError(ctx.exchange, 'OrderOverfilled')
    }
  })

  it('settles a YES trade and emits exact trade data', async function () {
    const ctx = await fixture()
    const orders = await makeOrders(ctx)
    const buyHash = await ctx.exchange.hashOrder(orders.buy)
    const sellHash = await ctx.exchange.hashOrder(orders.sell)

    await expect(match(ctx, orders))
      .to.emit(ctx.exchange, 'TradeExecuted')
      .withArgs(
        buyHash,
        sellHash,
        YES,
        ctx.buyer.address,
        ctx.seller.address,
        ONE,
        PRICE,
      )
    expect(await ctx.ctf.balanceOf(ctx.buyer.address, YES)).to.equal(ONE)
    expect(await ctx.collateral.balanceOf(ctx.seller.address)).to.equal(PRICE)
  })

  it('settles a NO trade', async function () {
    const ctx = await fixture()
    const orders = await makeOrders(ctx, { tokenId: NO })
    await match(ctx, orders)
    expect(await ctx.ctf.balanceOf(ctx.buyer.address, NO)).to.equal(ONE)
  })

  it('supports partial and multiple fills without overfilling', async function () {
    const ctx = await fixture()
    const orders = await makeOrders(ctx)
    await match(ctx, orders, 400_000n)
    await match(ctx, orders, 600_000n)
    expect(await ctx.exchange.filledOutcomeAmount(await ctx.exchange.hashOrder(orders.buy)))
      .to.equal(ONE)
    await expect(match(ctx, orders, 1n)).to.be.revertedWithCustomError(
      ctx.exchange,
      'InvalidFillAmount',
    )
    await expect(match(ctx, orders, ethers.MaxUint256)).to.be.revertedWithCustomError(
      ctx.exchange,
      'OrderOverfilled',
    )
  })

  it('rejects cancelled orders', async function () {
    const ctx = await fixture()
    const orders = await makeOrders(ctx)
    await expect(ctx.exchange.connect(ctx.other).cancelOrder(orders.buy))
      .to.be.revertedWithCustomError(ctx.exchange, 'UnauthorizedCancellation')
    await expect(ctx.exchange.connect(ctx.buyer).cancelOrder(orders.buy))
      .to.emit(ctx.exchange, 'OrderCancelled')
    await expect(match(ctx, orders)).to.be.revertedWithCustomError(
      ctx.exchange,
      'OrderIsCancelled',
    )
  })

  it('rejects expired, invalid, and wrong-domain signatures', async function () {
    const ctx = await fixture()
    const now = BigInt((await ethers.provider.getBlock('latest')).timestamp)
    const expired = await makeOrders(ctx, { expiration: now - 1n })
    await expect(match(ctx, expired)).to.be.revertedWithCustomError(ctx.exchange, 'OrderExpired')

    const invalid = await makeOrders(ctx, { buySigner: ctx.other })
    await expect(match(ctx, invalid)).to.be.revertedWithCustomError(ctx.exchange, 'InvalidSignature')

    const network = await ethers.provider.getNetwork()
    const wrongDomain = await makeOrders(ctx, { signingChainId: network.chainId + 1n })
    await expect(match(ctx, wrongDomain)).to.be.revertedWithCustomError(ctx.exchange, 'InvalidSignature')
  })

  it('rejects replay after a complete fill', async function () {
    const ctx = await fixture()
    const orders = await makeOrders(ctx)
    await match(ctx, orders)
    await expect(match(ctx, orders)).to.be.revertedWithCustomError(ctx.exchange, 'OrderOverfilled')
  })

  it('rejects different prices and token IDs', async function () {
    const ctx = await fixture()
    const wrongPrice = await makeOrders(ctx, { sellCollateral: 700_000n })
    await expect(match(ctx, wrongPrice)).to.be.revertedWithCustomError(
      ctx.exchange,
      'OrdersNotCompatible',
    )

    const wrongToken = await makeOrders(ctx, { sellTokenId: NO })
    await expect(match(ctx, wrongToken)).to.be.revertedWithCustomError(
      ctx.exchange,
      'OrdersNotCompatible',
    )
  })

  it('rejects insufficient balances and missing bounded permissions', async function () {
    const ctx = await fixture()
    const orders = await makeOrders(ctx)

    await ctx.collateral.connect(ctx.buyer).transfer(ctx.other.address, 10n * ONE)
    await expect(match(ctx, orders)).to.be.revertedWithCustomError(
      ctx.exchange,
      'InsufficientCollateral',
    )
    await ctx.collateral.mint(ctx.buyer.address, 10n * ONE)
    await ctx.collateral.connect(ctx.buyer).approve(await ctx.exchange.getAddress(), 0)
    await expect(match(ctx, orders)).to.be.revertedWithCustomError(
      ctx.exchange,
      'MissingCollateralAllowance',
    )
    await ctx.collateral.connect(ctx.buyer).approve(await ctx.exchange.getAddress(), 10n * ONE)
    await ctx.ctf.connect(ctx.seller).setApprovalForAll(await ctx.exchange.getAddress(), false)
    await expect(match(ctx, orders)).to.be.revertedWithCustomError(
      ctx.exchange,
      'MissingOutcomeApproval',
    )
  })

  it('rejects insufficient outcome tokens', async function () {
    const ctx = await fixture()
    const orders = await makeOrders(ctx, { sellOutcome: 20n * ONE, buyOutcome: 20n * ONE })
    await expect(match(ctx, orders, 20n * ONE)).to.be.revertedWithCustomError(
      ctx.exchange,
      'InsufficientOutcomeTokens',
    )
  })

  it('rolls back collateral, fills, and events when CTF transfer fails', async function () {
    const ctx = await fixture()
    const orders = await makeOrders(ctx)
    const buyHash = await ctx.exchange.hashOrder(orders.buy)
    const buyerBefore = await ctx.collateral.balanceOf(ctx.buyer.address)
    await ctx.ctf.setTransfersBlocked(true)

    await expect(match(ctx, orders)).to.be.revertedWithCustomError(ctx.ctf, 'TransfersBlocked')
    expect(await ctx.collateral.balanceOf(ctx.buyer.address)).to.equal(buyerBefore)
    expect(await ctx.collateral.balanceOf(ctx.seller.address)).to.equal(0)
    expect(await ctx.exchange.filledOutcomeAmount(buyHash)).to.equal(0)
  })

  it('supports EIP-1271 smart-wallet order signatures', async function () {
    const ctx = await fixture()
    const smartWallet = await ethers.deployContract('Mock1271Wallet', [ctx.other.address])
    await smartWallet.waitForDeployment()
    await ctx.collateral.mint(await smartWallet.getAddress(), ONE)
    const approveData = ctx.collateral.interface.encodeFunctionData('approve', [
      await ctx.exchange.getAddress(),
      PRICE,
    ])
    await smartWallet.connect(ctx.other).execute(await ctx.collateral.getAddress(), approveData)

    const orders = await makeOrders(ctx, {
      buyerAddress: await smartWallet.getAddress(),
      buySigner: ctx.other,
      buyNonce: 44n,
    })
    await match(ctx, orders)
    expect(await ctx.ctf.balanceOf(await smartWallet.getAddress(), YES)).to.equal(ONE)
  })
})
