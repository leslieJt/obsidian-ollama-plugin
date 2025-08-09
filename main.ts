import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import getOllamaClient, { getDefaultModel } from './ollamaClient';
import { registerChatView } from './chatView';

interface MyPluginSettings {
	defaultModel: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	defaultModel: getDefaultModel(),
};


export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();



        // Register chat view, ribbon and command
        registerChatView(this);


		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (!this.settings.defaultModel) {
			this.settings.defaultModel = getDefaultModel();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async fetchOllamaModels(): Promise<string[]> {
		try {
			const client = getOllamaClient();
			const list = await client.models.list();
			return list.data?.map((m: any) => m.id).filter(Boolean) ?? [];
		} catch (error) {
			console.warn('Failed to list Ollama models', error);
			new Notice('Failed to list Ollama models. Is Ollama running?');
			return [];
		}
	}

    // chat view activation handled in chatView.ts
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Default model dropdown (populated asynchronously)
		let dropdownRef: any;
		new Setting(containerEl)
			.setName('Default Ollama model')
			.setDesc('Choose the default model to use for completions')
			.addDropdown((dropdown) => {
				dropdownRef = dropdown;
				dropdown.addOption('', 'Loading...');
				dropdown.setDisabled(true);
				dropdown.onChange(async (value) => {
					this.plugin.settings.defaultModel = value;
					await this.plugin.saveSettings();
				});
			});

		void (async () => {
			const models = await this.plugin.fetchOllamaModels();
			try {
				if (dropdownRef?.selectEl) dropdownRef.selectEl.innerHTML = '';
				if (models.length === 0) {
					dropdownRef.addOption('', 'No models found');
					dropdownRef.setDisabled(true);
					return;
				}
				for (const modelId of models) dropdownRef.addOption(modelId, modelId);
				dropdownRef.setDisabled(false);
				const selected = models.includes(this.plugin.settings.defaultModel)
					? this.plugin.settings.defaultModel
					: models[0];
				dropdownRef.setValue(selected);
				if (this.plugin.settings.defaultModel !== selected) {
					this.plugin.settings.defaultModel = selected;
					await this.plugin.saveSettings();
				}
			} catch (e) {
				console.warn('Failed to initialize model dropdown', e);
			}
		})();

		new Setting(containerEl)
			.setName('Refresh models')
			.setDesc('Reload the installed Ollama models list')
			.addButton((btn) =>
				btn.setButtonText('Refresh').onClick(async () => {
					btn.setDisabled(true);
					const models = await this.plugin.fetchOllamaModels();
					if (dropdownRef?.selectEl) dropdownRef.selectEl.innerHTML = '';
					if (models.length === 0) {
						dropdownRef.addOption('', 'No models found');
						dropdownRef.setDisabled(true);
					} else {
						for (const modelId of models) dropdownRef.addOption(modelId, modelId);
						dropdownRef.setDisabled(false);
						const selected = models.includes(this.plugin.settings.defaultModel)
							? this.plugin.settings.defaultModel
							: models[0];
						dropdownRef.setValue(selected);
						this.plugin.settings.defaultModel = selected;
						await this.plugin.saveSettings();
					}
					btn.setDisabled(false);
				}),
			);
	}
}
