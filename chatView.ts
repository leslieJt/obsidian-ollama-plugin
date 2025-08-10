import { App, ItemView, Notice, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import getOllamaClient, { getDefaultModel } from './ollamaClient';
import type MyPlugin from './main';
import RecommendationsPanel from './recommendations';

export const VIEW_TYPE_OLLAMA_CHAT = 'ollama-chat-view';

export type ConversationMessageType = 'request' | 'response';

export class OllamaChatView extends ItemView {
  private plugin: MyPlugin;
  private messages: Array<{ type: ConversationMessageType; content: string; model?: string }> = [];
  private messagesEl!: HTMLElement;
  private suggestionsEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtnEl!: HTMLButtonElement;
  private resetBtnEl!: HTMLButtonElement;
  private isSending = false;
  private activeResponseBubble: HTMLElement | null = null;
  private activeResponseContentEl: HTMLElement | null = null;
  private lastStreamRenderMs = 0;
  private static readonly MIN_TEXTAREA_HEIGHT_PX = 36;
  private currentAbortController: AbortController | null = null;
  private recommendationsPanel: RecommendationsPanel | null = null;
  private suggestionAnchorIndex: number = 0;
  private currentFilePath: string | null = null;
  private fileChangeListener: () => void;
  private headerEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
    super(leaf);
    this.plugin = plugin;
    
    // Create file change listener
    this.fileChangeListener = () => {
      this.onActiveFileChanged();
    };
  }

  getViewType(): string {
    return VIEW_TYPE_OLLAMA_CHAT;
  }

  getDisplayText(): string {
    return 'Ollama Chat';
  }

  getIcon(): string {
    return 'message-square';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    (container as HTMLElement).addClass('ollama-chat-container');

    const root = (container as HTMLElement).createDiv({ cls: 'ollama-chat' });
    
    // Add header showing current file
    this.headerEl = root.createDiv({ cls: 'ollama-chat-header' });
    this.updateHeaderText();
    
    // Messages list (scrollable)
    this.messagesEl = root.createDiv({ cls: 'ollama-chat-messages' });
    // Suggestions panel lives at the bottom of the messages list so it scrolls with history
    this.suggestionsEl = this.messagesEl.createDiv({ cls: 'ollama-chat-suggestions' });

    const inputWrapper = root.createDiv({ cls: 'ollama-chat-input' });
    this.inputEl = inputWrapper.createEl('textarea', {
      cls: 'ollama-chat-textarea',
      placeholder: 'Type a message... (Enter to send, Cmd+Enter for newline)',
    });
    this.inputEl.rows = 1;
    this.inputEl.addEventListener('input', () => this.autoResizeTextarea());
    this.inputEl.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.isComposing) return; // ignore IME composition
        const isEnter = e.key === 'Enter' || (e as any).code === 'Enter' || (e as any).keyCode === 13;
        if (!isEnter) return;
        if (e.metaKey) {
          // Cmd+Enter → allow newline (default behavior)
          return;
        }
        // Enter → send
        e.preventDefault();
        e.stopPropagation();
        this.sendMessage();
      },
      true,
    );
    // Ensure correct initial height
    this.autoResizeTextarea();

    this.sendBtnEl = inputWrapper.createEl('button', {
      cls: 'ollama-chat-send',
      text: 'Send',
    });
    this.sendBtnEl.addEventListener('click', () => this.sendMessage());

    this.resetBtnEl = inputWrapper.createEl('button', {
      cls: 'ollama-chat-reset',
      text: 'Reset',
    });
    this.resetBtnEl.addEventListener('click', () => this.resetConversation());
    
    // Add clear all history button
    const clearAllBtnEl = inputWrapper.createEl('button', {
      cls: 'ollama-chat-clear-all',
      text: 'Clear All History',
    });
    clearAllBtnEl.addEventListener('click', () => this.clearAllHistory());
    
    // Initialize recommendations panel first
    this.recommendationsPanel = new RecommendationsPanel(this.app, this.plugin);
    this.recommendationsPanel.mount(this.suggestionsEl, {
      prefill: (q: string) => {
        this.inputEl.value = q;
        this.autoResizeTextarea();
        this.inputEl.focus();
      },
      ask: (q: string) => {
        this.inputEl.value = q;
        this.autoResizeTextarea();
        void this.sendMessage();
      },
    });

    // Now initialize with current active file
    this.onActiveFileChanged();

    // Register file change listener
    this.app.workspace.on('file-open', this.fileChangeListener);
    this.app.workspace.on('active-leaf-change', this.fileChangeListener);

    // Anchor suggestions after any existing history
    this.suggestionAnchorIndex = this.messages.length;

    this.renderMessages();
    this.updateResetButtonVisibility(); // Set initial reset button visibility

    // Refresh recommendations panel only if enabled
    if (this.plugin.settings.enableRecommendations) {
      void this.recommendationsPanel.refresh();
    }
  }

  async onClose(): Promise<void> {
    try { this.recommendationsPanel?.destroy(); } catch { /* no-op */ }
    this.recommendationsPanel = null;
    
    // Remove file change listeners
    this.app.workspace.off('file-open', this.fileChangeListener);
    this.app.workspace.off('active-leaf-change', this.fileChangeListener);
  }

  private autoResizeTextarea(): void {
    const el = this.inputEl;
    el.style.height = 'auto';
    const target = Math.max(
      el.scrollHeight,
      OllamaChatView.MIN_TEXTAREA_HEIGHT_PX,
    );
    el.style.height = `${target}px`;
  }

  private renderMessages(): void {
    // Temporarily remove suggestions to preserve them
    const suggestionsNode = this.suggestionsEl;
    if (suggestionsNode && suggestionsNode.parentNode) {
      suggestionsNode.parentNode.removeChild(suggestionsNode);
    }
    
    this.messagesEl.empty();

    const anchor = Math.min(Math.max(this.suggestionAnchorIndex, 0), this.messages.length);
    const before = this.messages.slice(0, anchor);
    const after = this.messages.slice(anchor);

    const renderList = (list: Array<{ type: ConversationMessageType; content: string; model?: string }>) => {
      for (const msg of list) {
        const isRequest = msg.type === 'request';
        const wrapper = this.messagesEl.createDiv({
          cls: `ollama-chat-message ${isRequest ? 'request' : 'response'}`,
        });
        const label = wrapper.createDiv({ cls: 'ollama-chat-label' });
        label.setText(isRequest ? 'Request' : 'Response');
        if (!isRequest && msg.model) {
          const tip = label.createSpan({ cls: 'ollama-chat-model-tip' });
          tip.setText(` (${msg.model})`);
        }
        const bubble = wrapper.createDiv({ cls: 'ollama-chat-bubble' });
        const contentEl = bubble.createDiv({ cls: 'ollama-chat-bubble-content' });
        if (isRequest) {
          contentEl.setText(msg.content);
        } else {
          this.renderMarkdownTo(contentEl, msg.content).then(() => {
            this.enhanceRenderedContent(contentEl);
          });
          this.attachResponseActions(bubble, contentEl, msg);
        }
      }
    };

    // Render history before suggestions
    renderList(before);
    // Re-insert suggestions node
    if (suggestionsNode) this.messagesEl.appendChild(suggestionsNode);
    // Render new messages after suggestions
    renderList(after);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  // Suggestions UI moved into RecommendationsPanel

  private setSendingState(sending: boolean): void {
    this.isSending = sending;
    this.sendBtnEl.toggleClass('is-loading', sending);
    this.sendBtnEl.disabled = sending;
    this.inputEl.disabled = sending;
  }

  // Fetching/parsing moved to RecommendationsPanel

  private async sendMessage(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.isSending) return;

    this.messages.push({ type: 'request', content: text });
    // persist after adding user message
    try {
      if (this.currentFilePath) {
        await this.plugin.setChatHistory?.(this.messages, this.currentFilePath);
      }
    } catch (_e) {
      // no-op
    }
    // Log request to console with the model that will be used
    try {
      const model = this.plugin.settings.defaultModel || getDefaultModel();
      console.log('[Ollama Chat] → Request', { model, content: text });
    } catch (_e) {
      // no-op
    }
    this.inputEl.value = '';
    this.autoResizeTextarea();
    this.renderMessages();
    this.updateResetButtonVisibility(); // Update reset button visibility after adding message

    await this.generateAssistantResponse();
  }

  private async generateAssistantResponse(): Promise<void> {
    this.setSendingState(true);
    try {
      const client = getOllamaClient();
      const model = this.plugin.settings.defaultModel || getDefaultModel();
      const responseMsg = { type: 'response' as ConversationMessageType, content: '', model };
      this.messages.push(responseMsg);
      this.renderMessages();
      // capture bubble element for incremental updates
      const lastMsgEl = this.messagesEl.lastElementChild as HTMLElement | null;
      this.activeResponseBubble = lastMsgEl?.querySelector('.ollama-chat-bubble') as
        | HTMLElement
        | null;
      this.activeResponseContentEl = lastMsgEl?.querySelector(
        '.ollama-chat-bubble-content',
      ) as HTMLElement | null;

      const fullHistory: ChatCompletionMessageParam[] = this.messages
        // exclude the last assistant placeholder while content is empty
        .filter((m, idx, arr) => !(m.type === 'response' && m.content === '' && idx === arr.length - 1))
        .map((m) =>
          m.type === 'request'
            ? ({ role: 'user' as const, content: m.content })
            : ({ role: 'assistant' as const, content: m.content }),
        );

      // Construct messages to send with a fixed system prompt and the active file content as the first user message
      let messagesToSend: ChatCompletionMessageParam[] = [];
      const systemPrompt: ChatCompletionMessageParam = {
        role: 'system',
        content:
          'You are an expert article analyst. Given an article, you analyze its structure, key arguments, evidence, tone, and audience; identify gaps, contradictions, and assumptions; propose fresh perspectives and reframings; suggest improvements; and produce helpful artifacts (outline, abstract, title options, tags, key takeaways, questions, and next steps). Prefer concise, well-structured responses.',
      };
      messagesToSend.push(systemPrompt);

      try {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          const fileContents = await this.app.vault.read(activeFile);
          const wrapped = [
            '<current_file>',
            `<name>${activeFile.path}</name>`,
            '<content>',
            '```markdown',
            fileContents,
            '```',
            '</content>',
            '</current_file>',
          ].join('\n');
          const fileAsUser: ChatCompletionMessageParam = {
            role: 'user',
            content: wrapped,
          };
          messagesToSend.push(fileAsUser);
        }
      } catch (_e) {
        // no-op: if reading fails, proceed without file context
      }

      messagesToSend = [...messagesToSend, ...fullHistory];

      // Log the exact history being sent to the model
      try {
        console.log('[Ollama Chat] → History (to model)', { model, messages: messagesToSend });
      } catch (_e) {
        // no-op
      }

      this.currentAbortController = new AbortController();
      const stream = (await client.chat.completions.create({
        model,
        stream: true,
        messages: messagesToSend,
      }, { signal: this.currentAbortController.signal })) as any;

      for await (const part of stream) {
        const delta = part?.choices?.[0]?.delta?.content ?? part?.choices?.[0]?.message?.content ?? '';
        if (!delta) continue;
        responseMsg.content += delta;
        // Throttle markdown re-render to ~20fps
        const now = performance.now();
        if (now - this.lastStreamRenderMs > 50) {
          if (this.activeResponseContentEl) {
            this.renderMarkdownTo(this.activeResponseContentEl, responseMsg.content, true).then(() => {
              if (this.activeResponseContentEl) this.enhanceRenderedContent(this.activeResponseContentEl);
            });
            this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
          } else {
            this.renderMessages();
          }
          this.lastStreamRenderMs = now;
        }
      }
      // Log final response contents
      console.log('[Ollama Chat] ← Response', { model, content: responseMsg.content });
      // Final render to ensure completion
      if (this.activeResponseContentEl) {
        this.renderMarkdownTo(this.activeResponseContentEl, responseMsg.content, true).then(() => {
          if (this.activeResponseContentEl) this.enhanceRenderedContent(this.activeResponseContentEl);
        });
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }

      // persist after completing assistant response
      try {
        if (this.currentFilePath) {
          await this.plugin.setChatHistory?.(this.messages, this.currentFilePath);
        }
      } catch (_e) {
        // no-op
      }
      this.updateResetButtonVisibility(); // Update reset button visibility after assistant response
    } catch (error) {
      console.warn('Ollama chat error', error);
      const message = (error as any)?.message ?? '';
      const name = (error as any)?.name ?? '';
      const wasAborted = name === 'AbortError' || /abort/i.test(message);
      if (!wasAborted) {
        new Notice('Chat failed. Check Ollama and model settings.');
      }
    } finally {
      this.activeResponseBubble = null;
      this.activeResponseContentEl = null;
      this.setSendingState(false);
      this.currentAbortController = null;
    }
  }

  private async renderMarkdownTo(targetEl: HTMLElement, markdown: string, replace = false): Promise<void> {
    if (replace) targetEl.empty();
    await MarkdownRenderer.render(
      this.app,
      markdown,
      targetEl,
      this.app.workspace.getActiveFile()?.path ?? '',
      this,
    );
  }

  private attachResponseActions(bubble: HTMLElement, contentEl: HTMLElement, msg: { content: string }): void {
    let actions = bubble.querySelector('.ollama-chat-actions') as HTMLElement | null;
    if (!actions) actions = bubble.createDiv({ cls: 'ollama-chat-actions' });

    actions.empty();

    const copyBtn = actions.createEl('button', { cls: 'ollama-chat-action copy', text: 'Copy' });
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(msg.content);
        new Notice('Copied response to clipboard');
      } catch (_e) {
        // Fallback: try selecting and copying
        try {
          const range = document.createRange();
          range.selectNodeContents(contentEl);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.execCommand('copy');
          selection?.removeAllRanges();
          new Notice('Copied response');
        } catch (e) {
          console.warn('Copy failed', e);
          new Notice('Failed to copy');
        }
      }
    });

    const copyMdBtn = actions.createEl('button', { cls: 'ollama-chat-action copy-md', text: 'Copy as Markdown' });
    copyMdBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(msg.content);
        new Notice('Copied markdown to clipboard');
      } catch (e) {
        console.warn('Copy markdown failed', e);
        new Notice('Failed to copy markdown');
      }
    });
  }

  private enhanceRenderedContent(contentEl: HTMLElement): void {
    // Improve code blocks: add copy button and better spacing
    const pres = Array.from(contentEl.querySelectorAll('pre'));
    for (const pre of pres) {
      const code = pre.querySelector('code');
      if (!code) continue;
      let wrapper = pre.parentElement;
      if (!wrapper || !wrapper.classList.contains('ollama-code-block')) {
        wrapper = document.createElement('div');
        wrapper.className = 'ollama-code-block';
        pre.replaceWith(wrapper);
        wrapper.appendChild(pre);
      }
      if (!wrapper.querySelector('.ollama-code-copy')) {
        const btn = document.createElement('button');
        btn.className = 'ollama-code-copy';
        btn.textContent = 'Copy code';
        btn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(code.textContent ?? '');
            new Notice('Code copied');
          } catch (e) {
            console.warn('Copy code failed', e);
            new Notice('Failed to copy code');
          }
        });
        wrapper.insertBefore(btn, wrapper.firstChild);
      }
    }
  }

  private async resetConversation(): Promise<void> {
    // Abort any in-flight request
    try {
      this.currentAbortController?.abort();
    } catch (_e) {
      // no-op
    }
    this.activeResponseBubble = null;
    this.activeResponseContentEl = null;
    this.setSendingState(false);
    this.messages = [];
    this.suggestionAnchorIndex = 0;
    this.renderMessages();
    this.updateResetButtonVisibility(); // Update reset button visibility after resetting
    try {
      if (this.currentFilePath) {
        await this.plugin.setChatHistory?.([], this.currentFilePath);
      }
    } catch (_e) {
      // no-op
    }
  }

  private async clearAllHistory(): Promise<void> {
    // Abort any in-flight request
    try {
      this.currentAbortController?.abort();
    } catch (_e) {
      // no-op
    }
    this.activeResponseBubble = null;
    this.activeResponseContentEl = null;
    this.setSendingState(false);
    
    // Clear all chat history across all files
    try {
      await this.plugin.clearAllChatHistory?.();
      new Notice('All chat history cleared');
    } catch (_e) {
      new Notice('Failed to clear all chat history');
    }
    
    // Clear current conversation
    this.messages = [];
    this.suggestionAnchorIndex = 0;
    this.renderMessages();
    this.updateResetButtonVisibility(); // Update reset button visibility after clearing all history
  }

  private getCurrentFileDisplayName(): string {
    if (!this.currentFilePath) return 'No file';
    const fileName = this.currentFilePath.split('/').pop() || this.currentFilePath;
    return fileName;
  }

  private updateResetButtonText(): void {
    const fileName = this.getCurrentFileDisplayName();
    this.resetBtnEl.setText(`Reset (${fileName})`);
  }

  private updateHeaderText(): void {
    if (!this.headerEl) return;
    const fileName = this.getCurrentFileDisplayName();
    this.headerEl.setText(`Chat: ${fileName}`);
  }

  private updateResetButtonVisibility(): void {
    if (!this.resetBtnEl) return;
    
    // Check if there are messages for the current file
    const hasHistoryMessages = this.currentFilePath && this.messages.length > 0;
    
    // Hide/show the reset button based on whether there are history messages
    if (hasHistoryMessages) {
      this.resetBtnEl.style.display = 'block';
      this.resetBtnEl.removeClass('hidden');
    } else {
      this.resetBtnEl.style.display = 'none';
      this.resetBtnEl.addClass('hidden');
    }
  }

  private ensureSuggestionsVisible(): void {
    // Make sure the suggestions element is properly positioned and visible
    if (this.suggestionsEl && this.messagesEl) {
      // Ensure suggestions are at the bottom of messages
      if (!this.messagesEl.contains(this.suggestionsEl)) {
        console.log('[Ollama Chat] Re-attaching suggestions element');
        this.messagesEl.appendChild(this.suggestionsEl);
      }
      
      // Make sure suggestions are visible
      this.suggestionsEl.style.display = 'block';
      
      console.log('[Ollama Chat] Suggestions element status:', {
        visible: this.suggestionsEl.style.display !== 'none',
        inDOM: this.messagesEl.contains(this.suggestionsEl),
        children: this.suggestionsEl.children.length
      });
    } else {
      console.warn('[Ollama Chat] Missing suggestions or messages elements:', {
        suggestionsEl: !!this.suggestionsEl,
        messagesEl: !!this.messagesEl
      });
    }
  }

  private onActiveFileChanged(): void {
    const activeFile = this.app.workspace.getActiveFile();
    const newFilePath = activeFile?.path || null;
    
    console.log('[Ollama Chat] File changed:', { from: this.currentFilePath, to: newFilePath });
    
    // If file path changed, save current conversation and load new one
    if (this.currentFilePath !== newFilePath) {
      // Save current conversation if we have one
      if (this.currentFilePath && this.messages.length > 0) {
        this.plugin.setChatHistory(this.messages, this.currentFilePath).catch(console.warn);
      }
      
      // Update current file path
      this.currentFilePath = newFilePath;
      
      // Load conversation history for new file
      this.loadConversationHistory();
      
      // Update UI elements
      this.updateResetButtonText();
      this.updateHeaderText();
      this.updateResetButtonVisibility(); // Update reset button visibility
      
      // Refresh recommendations panel for the new file only if enabled
      if (this.recommendationsPanel && this.plugin.settings.enableRecommendations) {
        console.log('[Ollama Chat] Refreshing recommendations panel');
        // Small delay to ensure file change is fully processed
        setTimeout(() => {
          if (this.recommendationsPanel) {
            void this.recommendationsPanel.refresh();
          }
        }, 100);
      } else if (this.recommendationsPanel) {
        console.log('[Ollama Chat] Recommendations disabled, skipping refresh');
      } else {
        console.warn('[Ollama Chat] No recommendations panel available');
      }
      
      // Ensure suggestions element is visible and properly positioned
      this.ensureSuggestionsVisible();
    }
  }

  private loadConversationHistory(): void {
    if (this.currentFilePath) {
      try {
        const persisted = this.plugin.getChatHistory(this.currentFilePath);
        if (Array.isArray(persisted) && persisted.length > 0) {
          this.messages = persisted.map((m) => ({ ...m }));
        } else {
          this.messages = [];
        }
      } catch (_e) {
        this.messages = [];
      }
    } else {
      this.messages = [];
    }
    
    // Reset suggestion anchor
    this.suggestionAnchorIndex = this.messages.length;
    
    // Re-render messages
    this.renderMessages();
    this.updateResetButtonVisibility(); // Update reset button visibility after loading history
  }
}

export function registerChatView(plugin: MyPlugin): void {
  plugin.registerView(VIEW_TYPE_OLLAMA_CHAT, (leaf) => new OllamaChatView(leaf, plugin));

  plugin.addRibbonIcon('message-square', 'Open Ollama Chat', () => {
    activateOllamaChatView(plugin);
  });

  plugin.addCommand({
    id: 'open-ollama-chat',
    name: 'Open Ollama Chat',
    callback: () => activateOllamaChatView(plugin),
  });
}

export async function activateOllamaChatView(plugin: MyPlugin): Promise<void> {
  const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_OLLAMA_CHAT);
  if (leaves.length > 0) {
    plugin.app.workspace.revealLeaf(leaves[0]);
    return;
  }
  const leaf = plugin.app.workspace.getRightLeaf(false) ?? plugin.app.workspace.getLeaf(true);
  await leaf.setViewState({ type: VIEW_TYPE_OLLAMA_CHAT, active: true });
  const [created] = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_OLLAMA_CHAT);
  if (created) plugin.app.workspace.revealLeaf(created);
}


