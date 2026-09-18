# Latency Hedging

Latency hedging is a primary differentiator of One Router, designed to eliminate the long tail of LLM latency (P95/P99).

## How it works
1. **Primary Dispatch**: A request is sent to the primary provider (e.g., Groq).
2. **Threshold Timer**: A timer starts (e.g., 200ms).
3. **Secondary Dispatch**: If the primary does not return a first token before the threshold, the identical request is dispatched to a secondary fallback provider.
4. **Race**: The two streams race. The first to return an acceptable token wins.
5. **Cancellation**: The losing request is cancelled mid-flight to save tokens and compute.
6. **Telemetry**: The hedge overhead and latency improvement are logged to adapt future thresholds.

*Note: Hedging is actively being integrated into the core HTTP streaming handler.*
