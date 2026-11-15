const { ethers, network, artifacts } = require('hardhat')
const { writeFile, mkdir, rename } = require('node:fs/promises')
const path = require('node:path')
const { SOURCE } = require('./demo-price-policy')

async function setupDemo() {
  const chain = await ethers.provider.getNetwork()
  const client = await ethers.provider.send('web3_clientVersion', [])
  if (network.name !== 'localhost' || network.config.url !== 'http://127.0.0.1:8545'
    || chain.chainId !== 31337n || !/^HardhatNetwork\//.test(client)) {
    throw new Error('demo setup requires the dedicated localhost Hardhat chain 31337')
  }
  const metadata = await ethers.provider.send('hardhat_metadata', [])
  if (metadata.forkedNetwork) throw new Error('forked chains are not supported by this demo')
  // reset only the verified disposable loopback chain; every run replaces the demo.
  await ethers.provider.send('hardhat_reset', [])
  // a reset must create a fresh round even if the node has been running for hours.
  const resetBlock = await ethers.provider.getBlock('latest')
  await ethers.provider.send('evm_setNextBlockTimestamp', [Math.max(Math.floor(Date.now() / 1000), resetBlock.timestamp + 1)])
  await ethers.provider.send('evm_mine', [])
  const [admin, guardian, operator, buyer, seller] = await ethers.getSigners()
  const collateral = await ethers.deployContract('MockCollateral')
  const ctf = await ethers.deployContract('ConditionalTokens')
  await collateral.waitForDeployment()
  await ctf.waitForDeployment()
  const exchange = await ethers.deployContract('KhmerFPExchange', [await collateral.getAddress(), await ctf.getAddress()])
  await exchange.waitForDeployment()
  await (await exchange.grantRole(await exchange.EMERGENCY_ROLE(), guardian.address)).wait()
  await (await exchange.revokeRole(await exchange.EMERGENCY_ROLE(), admin.address)).wait()
  await (await exchange.grantRole(await exchange.OPERATOR_ROLE(), operator.address)).wait()

  const startTime = (await ethers.provider.getBlock('latest')).timestamp
  const tradingCutoff = startTime + 300
  const resolutionTime = tradingCutoff + 15
  const roundId = `BTC-USD-5M-${startTime}`
  const questionId = ethers.id(`${roundId}:close>open;tie=NO;source=${SOURCE}`)
  await (await ctf.prepareCondition(admin.address, questionId, 2)).wait()
  const conditionId = await ctf.getConditionId(admin.address, questionId, 2)
  const tokens = await Promise.all([1, 2].map(async indexSet => {
    const collectionId = await ctf.getCollectionId(ethers.ZeroHash, conditionId, indexSet)
    const tokenId = await ctf.getPositionId(await collateral.getAddress(), collectionId)
    return { label: indexSet === 1 ? 'YES' : 'NO', outcomeIndex: indexSet - 1, indexSet, collectionId, tokenId: tokenId.toString() }
  }))
  await (await exchange.registerMarket(conditionId, tokens[0].tokenId, tokens[1].tokenId, tradingCutoff)).wait()
  const unit = 1_000_000n
  for (const trader of [buyer, seller]) await (await collateral.mint(trader.address, 100n * unit)).wait()
  await (await collateral.connect(seller).approve(await ctf.getAddress(), 20n * unit)).wait()
  await (await ctf.connect(seller).splitPosition(await collateral.getAddress(), ethers.ZeroHash, conditionId, [1, 2], 20n * unit)).wait()
  await (await collateral.connect(buyer).approve(await exchange.getAddress(), 10n * unit)).wait()
  await (await ctf.connect(seller).setApprovalForAll(await exchange.getAddress(), true)).wait()

  const config = {
    demoOnly: true, chainId: 31337, rpcUrl: network.config.url,
    addresses: { collateral: await collateral.getAddress(), ctf: await ctf.getAddress(), exchange: await exchange.getAddress() },
    accounts: { admin: admin.address, oracle: admin.address, guardian: guardian.address, operator: operator.address, buyer: buyer.address, seller: seller.address },
    round: { roundId, question: 'Will BTC/USD close higher than its opening price after five minutes?', startTime, tradingCutoff, resolutionTime, questionId, conditionId,
      tieOutcome: 'NO', source: SOURCE, priceDecimals: 6, sourceTimestampPolicy: 'exact round boundary; recorded within 10 seconds; no future evidence',
      resolutionStatus: 'PENDING', openingSample: null, closingSample: null },
    tokens,
    collateralDecimals: 6,
    abiLocations: Object.fromEntries(await Promise.all(['MockCollateral', 'ConditionalTokens', 'KhmerFPExchange'].map(async name => [name, path.relative(path.resolve(__dirname, '..'), (await artifacts.getArtifactPaths()).find(p => p.endsWith(`${path.sep}${name}.json`)))]))),
    balances: { buyerCollateral: (await collateral.balanceOf(buyer.address)).toString(), sellerCollateral: (await collateral.balanceOf(seller.address)).toString(),
      sellerYes: (await ctf.balanceOf(seller.address, tokens[0].tokenId)).toString(), sellerNo: (await ctf.balanceOf(seller.address, tokens[1].tokenId)).toString() },
    deploymentBlock: await ethers.provider.getBlockNumber(),
    instanceId: (await ethers.provider.send('hardhat_metadata', [])).instanceId,
    codeHashes: {
      collateral: ethers.keccak256(await ethers.provider.getCode(await collateral.getAddress())),
      ctf: ethers.keccak256(await ethers.provider.getCode(await ctf.getAddress())),
      exchange: ethers.keccak256(await ethers.provider.getCode(await exchange.getAddress())),
    },
  }
  const destination = path.resolve(__dirname, '../deployments/local-bitcoin-demo.json')
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(`${destination}.tmp`, JSON.stringify(config, null, 2) + '\n')
  await rename(`${destination}.tmp`, destination)
  console.log(JSON.stringify({ ...config, configFile: destination }, null, 2))
  return config
}

if (require.main === module) setupDemo().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { setupDemo }
