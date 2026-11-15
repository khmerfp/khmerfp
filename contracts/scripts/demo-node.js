const { spawn } = require('node:child_process')
const readline = require('node:readline')

// keep local test keys out of terminal output.
const child = spawn(process.execPath, [require.resolve('hardhat/internal/cli/cli'), 'node', '--hostname', '127.0.0.1'], {
  stdio: ['inherit', 'pipe', 'pipe'],
})
for (const stream of [child.stdout, child.stderr]) {
  const lines = readline.createInterface({ input: stream })
  lines.on('line', line => {
    if (/private key|mnemonic|seed phrase/i.test(line)) return
    console.log(line.replace(/0x[0-9a-fA-F]{64}\b/g, '[redacted 32-byte value]'))
  })
}
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
