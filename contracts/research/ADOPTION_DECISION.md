# Exchange adoption recommendation

Status: recommendation for owner review. No implementation switch is approved.

**Retain the custom KhmerFP exchange for the current secondary-trading MVP. Treat MIT V1 as the preferred upstream candidate if broader exchange reuse becomes the approved objective. Do not adopt V2 for production without a commercial license and a separate requirements review.**

The local V1 proof of concept works. It passed crossed-price trading, partial fills, cancellation, EIP-1271 wallets, binary mint matching, binary merge matching, signature rejection and atomic rollback using official Gnosis CTF. Keeping custom is therefore a requirements decision, not a claim that V1 is incompatible with CTF or smart wallets.

Three gaps prevent recommending a drop-in V1 adoption today:

1. The rounding probe shows that a tiny SELL fill can transfer an outcome unit for zero collateral. KhmerFP currently rejects payments outside either signed limit on every fill. An off-chain policy alone is weaker than that on-chain guarantee.
2. V1 treats the requested outcome amount on a BUY as a minimum and can allocate surplus outcomes to the buyer. KhmerFP currently treats it as a total outcome cap. Orders, reservations and balance expectations must change deliberately.
3. V1 grants the exchange's CTF contract unlimited collateral allowance and uses operator-controlled settlement and an admin registry. These are reasonable upstream design choices, but need explicit approval against KhmerFP's bounded-permission requirements.

The custom exchange preserves strict quantity and payment limits with the current signed format and only secondary transfers. This does not make it more audited or production safe. It still has no independent audit, emergency pause or approved-market registry. Keep it on local mock funds while those decisions and reviews remain open.

V1 offers a more complete base for complementary matching, fee handling, pausing and admin/operator control. If the owner approves those semantics, build a V1 adapter prototype, decide a rounding remedy, and compare audited pins before a migration proposal. Any source changes need focused tests and a fresh security review. The archived status means KhmerFP must own maintenance. Upstream's audit does not cover the current pinned head automatically, our adapters, or any future fork.

V2 is not the default choice: its license, signed expiry/cancellation gaps, cached EIP-1271 preapprovals and larger integration surface add unresolved work. Its advertised gas improvements alone do not settle those issues. No V2 code was added to KhmerFP.

## Owner decisions

- Keep strict per-fill price and outcome caps, or explicitly approve V1 semantics?
- Require bounded approvals in every direction, including exchange-to-CTF, or approve V1's trusted max allowance?
- Approve an operator/admin model and who holds the keys?
- Keep secondary trading first, or schedule complementary trading separately?
- Fund independent audit/maintenance for custom or an adapted V1 fork?
- If considering V2, authorize legal review and commercial-license discussions; no commercial grant is assumed.

## Next steps

1. Review this comparison and the executed rounding probe.
2. Approve the execution/accounting/permission policies before choosing a production contract.
3. Keep the Stage 3.2 code and tests intact. Add CI and hardening for the selected path after approval.
4. If V1 is selected, version the signing adapter and require fresh signatures; never reinterpret existing signatures.
5. Run a complete acceptance and security suite, including fees, tiny fills, nonce/expiry, donated balances, malicious callbacks, roles, pauses and real provider wallets.
6. Plan testnet deployment separately. No hosted chain or existing database was accessed in this evaluation.

In plain English: our current contract fits today's smaller trading rules. Polymarket V1 can do more, and the local tests prove it, but it also follows different rules for rounding, fills and permissions. Agree on those differences before replacing the exchange. V2 additionally needs a production license decision.

See [EXCHANGE_COMPARISON.md](EXCHANGE_COMPARISON.md) for pinned source evidence and results, and [INTEGRATION_GAPS.md](INTEGRATION_GAPS.md) for work estimates and risks.
