# Roadmap

One Router is an evolving inference control plane.

## Current Priority (Gen 3)
- [x] Restructure flat codebase into domain-driven architecture.
- [x] Abstract Routing Engine and Policy generation.
- [x] Telemetry baseline and distributed tracing structs.
- [x] Premium TUI redesign.

## Next Steps
- **Hedging**: Finalize cancellation and HTTP stream-racing logic for the `hedged` policy.
- **Dynamic Budgets**: Implement test-time compute allocation (allowing One Router to spawn multiple cheap samples and run a verifier model automatically).
- **KV Affinity**: Build the prefix-fingerprint index for self-hosted vLLM nodes.
- **Workflow YAMLs**: Allow declarative subgraph routing definitions.
