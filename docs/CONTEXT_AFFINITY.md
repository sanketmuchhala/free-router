# Context Affinity

Context Affinity allows One Router to efficiently map requests to inference workers that already hold the prompt in their KV cache.

## Levels of Affinity
1. **Provider Prompt Caching**: Leveraging explicit APIs (e.g., Anthropic Prompt Caching) to reduce cost and latency. One Router logs this in its telemetry.
2. **Session Affinity (Implemented)**: Panning repeated conversational turns to the exact same model ID to maximize the chance of hitting warm upstream caches.
3. **Self-Hosted KV-Locality (Roadmap)**: Advanced routing for self-hosted clusters (vLLM, SGLang) utilizing radix-tree matching to route requests directly to the GPU worker holding the longest matching prefix.
