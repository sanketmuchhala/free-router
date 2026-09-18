# Telemetry & Observability

One Router is built to learn from production traffic. The telemetry subsystem (`src/telemetry`) tracks live distributions of API performance.

## Tracked Metrics
- Requests (Success / Failure / Fallback / Cancellations)
- TTFT (Time to First Token)
- Total Latency and Tokens/Second
- Hedge Outcomes (Wins, Losses, Wasted Spend)
- Estimated Savings (vs Frontier baseline)

These metrics feed directly into the **TUI Dashboard** and influence the dynamic **Routing Policy Engine**.
