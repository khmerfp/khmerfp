import { createDemoService } from './demo/orderService.js'
import { createDemoApp } from './demo/app.js'

// deliberately separate from server.js: no dotenv, database startup, payments or production routes.
let service
try {
  service = await createDemoService()
  await service.reconcile()
  const server = createDemoApp(service).listen(4001, '127.0.0.1', () => console.log('Local demo API: http://127.0.0.1:4001'))
  const stop = () => server.close(async () => { await service.close(); process.exit(0) })
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
} catch {
  if (service) await service.close()
  console.error('Local demo startup rejected. Check local setup, journal lock and configuration.')
  process.exitCode = 1
}
