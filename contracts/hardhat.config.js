require('@nomicfoundation/hardhat-ethers')
require('@nomicfoundation/hardhat-chai-matchers')
require('dotenv').config({ path: require('path').join(__dirname, '.env') })

const baseSepoliaUrl = process.env.BASE_SEPOLIA_RPC_URL || ''
// local builds and tests do not need deployment credentials.
const usesBaseSepolia = process.argv.some((argument, index, args) =>
  argument === '--network' && args[index + 1] === 'baseSepolia')
const deployerKey = usesBaseSepolia ? process.env.BASE_SEPOLIA_DEPLOYER_KEY || '' : ''

module.exports = {
  paths: {
    sources: './src',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  solidity: {
    compilers: [{ version: '0.8.28', settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: 'cancun',
    } }, { version: '0.5.17', settings: { optimizer: { enabled: true, runs: 200 } } }],
  },
  networks: {
    hardhat: { chainId: 31337 },
    baseSepolia: {
      chainId: 84532,
      url: baseSepoliaUrl,
      accounts: deployerKey ? [deployerKey] : [],
    },
  },
}
