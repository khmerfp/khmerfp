const { expect } = require('chai')
const { ethers } = require('hardhat')
const { readFileSync } = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const solc = require('./node_modules/solc')

const upstream = path.resolve(__dirname, '../upstream-v1')
const types = { Order: [
  ['salt', 'uint256'], ['maker', 'address'], ['signer', 'address'], ['taker', 'address'],
  ['tokenId', 'uint256'], ['makerAmount', 'uint256'], ['takerAmount', 'uint256'],
  ['expiration', 'uint256'], ['nonce', 'uint256'], ['feeRateBps', 'uint256'],
  ['side', 'uint8'], ['signatureType', 'uint8'],
].map(([name, type]) => ({ name, type })) }
const UNIT = 1_000_000n
let artifact

describe('Pinned unmodified Polymarket V1 research', function () {
  this.timeout(120000)
  before(function () {
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim())
      .to.equal('ed5c7708b7be3aa98bf5f0c6602b57cc498e2ef4')
    for (const [folder, sha] of [
      ['openzeppelin-contracts', '8769b19860863ed14e82ac78eb0d09449a49290b'],
      ['solady', 'acd959aa4bd04720d640bf4e6a5c71037510cc4b'],
    ]) {
      expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(upstream, 'lib', folder), encoding: 'utf8' }).trim()).to.equal(sha)
    }
    const source = 'src/exchange/CTFExchange.sol'
    const input = { language: 'Solidity', sources: { [source]: { content: readFileSync(path.join(upstream, source), 'utf8') } }, settings: {
      optimizer: { enabled: true, runs: 1000000 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    } }
    const output = JSON.parse(solc.compile(JSON.stringify(input), { import(importPath) {
      const aliases = {
        'common/': 'src/common/',
        'openzeppelin-contracts/': 'lib/openzeppelin-contracts/contracts/',
        'solady/': 'lib/solady/src/', 'solmate/': 'lib/solmate/src/',
      }
      for (const [prefix, replacement] of Object.entries(aliases)) {
        if (importPath.startsWith(prefix)) importPath = replacement + importPath.slice(prefix.length)
      }
      try { return { contents: readFileSync(path.join(upstream, importPath), 'utf8') } }
      catch (error) { return { error: error.message } }
    } }))
    const errors = (output.errors || []).filter(error => error.severity === 'error')
    if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'))
    artifact = output.contracts[source].CTFExchange
    console.log(`V1 runtime bytes: ${artifact.evm.deployedBytecode.object.length / 2}`)
  })

  async function setup(split = true) {
    const [operator, buyer, seller, other] = await ethers.getSigners()
    const collateral = await ethers.deployContract('MockCollateral')
    const ctf = await ethers.deployContract('ConditionalTokens')
    const factory = new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, operator)
    const exchange = await factory.deploy(await collateral.getAddress(), await ctf.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress)
    await exchange.waitForDeployment()
    const question = ethers.id('V1 acceptance binary')
    await ctf.prepareCondition(operator.address, question, 2)
    const condition = await ctf.getConditionId(operator.address, question, 2)
    const tokens = await Promise.all([1, 2].map(async index => ctf.getPositionId(await collateral.getAddress(), await ctf.getCollectionId(ethers.ZeroHash, condition, index))))
    await exchange.registerToken(tokens[0], tokens[1], condition)
    for (const account of [buyer, seller]) {
      await collateral.mint(account.address, 10n * UNIT)
      await collateral.connect(account).approve(await exchange.getAddress(), 10n * UNIT)
      await ctf.connect(account).setApprovalForAll(await exchange.getAddress(), true)
    }
    if (split) {
      await collateral.connect(seller).approve(await ctf.getAddress(), UNIT)
      await ctf.connect(seller).splitPosition(await collateral.getAddress(), ethers.ZeroHash, condition, [1, 2], UNIT)
    }
    return { operator, buyer, seller, other, collateral, ctf, exchange, tokens }
  }

  async function order(ctx, signer, side, tokenId, makerAmount, takerAmount, options = {}) {
    const maker = options.maker || signer.address
    const value = { salt: options.salt || 1, maker, signer: options.maker || signer.address,
      taker: ethers.ZeroAddress, tokenId, makerAmount, takerAmount, expiration: 0,
      nonce: 0, feeRateBps: 0, side, signatureType: options.maker ? 3 : 0 }
    const domain = { name: 'Polymarket CTF Exchange', version: '1', chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await ctx.exchange.getAddress() }
    return { ...value, signature: await signer.signTypedData(domain, types, value) }
  }

  it('crosses 0.65 BUY with 0.60 SELL, refunds surplus and rejects replay', async function () {
    const c = await setup()
    const buy = await order(c, c.buyer, 0, c.tokens[0], 650000n, UNIT)
    const sell = await order(c, c.seller, 1, c.tokens[0], UNIT, 600000n)
    const before = await c.collateral.balanceOf(c.buyer.address)
    const receipt = await (await c.exchange.matchOrders(buy, [sell], 650000n, [UNIT])).wait()
    console.log(`V1 crossed secondary gas: ${receipt.gasUsed}`)
    expect(await c.ctf.balanceOf(c.buyer.address, c.tokens[0])).to.equal(UNIT)
    expect(await c.collateral.balanceOf(c.buyer.address)).to.equal(before - 600000n)
    await expect(c.exchange.matchOrders(buy, [sell], 650000n, [UNIT])).to.be.reverted
  })

  it('supports partial fills and cancellation', async function () {
    const c = await setup()
    const buy = await order(c, c.buyer, 0, c.tokens[0], 600000n, UNIT)
    const sell = await order(c, c.seller, 1, c.tokens[0], UNIT, 600000n)
    await c.exchange.matchOrders(buy, [sell], 300000n, [500000n])
    expect((await c.exchange.getOrderStatus(await c.exchange.hashOrder(buy))).remaining).to.equal(300000n)
    await c.exchange.connect(c.buyer).cancelOrder(buy)
    await expect(c.exchange.matchOrders(buy, [sell], 300000n, [500000n])).to.be.reverted
  })

  it('accepts EIP-1271 smart-wallet signatures', async function () {
    const c = await setup()
    const wallet = await ethers.deployContract('Mock1271Wallet', [c.other.address])
    const address = await wallet.getAddress()
    await c.collateral.mint(address, UNIT)
    await wallet.connect(c.other).execute(await c.collateral.getAddress(), c.collateral.interface.encodeFunctionData('approve', [await c.exchange.getAddress(), 600000n]))
    const buy = await order(c, c.other, 0, c.tokens[0], 600000n, UNIT, { maker: address })
    const sell = await order(c, c.seller, 1, c.tokens[0], UNIT, 600000n)
    await c.exchange.matchOrders(buy, [sell], 600000n, [UNIT])
    expect(await c.ctf.balanceOf(address, c.tokens[0])).to.equal(UNIT)
  })

  it('mints for BUY YES 0.60 plus BUY NO 0.40', async function () {
    const c = await setup(false)
    const yes = await order(c, c.buyer, 0, c.tokens[0], 600000n, UNIT)
    const no = await order(c, c.seller, 0, c.tokens[1], 400000n, UNIT)
    await c.exchange.matchOrders(yes, [no], 600000n, [400000n])
    expect(await c.ctf.balanceOf(c.buyer.address, c.tokens[0])).to.equal(UNIT)
    expect(await c.ctf.balanceOf(c.seller.address, c.tokens[1])).to.equal(UNIT)
    expect(await c.collateral.balanceOf(await c.ctf.getAddress())).to.equal(UNIT)
  })

  it('merges SELL YES plus SELL NO into collateral', async function () {
    const c = await setup()
    await c.ctf.connect(c.seller).safeTransferFrom(c.seller.address, c.buyer.address, c.tokens[0], UNIT, '0x')
    const yes = await order(c, c.buyer, 1, c.tokens[0], UNIT, 600000n)
    const no = await order(c, c.seller, 1, c.tokens[1], UNIT, 400000n)
    const before = await c.collateral.balanceOf(c.buyer.address)
    await c.exchange.matchOrders(yes, [no], UNIT, [UNIT])
    expect(await c.collateral.balanceOf(c.buyer.address)).to.equal(before + 600000n)
    expect(await c.collateral.balanceOf(await c.ctf.getAddress())).to.equal(0)
  })

  it('rejects invalid signatures and rolls back a late transfer failure', async function () {
    const c = await setup()
    const buy = await order(c, c.buyer, 0, c.tokens[0], 600000n, UNIT)
    const sell = await order(c, c.seller, 1, c.tokens[0], UNIT, 600000n)
    const forged = { ...sell, signature: buy.signature }
    await expect(c.exchange.matchOrders(buy, [forged], 600000n, [UNIT])).to.be.reverted
    await c.ctf.connect(c.seller).setApprovalForAll(await c.exchange.getAddress(), false)
    const before = await c.collateral.balanceOf(c.buyer.address)
    await expect(c.exchange.matchOrders(buy, [sell], 600000n, [UNIT])).to.be.reverted
    expect(await c.collateral.balanceOf(c.buyer.address)).to.equal(before)
    expect((await c.exchange.getOrderStatus(await c.exchange.hashOrder(buy))).remaining).to.equal(0)
    expect(await c.collateral.balanceOf(await c.exchange.getAddress())).to.equal(0)
  })

  it('records V1 tiny-fill round-down behavior for adoption review', async function () {
    const c = await setup()
    const buy = await order(c, c.buyer, 0, c.tokens[0], 3n, 3n)
    const sell = await order(c, c.seller, 1, c.tokens[0], 3n, 2n)
    const before = await c.collateral.balanceOf(c.buyer.address)
    await c.exchange.matchOrders(buy, [sell], 1n, [1n])
    expect(await c.ctf.balanceOf(c.buyer.address, c.tokens[0])).to.equal(1n)
    expect(await c.collateral.balanceOf(c.buyer.address)).to.equal(before)
  })
})
