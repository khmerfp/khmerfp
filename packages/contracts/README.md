# Contract Bindings Package

Reserved for reviewed ABIs, chain-specific address registries, typed bindings, EIP-712 definitions, and event schemas consumed by the API, relayer, indexer, matcher, and web client.

## Gnosis CTF identifiers

`@khmerfp/contracts/ctf-identifiers` derives condition, collection, and position identifiers using the canonical Gnosis Conditional Tokens rules. Collection derivation uses the alt_bn128 curve algorithm from `CTHelpers.sol`; it is not a simple hash.

The unit tests use the published Gnosis developer-guide vectors. Successful derivation proves only that an identifier matches its inputs. It does not prove that a condition was prepared on-chain, that a transaction is finalized, or that a database row marked `PREPARED` survived a chain reorganization.

References:

- https://github.com/gnosis/conditional-tokens-contracts/blob/master/contracts/CTHelpers.sol
- https://github.com/gnosis/conditional-tokens-contracts/blob/master/docs/developer-guide.rst

