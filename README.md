# Obsidian Ollama Plugin

Local-first AI chat inside Obsidian, powered by Ollama's OpenAI-compatible API. Open a side-pane chat, stream Markdown answers, ask context-aware questions about your current note, and manage the default model directly in settings.

### Features

- **Side pane chat view**: Ribbon icon and command palette entry to open `Ollama Chat`.
- **Streaming responses**: Answers render as Markdown with auto-scroll and code-block copy buttons.
- **Context from active file**: The current note is sent as context automatically for richer, on-topic replies.
- **Recommended questions**: A suggestions panel proposes 5 follow-up questions based on the active file; click to ask instantly.
- **Conversation history**: Persists across sessions; use Reset to clear and abort any in-flight response.
- **Model selection**: Settings tab lists installed Ollama models and lets you choose the default; includes a Refresh button.

### Requirements

- Obsidian ≥ `0.16.0`
- [Ollama](https://ollama.com) running locally with the OpenAI-compatible endpoint at `http://localhost:11434/v1/`
- A compatible model installed in Ollama. The plugin defaults to `gpt-oss:20b`.

Install a model (example):

```bash
ollama pull gpt-oss:20b
```

Notes:
- The plugin uses the OpenAI SDK pointed at `http://localhost:11434/v1/` with an `apiKey` placeholder (`ollama`). No real API key is required when running locally.
- The Settings dropdown will be populated from `models.list()` if Ollama is running.

### Installation

Manual (development or sideload):
1. Build the plugin (see Development below) to produce `main.js`.
2. Copy `manifest.json`, `main.js`, and `styles.css` into your vault at `VAULT/.obsidian/plugins/obsidian-ollama-plugin/`.
3. In Obsidian, enable the plugin from Settings → Community Plugins.

### Usage

- Open the chat: click the ribbon icon or run the `Open Ollama Chat` command.
- Type your prompt. Press Enter to send, Cmd+Enter to insert a newline.
- Click **Reset** to clear history and cancel ongoing responses.
- Use the **copy** buttons on responses and code blocks.
- With an active note open, check the **Recommended questions** panel at the bottom of the chat and click a suggestion to ask it.

### Settings

- **Default Ollama model**: Choose from installed models (requires Ollama running). Use **Refresh models** to reload the list.

### Privacy

- All requests are sent to your local Ollama server. The plugin includes the content of your active note as context to improve answers. Nothing is sent to external services unless your Ollama is configured to do so.

### Troubleshooting

- “Failed to list Ollama models”: ensure Ollama is running and accessible at `http://localhost:11434` and that your version supports the OpenAI-compatible API.
- “Chat failed. Check Ollama and model settings.”: verify the model exists locally (e.g., `ollama list`) and that the Default model in settings matches an installed model.

### Development

Prereqs: Node.js ≥ 16

```bash
yarn
yarn dev   # develop with esbuild watching
yarn build # typecheck + production build
```

Scripts of interest:
- `dev`: run esbuild in watch mode
- `build`: run `tsc` typecheck then bundle for production
- `version`: bump versions and update `manifest.json`/`versions.json`
- `format` / `format:check`: Prettier

### License

MIT
