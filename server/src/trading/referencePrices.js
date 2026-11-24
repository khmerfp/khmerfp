// The existing observation schema is mock-only and has no reviewed provider,
// verification provenance or freshness policy. Never promote is_final to proof
// of a real reference price, and never use fills to manufacture one.
export function referencePriceState(market, spec, requirements, question) {
  const requirement = requirements.find(r => r.kind === 'OPEN') || requirements[0];
  return {
    marketId: market.id,
    roundKey: market.round_key,
    kind: market.market_type === 'CATEGORICAL' ? 'EVENT' : 'NUMERIC',
    status: 'UNAVAILABLE',
    verification: 'NOT_CONFIGURED',
    reason: 'VERIFIED_REFERENCE_SOURCE_NOT_CONFIGURED',
    referenceAsset: spec?.reference_asset || market.observation_spec?.referenceAsset || null,
    unit: spec?.unit || requirement?.unit || null,
    decimals: spec?.decimals ?? requirement?.decimals ?? null,
    configuredSource: requirement?.source_id || null,
    maxAgeMs: null,
    latest: null,
    opening: null,
    history: [],
    event: question ? { question: question.question_text, rules: question.resolution_rules, configuredSource: question.resolution_source } : null,
  };
}
