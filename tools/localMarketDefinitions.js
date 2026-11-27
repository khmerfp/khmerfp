import { SEED_MARKETS } from '../client/src/data/markets.js';

// Copy only market terms from the original catalog. Never copy its simulated quotes.
// These definitions prepare disposable local markets; they are not live prices,
// resolution evidence, real liquidity or production configuration.
export function localMarketDefinitions(now = new Date()) {
  const offset = 7 * 60 * 60 * 1000; // Asia/Phnom_Penh has no daylight-saving offset.
  const opening = new Date(Math.ceil((now.getTime() + 20000) / 1000) * 1000);
  const local = new Date(opening.getTime() + offset);
  const nextMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - offset);
  const nextSaturday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + ((6 - local.getUTCDay() + 7) % 7 || 7)) - offset);
  const iso = date => new Date(date.getTime() + offset).toISOString().slice(0, 19);
  const definitions = ['btc5m', 'steel-monthly', 'hdpe-monthly', 'petrol-weekly'].flatMap(id => {
    const original = SEED_MARKETS.find(market => market.id === id);
    const binary = id === 'btc5m';
    const decimals = id === 'petrol-weekly' ? 0 : 2;
    const end = id === 'petrol-weekly' ? nextSaturday : nextMonth;
    const schedule = {
      mode: binary ? 'FIXED' : 'ONCE', timezone: 'Asia/Phnom_Penh', anchorLocal: iso(opening), dstPolicy: 'REJECT',
      stepSeconds: '300', months: '1', durationMode: 'SECONDS',
      tradingSeconds: binary ? '300' : String(Math.floor((end - opening) / 1000)),
      observationStartOffset: '0', observationEndOffset: '0', resultDelaySeconds: '15',
      resolutionDelaySeconds: '172800', lookaheadSeconds: '600', openingGraceSeconds: '60',
    };

    // Market identity, schedule, observation rules and outcome boundaries become
    // immutable once the corresponding database market is frozen.
    const definition = {
      scope: 'MOCK_ONLY', title: original.title, description: original.sub,
      marketType: binary ? 'BINARY' : 'PRICE_RANGE', schedule,
      outcomes: binary ? [{ label: 'YES' }, { label: 'NO' }] : original.options.map(option => ({
        label: option.label, lower: (BigInt(option.lo) * 10n ** BigInt(decimals)).toString(),
        upper: Number.isFinite(option.hi) ? (BigInt(option.hi) * 10n ** BigInt(decimals)).toString() : null,
      })),
      observation: {
        sourceId: 'LOCAL_MOCK_' + id.toUpperCase().replaceAll('-', '_'),
        unit: id === 'petrol-weekly' ? 'KHR_PER_LITRE' : binary ? 'USD_PER_BTC' : 'USD_PER_METRIC_TON',
        decimals: String(decimals), referenceAsset: binary ? 'BTC' : id === 'steel-monthly' ? 'STEEL' : id === 'hdpe-monthly' ? 'HDPE' : 'GASOLINE',
        revisionPolicy: 'REQUIRE_FINAL', domainLower: '0', domainUpper: null,
      },
      rules: binary ? 'Local mock market. YES if final closing observation is greater than opening; ties are NO. Missing observations leave resolution pending.' : 'Local mock market. Select exactly one interval: lower inclusive, upper exclusive; the final interval is unbounded. No live source or automatic payout is configured.',
      ruleVersion: 'local-catalog-v1', requireOther: false,
    };
    const current = { id, key: 'khmerfp-' + id, version: 1n, category: binary ? 'crypto' : 'economy', definition };
    if (binary) return [current];
    // A partial initial calendar period is explicit and immutable. Later versions
    // start at the real calendar boundary; neither history nor timestamps are rewritten.
    const recurring = structuredClone(definition);
    recurring.schedule = { ...schedule, mode: id === 'petrol-weekly' ? 'WEEKLY' : 'MONTHLY', anchorLocal: iso(end), durationMode: 'NEXT_OCCURRENCE' };
    return [current, { ...current, version: 2n, definition: recurring }];
  });

  const league = SEED_MARKETS.find(market => market.id === 'cpl-champion-27');

  // Categorical markets store mutually exclusive atomic outcomes. They do not
  // invent a numeric reference price for an event such as a league champion.
  const leagueEnd = new Date(Date.UTC(2027, 4, 31, 17, 0, 0)); // June 1 at midnight in Phnom Penh.
  const leagueSchedule = {
    mode: 'ONCE', timezone: 'Asia/Phnom_Penh', anchorLocal: iso(opening), dstPolicy: 'REJECT',
    stepSeconds: '300', months: '1', durationMode: 'SECONDS',
    tradingSeconds: String(Math.floor((leagueEnd - opening) / 1000)),
    observationStartOffset: '0', observationEndOffset: '0', resultDelaySeconds: '86400',
    resolutionDelaySeconds: '172800', lookaheadSeconds: '600', openingGraceSeconds: '60',
  };
  definitions.push({
    id: league.id,
    key: 'khmerfp-' + league.id,
    version: 1n,
    category: 'sports',
    definition: {
      scope: 'MOCK_ONLY',
      title: league.title,
      description: league.sub,
      marketType: 'CATEGORICAL',
      schedule: leagueSchedule,
      outcomes: league.options.map((option, index) => ({
        label: index === league.options.length - 1 ? 'OTHER' : option.label,
      })),
      observation: {
        sourceId: 'LOCAL_MOCK_CPL_FINAL_STANDINGS', unit: 'EVENT_RESULT', decimals: '0',
        referenceAsset: 'CPL_CHAMPION', revisionPolicy: 'REQUIRE_FINAL',
        domainLower: '0', domainUpper: null,
      },
      rules: 'Local mock market. Exactly one club wins according to the official final standings. Missing or conflicting evidence leaves resolution pending.',
      ruleVersion: 'local-catalog-v1',
      requireOther: true,
    },
  });

  return definitions;
}
