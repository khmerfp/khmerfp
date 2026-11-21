import { afterEach, expect, it, vi } from 'vitest';
import { subscribeTrading } from './custodialTrading.js';
afterEach(() => vi.unstubAllGlobals());
it('SSE errors including 429 trigger refresh and retain reconnect support', () => {
  const listeners = {};
  const stream = { addEventListener: vi.fn((name, callback) => { listeners[name] = callback; }), close: vi.fn() };
  vi.stubGlobal('EventSource', vi.fn(function () { return stream; }));
  const refresh = vi.fn(), status = vi.fn();
  const stop = subscribeTrading(false, refresh, status);
  stream.onerror({ status: 429 });
  expect(status).toHaveBeenCalledWith('Reconnecting - refreshing the latest snapshot');
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(stream.close).not.toHaveBeenCalled();
  listeners['snapshot-required']();
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
  expect(stream.close).toHaveBeenCalledTimes(1);
});
