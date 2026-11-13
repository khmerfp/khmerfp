const { ethers } = require('hardhat')

const ONE = 1_000_000n
const YES_TOKEN_ID = 101n

async function main() {
  const [, buyer, seller, matcher] = await ethers.getSigners()
  const collateral = await ethers.deployContract('MockCollateral')
  const ctf = await ethers.deployContract('MockConditionalTokens')
  const exchange = await ethers.deployContract('KhmerFPExchange', [
    await collateral.getAddress(),
    await ctf.getAddress(),
  ])
  await Promise.all([
    collateral.waitForDeployment(),
    ctf.waitForDeployment(),
    exchange.waitForDeployment(),
  ])

  await exchange.grantRole(await exchange.OPERATOR_ROLE(), matcher.address)
  await exchange.registerMarket(ethers.id('mock binary condition'), 101n, 102n)
  await collateral.mint(buyer.address, ONE)
  await ctf.mint(seller.address, YES_TOKEN_ID, ONE)
  await collateral.connect(buyer).approve(await exchange.getAddress(), 650_000n)
  await ctf.connect(seller).setApprovalForAll(await exchange.getAddress(), true)

  const expiration = BigInt((await ethers.provider.getBlock('latest')).timestamp) + 3600n
  const buy = {
    maker: buyer.address,
    tokenId: YES_TOKEN_ID,
    side: 0,
    makerAmount: 650_000n,
    takerAmount: ONE,
    nonce: 1n,
    expiration,
  }
  const sell = {
    maker: seller.address,
    tokenId: YES_TOKEN_ID,
    side: 1,
    makerAmount: ONE,
    takerAmount: 600_000n,
    nonce: 2n,
    expiration,
  }
  const network = await ethers.provider.getNetwork()
  const domain = {
    name: 'KhmerFP Exchange',
    version: '1',
    chainId: network.chainId,
    verifyingContract: await exchange.getAddress(),
  }
  const types = {
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
  const buySignature = await buyer.signTypedData(domain, types, buy)
  const sellSignature = await seller.signTypedData(domain, types, sell)
  const transaction = await exchange.connect(matcher).matchOrders(
    buy,
    buySignature,
    sell,
    sellSignature,
    ONE,
    620_000n,
  )
  await transaction.wait()

  console.log(JSON.stringify({
    buyer: buyer.address,
    seller: seller.address,
    matcher: matcher.address,
    yesReceived: (await ctf.balanceOf(buyer.address, YES_TOKEN_ID)).toString(),
    collateralReceived: (await collateral.balanceOf(seller.address)).toString(),
    transactionHash: transaction.hash,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
