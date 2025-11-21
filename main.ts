import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	ButtonComponent
} from 'obsidian';

interface GeminiTTSSettings {
	apiKey: string;
	modelName: string;
	voiceName: string;
	stylePrompt: string;
	skipCodeBlocks: boolean;
}

const DEFAULT_SETTINGS: GeminiTTSSettings = {
	apiKey: '',
	modelName: 'gemini-2.5-flash-tts',
	voiceName: 'Puck',
	stylePrompt: 'Read clearly and naturally.',
	skipCodeBlocks: true
}

export default class GeminiTTSPlugin extends Plugin {
	settings: GeminiTTSSettings;
	statusBarItem: HTMLElement;
	currentAudio: HTMLAudioElement | null = null;
	isPlaying: boolean = false;

	async onload() {
		await this.loadSettings();

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText('Gemini TTS');

		// Add ribbon icon
		const ribbonIconEl = this.addRibbonIcon('microphone', 'Gemini TTS', async (evt: MouseEvent) => {
			await this.readActiveNote();
		});
		ribbonIconEl.addClass('gemini-tts-ribbon-class');

		// Add command to read active note
		this.addCommand({
			id: 'read-active-note',
			name: 'Read active note',
			callback: async () => {
				await this.readActiveNote();
			}
		});

		// Add command to stop playback
		this.addCommand({
			id: 'stop-playback',
			name: 'Stop playback',
			callback: () => {
				this.stopPlayback();
			}
		});

		// Add settings tab
		this.addSettingTab(new GeminiTTSSettingTab(this.app, this));
	}

	onunload() {
		this.stopPlayback();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	cleanText(text: string): string {
		let cleanedText = text;

		// Remove frontmatter (YAML)
		cleanedText = cleanedText.replace(/^---\n[\s\S]*?\n---\n/m, '');

		// Remove code blocks if skipCodeBlocks is enabled
		if (this.settings.skipCodeBlocks) {
			// Remove triple backtick code blocks
			cleanedText = cleanedText.replace(/```[\s\S]*?```/g, '');
			// Remove inline code
			cleanedText = cleanedText.replace(/`[^`]+`/g, '');
		}

		// Remove headers (# symbols)
		cleanedText = cleanedText.replace(/^#{1,6}\s+/gm, '');

		// Remove bold markers
		cleanedText = cleanedText.replace(/\*\*([^*]+)\*\*/g, '$1');
		cleanedText = cleanedText.replace(/__([^_]+)__/g, '$1');

		// Remove italic markers
		cleanedText = cleanedText.replace(/\*([^*]+)\*/g, '$1');
		cleanedText = cleanedText.replace(/_([^_]+)_/g, '$1');

		// Convert markdown links [text](url) to just text
		cleanedText = cleanedText.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

		// Convert wikilinks [[text]] to just text
		cleanedText = cleanedText.replace(/\[\[([^\]]+)\]\]/g, '$1');

		return cleanedText.trim();
	}

	async fetchGeminiAudio(text: string): Promise<ArrayBuffer> {
		const { apiKey, modelName, voiceName, stylePrompt } = this.settings;

		if (!apiKey) {
			throw new Error('API key is not set. Please configure it in settings.');
		}

		const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

		const payload = {
			contents: [{ parts: [{ text: text }] }],
			config: {
				responseModalities: ["AUDIO"],
				speechConfig: {
					voiceConfig: {
						prebuiltVoiceConfig: { voiceName: voiceName }
					}
				}
			},
			systemInstruction: { parts: [{ text: stylePrompt }] }
		};

		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(payload)
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`API request failed: ${response.status} ${response.statusText}\n${errorText}`);
			}

			const data = await response.json();

			if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
				throw new Error('Invalid response structure from API');
			}

			const base64Audio = data.candidates[0].content.parts[0].inlineData?.data;
			if (!base64Audio) {
				throw new Error('No audio data in response');
			}

			// Convert base64 to ArrayBuffer
			const binaryString = atob(base64Audio);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}
			return bytes.buffer;
		} catch (error) {
			throw new Error(`Failed to fetch audio: ${error.message}`);
		}
	}

	async readActiveNote() {
		// Stop any currently playing audio
		this.stopPlayback();

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice('No active note found');
			return;
		}

		const noteContent = activeView.editor.getValue();
		if (!noteContent || noteContent.trim().length === 0) {
			new Notice('Note is empty');
			return;
		}

		const cleanedText = this.cleanText(noteContent);
		if (!cleanedText || cleanedText.trim().length === 0) {
			new Notice('No readable text found in note');
			return;
		}

		let audioUrl: string | null = null;

		const cleanupAudio = () => {
			if (audioUrl) {
				URL.revokeObjectURL(audioUrl);
				audioUrl = null;
			}
			this.isPlaying = false;
		};

		try {
			// Update status bar
			this.statusBarItem.setText('Gemini TTS: Generating...');
			new Notice('Generating audio...');

			// Fetch audio from Gemini API
			const audioBuffer = await this.fetchGeminiAudio(cleanedText);

			// Convert ArrayBuffer to Blob and create URL
			const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
			audioUrl = URL.createObjectURL(audioBlob);

			// Create and play audio
			this.currentAudio = new Audio(audioUrl);
			this.isPlaying = true;

			this.currentAudio.addEventListener('ended', () => {
				this.statusBarItem.setText('Gemini TTS: Stopped');
				cleanupAudio();
			});

			this.currentAudio.addEventListener('error', (e) => {
				new Notice('Error playing audio');
				this.statusBarItem.setText('Gemini TTS: Error');
				cleanupAudio();
			});

			this.statusBarItem.setText('Gemini TTS: Playing...');
			await this.currentAudio.play();
			new Notice('Playing audio');
		} catch (error) {
			new Notice(`Error: ${error.message}`);
			this.statusBarItem.setText('Gemini TTS: Error');
			cleanupAudio();
			console.error('Gemini TTS Error:', error);
		}
	}

	stopPlayback() {
		if (this.currentAudio) {
			this.currentAudio.pause();
			this.currentAudio.currentTime = 0;
			this.currentAudio = null;
			this.isPlaying = false;
			this.statusBarItem.setText('Gemini TTS: Stopped');
			new Notice('Playback stopped');
		}
	}
}

class GeminiTTSSettingTab extends PluginSettingTab {
	plugin: GeminiTTSPlugin;

	constructor(app: App, plugin: GeminiTTSPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.addClass('gemini-tts-settings');

		containerEl.createEl('h2', { text: 'Gemini TTS Settings' });

		// API Key setting
		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your Google Gemini API key')
			.addText(text => {
				text
					.setPlaceholder('Enter your API key')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
				// Make the API key field a password field
				text.inputEl.type = 'password';
			});

		// Model Name setting
		new Setting(containerEl)
			.setName('Model Name')
			.setDesc('The Gemini model to use for TTS')
			.addText(text => text
				.setPlaceholder('gemini-2.5-flash-tts')
				.setValue(this.plugin.settings.modelName)
				.onChange(async (value) => {
					this.plugin.settings.modelName = value;
					await this.plugin.saveSettings();
				})
			);

		// Voice Name setting
		new Setting(containerEl)
			.setName('Voice Name')
			.setDesc('Select the voice for text-to-speech')
			.addDropdown(dropdown => dropdown
				.addOption('Puck', 'Puck')
				.addOption('Charon', 'Charon')
				.addOption('Kore', 'Kore')
				.addOption('Fenrir', 'Fenrir')
				.addOption('Aoede', 'Aoede')
				.setValue(this.plugin.settings.voiceName)
				.onChange(async (value) => {
					this.plugin.settings.voiceName = value;
					await this.plugin.saveSettings();
				})
			);

		// Style Prompt setting
		new Setting(containerEl)
			.setName('Style Prompt')
			.setDesc('Instructions for how the text should be read')
			.addTextArea(text => text
				.setPlaceholder('Read clearly and naturally.')
				.setValue(this.plugin.settings.stylePrompt)
				.onChange(async (value) => {
					this.plugin.settings.stylePrompt = value;
					await this.plugin.saveSettings();
				})
			);

		// Skip Code Blocks setting
		new Setting(containerEl)
			.setName('Skip Code Blocks')
			.setDesc('Skip reading code blocks and inline code')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.skipCodeBlocks)
				.onChange(async (value) => {
					this.plugin.settings.skipCodeBlocks = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
