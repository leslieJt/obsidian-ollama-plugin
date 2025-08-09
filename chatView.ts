import { App, ItemView, Notice, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';
import getOllamaClient, { getDefaultModel } from './ollamaClient';
import type MyPlugin from './main';

export const VIEW_TYPE_OLLAMA_CHAT = 'ollama-chat-view';

export type ConversationMessageType = 'request' | 'response';

export class OllamaChatView extends ItemView {
  private plugin: MyPlugin;
  private messages: Array<{ type: ConversationMessageType; content: string; model?: string }> = [];
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtnEl!: HTMLButtonElement;
  private isSending = false;
  private activeResponseBubble: HTMLElement | null = null;
  private activeResponseContentEl: HTMLElement | null = null;
  private lastStreamRenderMs = 0;
  private static readonly MIN_TEXTAREA_HEIGHT_PX = 36;

  constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
    super(leaf);
    this.plugin = plugin;
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
    this.messagesEl = root.createDiv({ cls: 'ollama-chat-messages' });

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

    this.renderMessages();
  }

  async onClose(): Promise<void> {}

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
    this.messagesEl.empty();
    for (const msg of this.messages) {
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
        // Render response as markdown
        this.renderMarkdownTo(contentEl, msg.content);
      }
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private setSendingState(sending: boolean): void {
    this.isSending = sending;
    this.sendBtnEl.toggleClass('is-loading', sending);
    this.sendBtnEl.disabled = sending;
    this.inputEl.disabled = sending;
  }

  private async sendMessage(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.isSending) return;

    this.messages.push({ type: 'request', content: text });
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

      const stream = (await client.chat.completions.create({
        model,
        stream: true,
        messages: this.messages.map((m) => ({
          role: m.type === 'request' ? 'user' : 'assistant',
          content: m.content,
        })),
      })) as any;

      for await (const part of stream) {
        const delta = part?.choices?.[0]?.delta?.content ?? part?.choices?.[0]?.message?.content ?? '';
        if (!delta) continue;
        responseMsg.content += delta;
        // Throttle markdown re-render to ~20fps
        const now = performance.now();
        if (now - this.lastStreamRenderMs > 50) {
          if (this.activeResponseContentEl) {
            this.renderMarkdownTo(this.activeResponseContentEl, responseMsg.content, true);
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
        this.renderMarkdownTo(this.activeResponseContentEl, responseMsg.content, true);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
    } catch (error) {
      console.warn('Ollama chat error', error);
      new Notice('Chat failed. Check Ollama and model settings.');
    } finally {
      this.activeResponseBubble = null;
      this.activeResponseContentEl = null;
      this.setSendingState(false);
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


