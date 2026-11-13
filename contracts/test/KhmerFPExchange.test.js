const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('KhmerFPExchange', function () {
  const YES = 101n
  const NO = 102n
  const ONE = 1_000_000n
  const PRICE = 600_000n

  async function fixture(official = false, collateralContract = 'MockCollateral') {
    const [deployer, buyer, seller, matcher, other] = await ethers.getSigners()
    const collateral = await ethers.deployContract(collateralContract)
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
    let conditionId = ethers.id('mock binary condition')
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
    await exchange.grantRole(await exchange.OPERATOR_ROLE(), matcher.address)
    await exchange.registerMarket(conditionId, tokens[0], tokens[1])

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

  async function match(ctx, orders, amount = ONE, payment = amount * orders.buy.makerAmount / orders.buy.takerAmount) {
    return ctx.exchange.connect(ctx.matcher).matchOrders(
      orders.buy,
      orders.buySignature,
      orders.sell,
      orders.sellSignature,
      amount,
      payment,
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

  it('requires operator access and blocks revoked operators', async function () {
    const c = await fixture()
    const o = await makeOrders(c)
    const args = [o.buy, o.buySignature, o.sell, o.sellSignature, ONE, PRICE]
    const role = await c.exchange.OPERATOR_ROLE()
    await expect(c.exchange.connect(c.other).matchOrders(...args))
      .to.be.revertedWithCustomError(c.exchange, 'AccessControlUnauthorizedAccount')
      .withArgs(c.other.address, role)
    await c.exchange.revokeRole(role, c.matcher.address)
    await expect(match(c, o)).to.be.revertedWithCustomError(c.exchange, 'AccessControlUnauthorizedAccount')
    await c.exchange.grantRole(role, c.matcher.address)
    await match(c, o)
  })

  it('does not let an approved operator alter signed prices', async function () {
    const c = await fixture()
    const o = await makeOrders(c)
    await expect(match(c, { ...o, buy: { ...o.buy, makerAmount: 900000n } }))
      .to.be.revertedWithCustomError(c.exchange, 'InvalidSignature')
  })

  it('allows an emergency guardian to pause but only admin to unpause', async function () {
    const c = await fixture()
    const role = await c.exchange.EMERGENCY_ROLE()
    await c.exchange.grantRole(role, c.other.address)
    await c.exchange.connect(c.other).pause()
    const o = await makeOrders(c)
    await expect(match(c, o)).to.be.revertedWithCustomError(c.exchange, 'EnforcedPause')
    await expect(c.exchange.connect(c.other).unpause()).to.be.revertedWithCustomError(c.exchange, 'AccessControlUnauthorizedAccount')
    await c.exchange.unpause()
    await match(c, o)
    await c.exchange.revokeRole(role, c.other.address)
    await expect(c.exchange.connect(c.other).pause()).to.be.revertedWithCustomError(c.exchange, 'AccessControlUnauthorizedAccount')
  })

  it('preserves cancellation and balances while paused', async function () {
    const c = await fixture()
    const o = await makeOrders(c)
    const before = await c.collateral.balanceOf(c.buyer.address)
    await c.exchange.pause()
    await expect(c.exchange.connect(c.buyer).cancelOrder(o.buy)).to.emit(c.exchange, 'OrderCancelled')
    await expect(match(c, o)).to.be.revertedWithCustomError(c.exchange, 'EnforcedPause')
    expect(await c.collateral.balanceOf(c.buyer.address)).to.equal(before)
    await c.exchange.unpause()
    await expect(match(c, o)).to.be.revertedWithCustomError(c.exchange, 'OrderIsCancelled')
  })

  it('prevents operator and guardian privilege escalation or registry misuse', async function () {
    const c = await fixture(true)
    const adminRole = await c.exchange.DEFAULT_ADMIN_ROLE()
    for (const signer of [c.matcher, c.other]) {
      await expect(c.exchange.connect(signer).pause()).to.be.revertedWithCustomError(c.exchange, 'AccessControlUnauthorizedAccount')
      await expect(c.exchange.connect(signer).grantRole(await c.exchange.OPERATOR_ROLE(), signer.address))
        .to.be.revertedWithCustomError(c.exchange, 'AccessControlUnauthorizedAccount').withArgs(signer.address, adminRole)
      await expect(c.exchange.connect(signer).registerMarket(c.conditionId, ...c.tokens))
        .to.be.revertedWithCustomError(c.exchange, 'AccessControlUnauthorizedAccount')
      await expect(c.exchange.connect(signer).setMarketEnabled(c.conditionId, false))
        .to.be.revertedWithCustomError(c.exchange, 'AccessControlUnauthorizedAccount')
      await expect(c.exchange.connect(signer).unpause()).to.be.revertedWithCustomError(c.exchange, 'AccessControlUnauthorizedAccount')
    }
    await expect(c.exchange.grantRole(adminRole, c.other.address)).to.be.revertedWithCustomError(c.exchange, 'AccessControlEnforcedDefaultAdminRules')
    await c.exchange.beginDefaultAdminTransfer(c.other.address)
    await expect(c.exchange.connect(c.other).acceptDefaultAdminTransfer()).to.be.revertedWithCustomError(c.exchange, 'AccessControlEnforcedDefaultAdminDelay')
  })

  it('transfers admin only after the delay and keeps guardian roles separate', async function () {
    const c = await fixture()
    await c.exchange.beginDefaultAdminTransfer(c.other.address)
    await ethers.provider.send('evm_increaseTime', [86401])
    await ethers.provider.send('evm_mine', [])
    await c.exchange.connect(c.other).acceptDefaultAdminTransfer()
    expect(await c.exchange.defaultAdmin()).to.equal(c.other.address)
    await expect(c.exchange.unpause()).to.be.revertedWithCustomError(c.exchange, 'AccessControlUnauthorizedAccount')
    await c.exchange.connect(c.other).revokeRole(await c.exchange.EMERGENCY_ROLE(), c.deployer.address)
    await expect(c.exchange.pause()).to.be.revertedWithCustomError(c.exchange, 'AccessControlUnauthorizedAccount')
    await c.exchange.connect(c.other).grantRole(await c.exchange.EMERGENCY_ROLE(), c.other.address)
    await c.exchange.connect(c.other).pause()
    await c.exchange.connect(c.other).unpause()
  })

  it('validates registered binary token identities using official CTF', async function () {
    const c = await fixture(true)
    const q = ethers.id('second binary governance test')
    await c.ctf.prepareCondition(c.deployer.address, q, 2)
    const condition = await c.ctf.getConditionId(c.deployer.address, q, 2)
    const tokens = await Promise.all([1, 2].map(async index => c.ctf.getPositionId(await c.collateral.getAddress(), await c.ctf.getCollectionId(ethers.ZeroHash, condition, index))))
    for (const pair of [[tokens[1], tokens[0]], [tokens[0], tokens[0]], [0n, tokens[1]], [tokens[0] + 1n, tokens[1]], c.tokens]) {
      await expect(c.exchange.registerMarket(condition, ...pair)).to.be.revertedWithCustomError(c.exchange, 'InvalidMarket')
    }
    const wrongCollateral = await ethers.deployContract('MockCollateral')
    const collection = await c.ctf.getCollectionId(ethers.ZeroHash, condition, 1)
    const wrongYes = await c.ctf.getPositionId(await wrongCollateral.getAddress(), collection)
    await expect(c.exchange.registerMarket(condition, wrongYes, tokens[1])).to.be.revertedWithCustomError(c.exchange, 'InvalidMarket')
    await expect(c.exchange.registerMarket(ethers.id('unprepared condition'), ...tokens)).to.be.revertedWithCustomError(c.exchange, 'InvalidMarket')
    await expect(c.exchange.registerMarket(ethers.ZeroHash, ...tokens)).to.be.revertedWithCustomError(c.exchange, 'InvalidMarket')
    await expect(c.exchange.registerMarket(condition, ...tokens)).to.emit(c.exchange, 'MarketRegistered').withArgs(condition, ...tokens)
    await expect(c.exchange.registerMarket(condition, ...tokens)).to.be.revertedWithCustomError(c.exchange, 'MarketAlreadyRegistered')
  })

  it('rejects prepared categorical conditions and nested token identities', async function () {
    const c = await fixture(true)
    const q = ethers.id('categorical governance test')
    await c.ctf.prepareCondition(c.deployer.address, q, 3)
    const condition = await c.ctf.getConditionId(c.deployer.address, q, 3)
    await expect(c.exchange.registerMarket(condition, ...c.tokens)).to.be.revertedWithCustomError(c.exchange, 'InvalidMarket')
    const nestedCollection = await c.ctf.getCollectionId(await c.ctf.getCollectionId(ethers.ZeroHash, c.conditionId, 1), c.conditionId, 2)
    const nested = await c.ctf.getPositionId(await c.collateral.getAddress(), nestedCollection)
    const q2 = ethers.id('nested candidate')
    await c.ctf.prepareCondition(c.deployer.address, q2, 2)
    const condition2 = await c.ctf.getConditionId(c.deployer.address, q2, 2)
    await expect(c.exchange.registerMarket(condition2, nested, c.tokens[1])).to.be.revertedWithCustomError(c.exchange, 'InvalidMarket')
  })

  it('blocks unregistered tokens and disabled markets without losing fill accounting', async function () {
    const c = await fixture(true)
    const q = ethers.id('unregistered binary')
    await c.ctf.prepareCondition(c.deployer.address, q, 2)
    const condition = await c.ctf.getConditionId(c.deployer.address, q, 2)
    const token = await c.ctf.getPositionId(await c.collateral.getAddress(), await c.ctf.getCollectionId(ethers.ZeroHash, condition, 1))
    await expect(match(c, await makeOrders(c, { tokenId: token }))).to.be.revertedWithCustomError(c.exchange, 'MarketNotEnabled')
    const o = await makeOrders(c, { tokenId: c.tokens[0] })
    await match(c, o, 500000n, 300000n)
    await expect(c.exchange.setMarketEnabled(c.conditionId, false)).to.emit(c.exchange, 'MarketStatusChanged').withArgs(c.conditionId, false)
    await expect(match(c, o, 500000n, 300000n)).to.be.revertedWithCustomError(c.exchange, 'MarketNotEnabled')
    expect(await c.exchange.filledCollateralAmount(await c.exchange.hashOrder(o.buy))).to.equal(300000n)
    await c.exchange.setMarketEnabled(c.conditionId, true)
    await match(c, o, 500000n, 300000n)
    expect(await c.exchange.filledCollateralAmount(await c.exchange.hashOrder(o.buy))).to.equal(PRICE)
    await expect(c.exchange.setMarketEnabled(condition, false)).to.be.revertedWithCustomError(c.exchange, 'InvalidMarket')
  })

  it('rejects ERC20 success without payment and fee deductions atomically', async function () {
    const c = await fixture(false, 'AdversarialCollateral')
    const orders = await makeOrders(c)
    for (const mode of [1, 4]) {
      await c.collateral.configure(mode, ethers.ZeroAddress, '0x')
      await expect(match(c, orders)).to.be.revertedWithCustomError(c.exchange, 'UnexpectedCollateralTransfer')
      expect(await c.collateral.balanceOf(c.buyer.address)).to.equal(10n * ONE)
      expect(await c.collateral.balanceOf(c.seller.address)).to.equal(0)
      expect(await c.ctf.balanceOf(c.buyer.address, YES)).to.equal(0)
      for (const order of [orders.buy, orders.sell]) {
        const hash = await c.exchange.hashOrder(order)
        expect(await c.exchange.filledOutcomeAmount(hash)).to.equal(0)
        expect(await c.exchange.filledCollateralAmount(hash)).to.equal(0)
      }
    }
  })

  it('rejects false-returning and reverting ERC20 transfers without recording fills', async function () {
    const c = await fixture(false, 'AdversarialCollateral')
    const orders = await makeOrders(c)
    for (const mode of [2, 3]) {
      await c.collateral.configure(mode, ethers.ZeroAddress, '0x')
      await expect(match(c, orders)).to.be.reverted
      expect(await c.exchange.filledOutcomeAmount(await c.exchange.hashOrder(orders.buy))).to.equal(0)
      expect(await c.exchange.filledCollateralAmount(await c.exchange.hashOrder(orders.sell))).to.equal(0)
    }
    await c.collateral.configure(0, ethers.ZeroAddress, '0x')
    await match(c, orders)
  })

  it('blocks ERC20 reentrancy while allowing the outer signed trade', async function () {
    const c = await fixture(false, 'AdversarialCollateral')
    const o = await makeOrders(c)
    const payload = c.exchange.interface.encodeFunctionData('matchOrders', [o.buy, o.buySignature, o.sell, o.sellSignature, ONE, PRICE])
    await c.collateral.configure(5, await c.exchange.getAddress(), payload)
    await match(c, o)
    expect(await c.collateral.callbackSucceeded()).to.equal(false)
    expect(await c.collateral.callbackError()).to.equal(ethers.id('ReentrancyGuardReentrantCall()').slice(0, 10))
    expect(await c.ctf.balanceOf(c.buyer.address, YES)).to.equal(ONE)
    expect(await c.exchange.filledCollateralAmount(await c.exchange.hashOrder(o.buy))).to.equal(PRICE)
  })

  async function walletFixture() {
    const c = await fixture(true)
    const wallet = await ethers.deployContract('AdversarialWallet', [c.other.address])
    const address = await wallet.getAddress()
    await c.collateral.mint(address, ONE)
    await wallet.connect(c.other).execute(await c.collateral.getAddress(), c.collateral.interface.encodeFunctionData('approve', [await c.exchange.getAddress(), PRICE]))
    const o = await makeOrders(c, { tokenId: c.tokens[0], buyerAddress: address, buySigner: c.other })
    return { c, wallet, address, o }
  }

  it('blocks reentrant settlement from an official CTF receiver callback', async function () {
    const { c, wallet, address, o } = await walletFixture()
    const payload = c.exchange.interface.encodeFunctionData('matchOrders', [o.buy, o.buySignature, o.sell, o.sellSignature, ONE, PRICE])
    await wallet.connect(c.other).configure(true, false, await c.exchange.getAddress(), payload)
    await match(c, o)
    expect(await wallet.callbackSucceeded()).to.equal(false)
    expect(await wallet.callbackError()).to.equal(ethers.id('ReentrancyGuardReentrantCall()').slice(0, 10))
    expect(await c.ctf.balanceOf(address, c.tokens[0])).to.equal(ONE)
    await expect(match(c, o)).to.be.revertedWithCustomError(c.exchange, 'OrderOverfilled')
  })

  it('rolls back official CTF settlement when a receiver rejects delivery', async function () {
    const { c, wallet, address, o } = await walletFixture()
    await wallet.connect(c.other).configure(true, true, ethers.ZeroAddress, '0x')
    await expect(match(c, o)).to.be.reverted
    expect(await c.collateral.balanceOf(address)).to.equal(ONE)
    expect(await c.collateral.allowance(address, await c.exchange.getAddress())).to.equal(PRICE)
    expect(await c.ctf.balanceOf(address, c.tokens[0])).to.equal(0)
    for (const order of [o.buy, o.sell]) {
      expect(await c.exchange.filledCollateralAmount(await c.exchange.hashOrder(order))).to.equal(0)
      expect(await c.exchange.filledOutcomeAmount(await c.exchange.hashOrder(order))).to.equal(0)
    }
    await wallet.connect(c.other).configure(true, false, ethers.ZeroAddress, '0x')
    await match(c, o)
  })

  it('rechecks EIP-1271 validity for every partial settlement', async function () {
    const { c, wallet, o } = await walletFixture()
    await match(c, o, 500000n, 300000n)
    await wallet.connect(c.other).configure(false, false, ethers.ZeroAddress, '0x')
    await expect(match(c, o, 500000n, 300000n)).to.be.revertedWithCustomError(c.exchange, 'InvalidSignature')
    expect(await c.exchange.filledCollateralAmount(await c.exchange.hashOrder(o.buy))).to.equal(300000n)
    await wallet.connect(c.other).configure(true, false, ethers.ZeroAddress, '0x')
    await match(c, o, 500000n, 300000n)
  })

  it('rejects signed self trades without consuming an allowance', async function () {
    const c = await fixture()
    const o = await makeOrders(c, { sellerAddress: c.buyer.address, sellSigner: c.buyer })
    await expect(match(c, o)).to.be.revertedWithCustomError(c.exchange, 'OrdersNotCompatible')
    expect(await c.collateral.allowance(c.buyer.address, await c.exchange.getAddress())).to.equal(10n * ONE)
  })

  it('preserves signed spending and receipt bounds over 64 changing-price sequences', async function () {
    const c = await fixture(true)
    let seed = 20261113n
    for (let i = 0; i < 64; i++) {
      seed = (seed * 1664525n + 1013904223n) % (1n << 32n)
      const lots = seed % 100n + 2n
      const quantity = lots * 20n
      const first = (seed % (lots - 1n) + 1n) * 20n
      const o = await makeOrders(c, { tokenId: c.tokens[i % 2], buyOutcome: quantity, sellOutcome: quantity,
        buyCollateral: quantity * 13n / 20n, sellCollateral: quantity * 12n / 20n,
        buyNonce: BigInt(1000 + i), sellNonce: BigInt(2000 + i) })
      const beforeBuyer = await c.collateral.balanceOf(c.buyer.address)
      const beforeSeller = await c.collateral.balanceOf(c.seller.address)
      let paid = 0n
      let filled = 0n
      for (const [q, numerator] of [[first, 12n], [quantity - first, 13n]]) {
        const p = q * numerator / 20n
        await expect(match(c, o, q, 0n)).to.be.revertedWithCustomError(c.exchange, 'InvalidFillAmount')
        await expect(match(c, o, q, q * 13n / 20n + 1n)).to.be.revertedWithCustomError(c.exchange, 'OrdersNotCompatible')
        await expect(match(c, o, q, q * 12n / 20n - 1n)).to.be.revertedWithCustomError(c.exchange, 'OrdersNotCompatible')
        await match(c, o, q, p)
        paid += p
        filled += q
        expect(paid * o.buy.takerAmount <= filled * o.buy.makerAmount).to.equal(true)
        expect(paid * o.sell.makerAmount >= filled * o.sell.takerAmount).to.equal(true)
        expect(paid <= o.buy.makerAmount).to.equal(true)
        for (const order of [o.buy, o.sell]) {
          expect(await c.exchange.filledOutcomeAmount(await c.exchange.hashOrder(order))).to.equal(filled)
          expect(await c.exchange.filledCollateralAmount(await c.exchange.hashOrder(order))).to.equal(paid)
        }
      }
      expect(await c.collateral.balanceOf(c.buyer.address)).to.equal(beforeBuyer - paid)
      expect(await c.collateral.balanceOf(c.seller.address)).to.equal(beforeSeller + paid)
      await expect(match(c, o, 20n, 12n)).to.be.revertedWithCustomError(c.exchange, 'OrderOverfilled')
    }
  })

  it('settles a 0.65 bid against a 0.60 ask at an explicit 0.62 price', async function () {
    const ctx = await fixture(true)
    const orders = await makeOrders(ctx, { tokenId: ctx.tokens[0], buyCollateral: 650_000n })
    await match(ctx, orders, ONE, 620_000n)
    expect(await ctx.exchange.filledCollateralAmount(await ctx.exchange.hashOrder(orders.buy))).to.equal(620_000n)
    expect(await ctx.collateral.balanceOf(ctx.seller.address)).to.equal(620_000n)
    expect(await ctx.ctf.balanceOf(ctx.buyer.address, ctx.tokens[0])).to.equal(ONE)
  })

  it('rejects non-crossing orders and execution outside either signed limit', async function () {
    const ctx = await fixture()
    const nonCrossing = await makeOrders(ctx, { buyCollateral: 550_000n })
    await expect(match(ctx, nonCrossing, ONE, 575_000n)).to.be.revertedWithCustomError(ctx.exchange, 'OrdersNotCompatible')
    const orders = await makeOrders(ctx, { buyCollateral: 650_000n })
    for (const payment of [650_001n, 599_999n]) {
      await expect(match(ctx, orders, ONE, payment)).to.be.revertedWithCustomError(ctx.exchange, 'OrdersNotCompatible')
    }
  })

  it('conserves payments across partial fills at different crossed prices', async function () {
    const ctx = await fixture()
    const orders = await makeOrders(ctx, { buyCollateral: 650_000n })
    const buyerBefore = await ctx.collateral.balanceOf(ctx.buyer.address)
    await match(ctx, orders, 400_000n, 240_000n)
    await match(ctx, orders, 600_000n, 390_000n)
    expect(await ctx.collateral.balanceOf(ctx.buyer.address)).to.equal(buyerBefore - 630_000n)
    expect(await ctx.collateral.balanceOf(ctx.seller.address)).to.equal(630_000n)
    for (const order of [orders.buy, orders.sell]) {
      expect(await ctx.exchange.filledOutcomeAmount(await ctx.exchange.hashOrder(order))).to.equal(ONE)
      expect(await ctx.exchange.filledCollateralAmount(await ctx.exchange.hashOrder(order))).to.equal(630_000n)
    }
    await expect(match(ctx, orders, 5n, 3n)).to.be.revertedWithCustomError(ctx.exchange, 'OrderOverfilled')
  })

  it('rejects rounding outside limits and leaves no hidden final-fill dust', async function () {
    const ctx = await fixture()
    const orders = await makeOrders(ctx, {
      buyCollateral: 2n, buyOutcome: 3n, sellCollateral: 1n, sellOutcome: 3n,
    })
    // no positive integer payment fits a one-unit fill between 1/3 and 2/3.
    await expect(match(ctx, orders, 1n, 1n)).to.be.revertedWithCustomError(ctx.exchange, 'OrdersNotCompatible')
    await expect(match(ctx, orders, 1n, 0n)).to.be.revertedWithCustomError(ctx.exchange, 'InvalidFillAmount')
    await match(ctx, orders, 3n, 2n)
    expect(await ctx.exchange.filledCollateralAmount(await ctx.exchange.hashOrder(orders.buy))).to.equal(2n)
    const exact = await makeOrders(ctx, {
      buyCollateral: 2n, buyOutcome: 3n, sellCollateral: 2n, sellOutcome: 3n,
      buyNonce: 30n, sellNonce: 31n,
    })
    await expect(match(ctx, exact, 2n, 1n)).to.be.revertedWithCustomError(ctx.exchange, 'OrdersNotCompatible')
    await match(ctx, exact, 3n, 2n)
  })

  it('rolls back crossed-price payment and both counters on transfer failure', async function () {
    const ctx = await fixture()
    const orders = await makeOrders(ctx, { buyCollateral: 650_000n })
    await ctx.ctf.setTransfersBlocked(true)
    await expect(match(ctx, orders, ONE, 620_000n)).to.be.revertedWithCustomError(ctx.ctf, 'TransfersBlocked')
    expect(await ctx.collateral.balanceOf(ctx.buyer.address)).to.equal(10n * ONE)
    expect(await ctx.collateral.balanceOf(ctx.seller.address)).to.equal(0)
    for (const order of [orders.buy, orders.sell]) {
      expect(await ctx.exchange.filledOutcomeAmount(await ctx.exchange.hashOrder(order))).to.equal(0)
      expect(await ctx.exchange.filledCollateralAmount(await ctx.exchange.hashOrder(order))).to.equal(0)
    }
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
