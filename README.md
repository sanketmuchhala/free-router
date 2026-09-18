# ONE ROUTER
**Inference, intelligently routed.**

One Router is an inference control plane for routing models, compute, context and agent workloads across local and cloud infrastructure.

It is designed to become a next-generation inference orchestration system. Rather than being a thin API gateway or a cosmetic model dropdown, One Router is built on the thesis that inference should be managed like an operating system control plane.

```text
Traditional router:
request → choose model/provider → proxy response

ONE ROUTER:
request/workflow
→ understand workload
→ understand available inference state
→ evaluate providers/models/hardware
→ allocate compute
→ exploit cache affinity
→ hedge against latency
→ route individual workflow nodes
→ validate results
→ continuously learn from telemetry
→ return response
```

![One Router Control Plane (Conceptual)](https://via.placeholder.com/800x400.png?text=One+Router+Dashboard)

## Getting Started

### 1. Install
```bash
git clone https://github.com/sanketmuchhala/onerouter.git
cd onerouter
pnpm install
pnpm build
```

### 2. Configure
```bash
# Optional: create a default config in ~/.onerouter/config.json
node dist/cli/index.js init
```
Without a config file, One Router will read standard environment variables (e.g., `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`) and automatically detect local Ollama or llama.cpp instances.

### 3. Start
```bash
# Launch the Gateway
node dist/cli/index.js serve
```

### 4. TUI Dashboard
```bash
# Launch the inference control plane
pnpm start
```

### 5. Send a Request
Use standard OpenAI-compatible tooling (cURL, SDKs, or agents like Aider/Cline). Point them to `http://127.0.0.1:4141/v1` with the model `onerouter/auto`.

```bash
curl http://127.0.0.1:4141/v1/chat/completions \
  -H "Authorization: Bearer <your_key_here>" \
  -d '{"model":"onerouter/auto","messages":[{"role":"user","content":"Hi"}]}'
```

## Documentation

Dive deeper into the architecture and capabilities of One Router:

- [Architecture](docs/ARCHITECTURE.md)
- [Routing Policies](docs/ROUTING.md)
- [Latency Hedging](docs/HEDGING.md)
- [Context Affinity](docs/CONTEXT_AFFINITY.md)
- [Agent Workflows](docs/WORKFLOWS.md)
- [Telemetry](docs/TELEMETRY.md)
- [Roadmap](docs/ROADMAP.md)

## License
MIT
