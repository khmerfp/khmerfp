const { ethers } = require('hardhat')

async function main() {
  const [deployer] = await ethers.getSigners()
  const collateral = await ethers.deployContract('MockCollateral')
  const conditionalTokens = await ethers.deployContract('MockConditionalTokens')
  await Promise.all([collateral.waitForDeployment(), conditionalTokens.waitForDeployment()])
  const exchange = await ethers.deployContract('KhmerFPExchange', [
    await collateral.getAddress(),
    await conditionalTokens.getAddress(),
  ])
  await exchange.waitForDeployment()
  console.log(JSON.stringify({
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    collateral: await collateral.getAddress(),
    conditionalTokens: await conditionalTokens.getAddress(),
    exchange: await exchange.getAddress(),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
