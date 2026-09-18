<div align="center">
  <h1>O N E &nbsp; R O U T E R</h1>
  <p><b>Inference, intelligently routed.</b></p>
  <br />
</div>

**One Router** is an inference control plane for routing models, compute, context, and agent workloads across local and cloud infrastructure.

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

---

<div align="center">
  <!-- TODO: Replace with an actual GIF recorded using a tool like LICEcap, Asciinema, or VHS -->
  <img src="https://raw.githubusercontent.com/sanketmuchhala/one-router/main/docs/assets/demo.gif" alt="One Router TUI Dashboard Demo" width="800" />
  <p><em>The beautiful One Router Terminal User Interface (TUI). Run <code>onerouter models</code> to see it live.</em></p>
</div>

---

## ⚡ Features

- 🧠 **Automatic Workload Profiling**: Analyzes if your request is a chat message or complex agentic code execution, and dynamically selects the best provider.
- 🎨 **Beautiful Modern TUI**: A gorgeous, fully-featured terminal dashboard with real-time health metrics, P95 latency tracking, cost-saving calculations, and live routing tables.
- 🔑 **API Key Management**: Generate secure Bearer tokens for your clients using the built-in keystore.
- 🌐 **Global Command-Line Interface**: Run `onerouter` natively from any directory on your machine.
- 🧩 **Multi-Provider Support**: Built-in support for OpenRouter, Groq, Cerebras, Gemini, Mistral, SambaNova, Hugging Face, Ollama, and generic OpenAI-compatible endpoints.

## 🚀 Getting Started

### 1. Install & Link

Clone the repository and install it globally so you can run the `onerouter` command from anywhere:

```bash
git clone https://github.com/sanketmuchhala/one-router.git
cd one-router
pnpm install
pnpm build
npm link    # Maps the 'onerouter' command globally
```

### 2. Configure Providers

You can either pass keys through a `.env` file or configure them directly via the CLI:

```bash
# Initialize a global config at ~/.onerouter/config.json
onerouter init
```

*Note: You can easily edit `~/.onerouter/config.json` to hardcode your exact API keys, or use `env:PROVIDER_API_KEY` syntax if you prefer to export environment variables in your shell.*

### 3. Generate an Auth Token

One Router acts as a secure local API gateway. You will need to generate a Bearer Token for your clients (like cURL, Aider, Cline, etc.) to use.

```bash
onerouter key create my-key
```

*Copy the generated `fr_...` key. It will only be shown once.*

### 4. Start the Inference Server

Start the API Gateway:

```bash
onerouter serve
```

The gateway runs seamlessly on `http://127.0.0.1:4141/v1`.

### 5. Launch the TUI Dashboard

Open a separate terminal window and launch the interactive Control Plane:

```bash
onerouter models
```

This gorgeous dashboard allows you to:
- See which providers are **ONLINE**.
- Track live **P95 Latencies** and **RPS**.
- Monitor the **Best Ranked Models** based on live heuristics.
- Switch between **Chat Routes** and **Agent Routes**.

### 6. Send a Request

Use standard OpenAI-compatible tooling. Point them to `http://127.0.0.1:4141/v1` and set the model to `onerouter/auto`.

```bash
curl http://127.0.0.1:4141/v1/chat/completions \
  -H "Authorization: Bearer <your_generated_key_here>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "onerouter/auto",
    "messages": [{"role": "user", "content": "Hi, what can you do?"}]
  }'
```

## 📚 Documentation

Dive deeper into the architecture and capabilities of One Router:

- [Architecture](docs/ARCHITECTURE.md)
- [Routing Policies](docs/ROUTING.md)
- [Latency Hedging](docs/HEDGING.md)
- [Context Affinity](docs/CONTEXT_AFFINITY.md)
- [Agent Workflows](docs/WORKFLOWS.md)
- [Telemetry](docs/TELEMETRY.md)
- [Roadmap](docs/ROADMAP.md)

## 📄 License
MIT
