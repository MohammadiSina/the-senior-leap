# AI Evaluator

A CLI tool that acts as a senior engineer reviewing your exercise analysis. It reads your `my-analysis.md` and the exercise `rubric.md`, then generates structured, actionable feedback saved to `my-evaluation.md`.

It uses an adapter pattern to support local and cloud-based LLMs.

---

## Prerequisites

- **Node.js v18 or higher** (required for native `fetch` and `AbortController`).
- An API key if using cloud providers (Anthropic or OpenRouter).

---

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create your configuration file:
   ```bash
   cp config.example.yml config.yml
   ```

3. Open `config.yml` and set your preferred provider, model, and API key.

---

## Configuration Examples

### OpenRouter (Recommended for free/cheap access)
OpenRouter allows you to use free models by appending `:free` to the model name, or paid models for better reasoning.
```yaml
provider: openrouter
model: meta-llama/llama-3-8b-instruct:free # or anthropic/claude-3-5-sonnet
api_key: "sk-or-v1-your-key-here"
```

### Ollama (Local, offline)
Requires Ollama running locally (`ollama run llama3.2`).
```yaml
provider: ollama
model: llama3.2
api_key: "" # Not needed for local
base_url: http://localhost:11434
```

### Anthropic (Cloud, high quality)
```yaml
provider: anthropic
model: claude-3-5-sonnet-20241022
api_key: "your-anthropic-key-here"
```

---

## Usage

Run the evaluator from the `ai-evaluator` directory, pointing it to the exercise folder you want to evaluate.

```bash
node evaluate.js --exercise ../node-internals/event-loop-starvation
```

**What happens:**
1. The tool reads `rubric.md` and `my-analysis.md` from the target folder.
2. It sends them to your configured AI provider with a strict system prompt.
3. It prints the feedback to your terminal.
4. It saves the feedback to `my-evaluation.md` inside the exercise folder.

---

## Troubleshooting

- **"fetch failed" or hanging requests**: 
  - Ensure you are using Node.js v18+. 
  - Free models on OpenRouter can queue requests. The evaluator has a built-in 60-second timeout to prevent infinite hanging. If it times out, try a different model or wait a moment and retry.
- **Missing files error**: Ensure the path provided to `--exercise` contains both `rubric.md` and `my-analysis.md`.

---

## Architecture

The evaluator is built to be easily extensible:
- `evaluate.js`: The main CLI orchestrator. Reads config, loads files, and routes to the correct adapter.
- `adapters/base.js`: The abstract base class defining the `evaluate()` contract.
- `adapters/ollama.js`, `anthropic.js`, `openrouter.js`: Provider-specific implementations handling API formatting and authentication.
- `prompts/system.md`: The strict persona and formatting rules enforced on the LLM.