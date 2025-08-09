import { App, ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import getOllamaClient, { getDefaultModel } from './ollamaClient';
import type MyPlugin from './main';

export const VIEW_TYPE_OLLAMA_CHAT = 'ollama-chat-view';

export class OllamaChatView extends ItemView {
  private plugin: MyPlugin;
  private messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtnEl!: HTMLButtonElement;
  private isSending = false;

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

    const root = container.createDiv({ cls: 'ollama-chat' });
    this.messagesEl = root.createDiv({ cls: 'ollama-chat-messages' });

    const inputWrapper = root.createDiv({ cls: 'ollama-chat-input' });
    this.inputEl = inputWrapper.createEl('textarea', {
      cls: 'ollama-chat-textarea',
      placeholder: 'Type a message... (Enter to send, Shift+Enter for newline)',
    });
    this.inputEl.rows = 1;
    this.inputEl.addEventListener('input', () => this.autoResizeTextarea());
    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.sendBtnEl = inputWrapper.createEl('button', {
      cls: 'ollama-chat-send',
      text: 'Send',
    });
    this.sendBtnEl.addEventListener('click', () => this.sendMessage());

    this.renderMessages();
  }

  async onClose(): Promise<void> {}

  private autoResizeTextarea(): void {
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = `${this.inputEl.scrollHeight}px`;
  }

  private renderMessages(): void {
    this.messagesEl.empty();
    for (const msg of this.messages) {
      const bubble = this.messagesEl.createDiv({
        cls: `ollama-chat-message ${msg.role}`,
      });
      bubble.setText(msg.content);
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

    this.messages.push({ role: 'user', content: text });
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
      const completion = await client.chat.completions.create({
        model,
        messages: this.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const content = completion.choices?.[0]?.message?.content || '';
      this.messages.push({ role: 'assistant', content: content });
      this.renderMessages();
    } catch (error) {
      console.warn('Ollama chat error', error);
      new Notice('Chat failed. Check Ollama and model settings.');
    } finally {
      this.setSendingState(false);
    }
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


