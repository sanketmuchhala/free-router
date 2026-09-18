# Routing Policies

One Router uses a pluggable routing policy engine. Instead of a single fallback list, it makes decisions based on multiple dimensions.

## Strategies
- **balanced**: Weights quality, latency, and cost evenly.
- **lowest-cost**: Heavily penalizes expensive APIs, prefers local/free tiers.
- **lowest-latency**: Heavily weights recent TTFT (Time To First Token) and ping metrics.
- **highest-quality**: Prioritizes large parameter counts and frontier models.
- **local-first**: Immediately routes to local Ollama/llama.cpp nodes if available.
- **hedged**: Optimizes for the lowest possible P99 latency by scheduling parallel executions.
- **reasoning-budget**: Allocates budget toward models optimized for chain-of-thought (e.g. o1, r1).

## Decisions
Every routing decision produces a `RouteDecision` object explaining why a destination was selected (e.g., "cache affinity + lower predicted TTFT"). This ensures complete observability into the control plane.
