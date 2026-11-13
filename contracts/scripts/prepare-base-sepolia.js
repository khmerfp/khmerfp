const { ethers } = require('hardhat')

async function main() {
  const network = await ethers.provider.getNetwork()
  if (network.chainId !== 84532n) {
    throw new Error(`refusing non-Base-Sepolia chain ${network.chainId}`)
  }

  const collateral = process.env.BASE_SEPOLIA_COLLATERAL_ADDRESS
  const conditionalTokens = process.env.BASE_SEPOLIA_CTF_ADDRESS
  if (!ethers.isAddress(collateral) || !ethers.isAddress(conditionalTokens)) {
    throw new Error('valid Base Sepolia collateral and CTF addresses are required')
  }
  for (const [label, address] of [['collateral', collateral], ['CTF', conditionalTokens]]) {
    if ((await ethers.provider.getCode(address)) === '0x') {
      throw new Error(`${label} address has no deployed code`)
    }
  }

  const factory = await ethers.getContractFactory('KhmerFPExchange')
  const deployment = await factory.getDeployTransaction(collateral, conditionalTokens)
  const [deployer] = await ethers.getSigners()
  const estimatedGas = await ethers.provider.estimateGas({ ...deployment, from: deployer.address })
  console.log(JSON.stringify({
    chainId: Number(network.chainId),
    deployer: deployer.address,
    collateral,
    conditionalTokens,
    estimatedGas: estimatedGas.toString(),
    deploymentApproved: process.env.CONFIRM_BASE_SEPOLIA_DEPLOY === 'true',
  }, null, 2))

  if (process.env.CONFIRM_BASE_SEPOLIA_DEPLOY !== 'true') {
    console.log('dry run only; set CONFIRM_BASE_SEPOLIA_DEPLOY=true after explicit approval')
    return
  }
  const exchange = await factory.deploy(collateral, conditionalTokens)
  await exchange.waitForDeployment()
  console.log(`KhmerFPExchange deployed at ${await exchange.getAddress()}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
