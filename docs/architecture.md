# Architecture

One Router is designed as an inference control plane. Rather than a flat proxy, it splits the problem into distinct domains:

```text
                    ┌─────────────────┐
                    │ Application/API │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │    ONE ROUTER   │
                    │  Control Plane  │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
      Policy Engine      Scheduler        Telemetry
            │                │                │
    ┌───────┼───────┐    Context/KV      Measurements
    │       │       │      Affinity
  Cost   Latency  Quality       │
    └───────┼───────┘           │
            │                   │
            └─────────┬─────────┘
                      │
               Routing Decision
                      │
            ┌─────────┼──────────┐
            │         │          │
          Local     Cloud     Frontier
            │         │          │
         Ollama     Groq      Anthropic
         llama.cpp  etc.      OpenAI/etc.
```

## Domains
- **CLI/TUI**: Premium terminal user interfaces for observation and configuration.
- **Gateway**: Fast, streaming HTTP proxy exposing an OpenAI-compatible interface.
- **Routing Engine**: Evaluates policies, scores candidate models, and handles fallback.
- **Providers**: Adapters for unifying diverse APIs (Anthropic, OpenRouter, Local, etc.).
- **Telemetry**: Distributed tracing, latency tracking, and metric aggregation.
- **Cache/Hedging**: (Experimental) KV-aware session routing and parallel inference racing.
