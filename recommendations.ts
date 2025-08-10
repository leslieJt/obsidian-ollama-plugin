import type { App } from 'obsidian';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type MyPlugin from './main';
import getOllamaClient, { getDefaultModel } from './ollamaClient';

export class RecommendationsPanel {
  private app: App;
  private plugin: MyPlugin;
  private rootEl: HTMLElement | null = null;
  private isLoading = false;
  private errorMessage: string | null = null;
  private questions: string[] = [];
  private abortController: AbortController | null = null;
  private onPrefill: ((q: string) => void) | null = null;
  private onAsk: ((q: string) => void) | null = null;
  private currentFilePath: string | null = null;

  constructor(app: App, plugin: MyPlugin) {
    this.app = app;
    this.plugin = plugin;
  }

  mount(parentEl: HTMLElement, callbacks: { prefill: (q: string) => void; ask: (q: string) => void }): void {
    this.rootEl = parentEl;
    this.onPrefill = callbacks.prefill;
    this.onAsk = callbacks.ask;
    this.render();
  }

  async refresh(force = false): Promise<void> {
    if (!this.rootEl) return;
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.questions = [];
      this.errorMessage = null;
      this.isLoading = false;
      this.render();
      return;
    }

    // Always show loading state for new files or when forced
    if (!force && this.questions.length > 0) {
      // Check if the questions are for the current file
      const currentFilePath = activeFile.path;
      if (this.currentFilePath === currentFilePath) {
        this.render();
        return;
      }
    }

    // Clear old questions for new files to ensure loading state is shown
    if (this.currentFilePath !== activeFile.path) {
      this.questions = [];
      this.currentFilePath = activeFile.path;
    }

    try { this.abortController?.abort(); } catch { /* no-op */ }
    this.abortController = new AbortController();

    console.log('[Recommendations] Starting refresh for file:', activeFile.path);
    this.isLoading = true;
    this.errorMessage = null;
    this.currentFilePath = activeFile.path;
    this.render();

    try {
      const content = await this.app.vault.read(activeFile);
      const MAX_CONTEXT_CHARS = 20000;
      const truncated = content.length > MAX_CONTEXT_CHARS ? content.slice(0, MAX_CONTEXT_CHARS) : content;
      const list = await this.fetchRecommendedQuestions(activeFile.path, truncated, this.abortController.signal);
      this.questions = list.slice(0, 5);
      console.log('[Recommendations] Generated questions:', this.questions.length);
    } catch (e) {
      const msg = (e as any)?.message ?? 'Failed to generate recommendations';
      if (!/abort/i.test(msg)) this.errorMessage = msg;
      this.questions = [];
      console.error('[Recommendations] Error:', msg);
    } finally {
      this.isLoading = false;
      this.render();
      console.log('[Recommendations] Refresh completed, loading:', this.isLoading);
    }
  }

  destroy(): void {
    try { this.abortController?.abort(); } catch { /* no-op */ }
    this.rootEl = null;
    this.onPrefill = null;
    this.onAsk = null;
    this.questions = [];
    this.errorMessage = null;
    this.isLoading = false;
  }

  // Debug method to check current state
  getDebugInfo(): { isLoading: boolean; questionsCount: number; currentFilePath: string | null; hasRootEl: boolean } {
    return {
      isLoading: this.isLoading,
      questionsCount: this.questions.length,
      currentFilePath: this.currentFilePath,
      hasRootEl: !!this.rootEl
    };
  }

  private render(): void {
    if (!this.rootEl) return;
    const activeFile = this.app.workspace.getActiveFile();
    this.rootEl.empty();
    if (!activeFile) return;

    console.log('[Recommendations] Rendering, loading state:', this.isLoading, 'questions:', this.questions.length);

    const header = this.rootEl.createDiv({ cls: 'ollama-chat-suggestions-header' });
    header.createDiv({ cls: 'ollama-chat-suggestions-title', text: 'Recommended questions' });
    const actions = header.createDiv({ cls: 'ollama-chat-suggestions-actions' });
    const refreshBtn = actions.createEl('button', { cls: 'ollama-chat-suggestions-refresh', text: 'Refresh' });
    refreshBtn.addEventListener('click', () => this.refresh(true));

    const meta = this.rootEl.createDiv({ cls: 'ollama-chat-suggestions-meta' });
    meta.setText(`Based on: ${activeFile.path}`);

    if (this.isLoading) {
      console.log('[Recommendations] Showing loading state');
      const list = this.rootEl.createDiv({ cls: 'ollama-chat-suggestions-grid' });
      for (let i = 0; i < 5; i++) {
        const card = list.createDiv({ cls: 'ollama-chat-suggestion-card loading' });
        card.createDiv({ cls: 'shimmer-line line-1' });
        card.createDiv({ cls: 'shimmer-line line-2' });
      }
      return;
    }

    if (this.errorMessage) {
      this.rootEl.createDiv({ cls: 'ollama-chat-suggestions-error', text: this.errorMessage });
      const retry = this.rootEl.createEl('button', { cls: 'ollama-chat-suggestions-retry', text: 'Try again' });
      retry.addEventListener('click', () => this.refresh(true));
      return;
    }

    if (this.questions.length === 0) return;

    const list = this.rootEl.createDiv({ cls: 'ollama-chat-suggestions-grid' });
    for (const q of this.questions) {
      const card = list.createDiv({ cls: 'ollama-chat-suggestion-card' });
      const text = card.createDiv({ cls: 'ollama-chat-suggestion-text' });
      text.setText(q);
      card.addEventListener('click', () => this.onAsk?.(q));
    }
  }

  private async fetchRecommendedQuestions(filePath: string, fileContent: string, signal?: AbortSignal): Promise<string[]> {
    const client = getOllamaClient();
    const model = this.plugin.settings.defaultModel || getDefaultModel();
    const system: ChatCompletionMessageParam = {
      role: 'system',
      content:
        'You are a thoughtful research assistant. Read the provided markdown article and generate exactly 5 concise, diverse, insight-provoking questions that deepen understanding, reveal gaps, or suggest new angles. If the content is not in English, write questions in the same language. Respond with a strict JSON array of 5 strings only, no preamble or trailing text.',
    };
    const user: ChatCompletionMessageParam = {
      role: 'user',
      content: [
        '<current_file>',
        `<name>${filePath}</name>`,
        '<content>',
        '```markdown',
        fileContent,
        '```',
        '</content>',
        '</current_file>',
        '',
        'Return only JSON: ["Q1", "Q2", "Q3", "Q4", "Q5"]',
      ].join('\n'),
    };

    const completion = await client.chat.completions.create({
      model,
      messages: [system, user],
      temperature: 0.7,
    }, { signal }) as any;

    const content = completion?.choices?.[0]?.message?.content ?? '';
    const parsed = this.parseQuestions(content);
    if (parsed.length >= 5) return parsed.slice(0, 5);
    return parsed.length > 0 ? parsed : [
      'What are the main arguments and how are they supported?',
      'Which assumptions or gaps could be clarified or evidenced better?',
      'How might the structure or flow be improved for readability?',
      'What counterpoints or alternative perspectives are missing?',
      'What next steps, experiments, or examples would strengthen this piece?',
    ];
  }

  private parseQuestions(raw: string): string[] {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return [];
    try {
      const start = trimmed.indexOf('[');
      const end = trimmed.lastIndexOf(']');
      if (start >= 0 && end > start) {
        const json = trimmed.slice(start, end + 1);
        const data = JSON.parse(json);
        if (Array.isArray(data)) return data.map((x) => String(x)).filter((s) => s.trim().length > 0);
      }
    } catch { /* ignore */ }
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim());
    const qs: string[] = [];
    for (const l of lines) {
      const m = l.match(/^(?:[-*]|\d+[.)])\s+(.*)$/);
      if (m && m[1]) qs.push(m[1]);
    }
    return qs;
  }
}

export default RecommendationsPanel;


