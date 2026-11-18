// CI must fail closed if the required PostgreSQL child suite is missing or skipped.
export function assertRequiredDatabaseTests(tap) {
  const read = name => [...tap.matchAll(new RegExp('^# '+name+' ([0-9]+)$','gm'))].at(-1)?.[1]
  const tests=Number(read('tests')), passed=Number(read('pass'))
  if (!Number.isSafeInteger(tests) || tests<1 || passed!==tests || read('fail')!=='0' || read('skipped')!=='0' || read('cancelled')!=='0') {
    throw new Error('Required PostgreSQL tests did not all execute and pass without skips.')
  }
}
