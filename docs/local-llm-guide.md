# Running PrimeLoop on a local LLM

PrimeLoop's Prime agent plans, routes work, and calls tools. That means the
model you pick must do **reliable tool/function calling** — not just chat.
Many small local models accept a tool-call request and then answer in prose;
setup will catch this (the live test requires an actual tool call), but save
yourself the round trip and start with a model from the list below.

## Recommended models (tool-calling verified families)

| Model | Size | Notes |
|-------|------|-------|
| `qwen2.5:32b` / `qwen2.5-coder:32b` | ~20 GB VRAM (Q4) | Best local planner in this list |
| `qwen2.5:14b` / `qwen2.5-coder:14b` | ~9 GB VRAM (Q4) | Good default for 12–16 GB cards |
| `llama3.1:70b` | ~40 GB VRAM (Q4) | Strong, needs multi-GPU or Mac unified memory |
| `mistral-small-3` | ~14 GB VRAM (Q4) | Solid tool calling |
| `llama3.1:8b` | ~5 GB VRAM (Q4) | Floor. Works, but expect routing mistakes |

Below ~7B parameters, Prime's model-capability check will warn or block the
model for planning duties — that's intentional.

## Setup

1. Start your server (Ollama, LM Studio, vLLM, llama.cpp, LiteLLM) **on the
   Docker host** and pull a model.
2. Run `./install.sh` and open the dashboard. QuickStart scans
   `host.docker.internal` and `localhost` on the standard ports (Ollama
   11434, LM Studio 1234, vLLM 8000, llama.cpp 8080, LiteLLM 4000/3000) and
   lists what it finds with each server's models.
3. Pick the model; the wizard runs a live completion + tool-call test before
   it lets you launch.

A server on another machine isn't auto-scanned — set `LOCAL_LLM_HOST=<ip>`
(ports probed) or `LOCAL_LLM_BASE_URL=http://<ip>:<port>` in `.env` and it
appears in the wizard.

## Gotchas we hit so you don't have to

- **First request loads the model.** A 20 GB model can take minutes to load
  into VRAM. The setup test waits up to 120 s and tells you when it suspects
  a cold load — if it times out, wait for the load to finish (`ollama ps`)
  and press *Test only* again.
- **Ollama unloads idle models after ~5 minutes** (`keep_alive`). Prime's
  control loop runs on a multi-minute cron, so you may pay the load cost
  repeatedly. For a dedicated box, raise it:
  `OLLAMA_KEEP_ALIVE=1h` on the Ollama server.
- **Shared GPUs fail loudly.** If something else is using VRAM (training,
  games), the model load dies with `cudaMalloc failed: out of memory` and
  the wizard shows the raw error. Free the GPU or pick a smaller model.
- **`localhost` inside the container is the container.** The compose files
  map `host.docker.internal` to the Docker host for you; use that hostname
  in any manual base URL when PrimeLoop runs in Docker.
- **Tool-calling support varies by server.** Ollama and vLLM implement
  OpenAI-style `tools` on `/v1/chat/completions`; llama.cpp needs a recent
  build with `--jinja` for tool support. If the tool-call test fails on a
  model listed above, update the server first.
