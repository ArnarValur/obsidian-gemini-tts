import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// --- Settings Interface ---
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

// --- Main Plugin Class ---
export default class GeminiTTSPlugin extends Plugin {
	settings: GeminiTTSSettings;
	currentAudio: HTMLAudioElement | null = null;
	isPlaying: boolean = false;
	statusBarItem: HTMLElement;

	async onload() {
		await this.loadSettings();

		// 1. Status Bar
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar("Ready");

		// 2. Ribbon Icon
		this.addRibbonIcon('microphone', 'Read with Gemini TTS', (evt: MouseEvent) => {
			this.triggerTTS();
		});

		// 3. Command Palette
		this.addCommand({
			id: 'gemini-tts-read-note',
			name: 'Read active note',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.triggerTTS();
					}
					return true;
				}
				return false;
			}
		});
		
		this.addCommand({
			id: 'gemini-tts-stop',
			name: 'Stop playback',
			callback: () => {
				this.stopAudio();
			}
		});

		// 4. Settings Tab
		this.addSettingTab(new GeminiTTSSettingTab(this.app, this));
	}

	onunload() {
		this.stopAudio();
	}

	// --- Core Logic ---

	async triggerTTS() {
		// If already playing, stop.
		if (this.isPlaying) {
			this.stopAudio();
			return;
		}

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice('No active Markdown note found.');
			return;
		}

		const editor = activeView.editor;
		let textToRead = editor.getSelection();
		
		// If no selection, read the whole file
		if (!textToRead) {
			textToRead = editor.getValue();
		}

		if (!textToRead.trim()) {
			new Notice('Note is empty.');
			return;
		}

		// Clean text
		const cleanedText = this.cleanText(textToRead);
		
		if (!cleanedText.trim()) {
			new Notice('No readable text found after cleaning (e.g. only code blocks were present).');
			return;
		}

		this.updateStatusBar("Generating...");
		new Notice('Gemini TTS: Generating audio...');

		try {
			const audioData = await this.fetchGeminiAudio(cleanedText);
			this.playAudio(audioData);
		} catch (error) {
			console.error("Gemini TTS Error:", error);
			new Notice(`TTS Error: ${error.message}`);
			this.updateStatusBar("Error");
		}
	}

	cleanText(text: string): string {
		let clean = text;

		if (this.settings.skipCodeBlocks) {
			// Remove triple backtick code blocks
			clean = clean.replace(/```[\s\S]*?```/g, '');
			// Remove inline code
			clean = clean.replace(/`[^`]*`/g, '');
		}

		// General Markdown cleaning for better speech flow
		// Remove Frontmatter (YAML)
		clean = clean.replace(/^---[\s\S]*?---/, '');
		
		// Remove headers hash (keep text)
		clean = clean.replace(/^#+\s+/gm, '');
		
		// Remove bold/italic markers
		clean = clean.replace(/(\*\*|__)(.*?)\1/g, '$2');
		clean = clean.replace(/(\*|_)(.*?)\1/g, '$2');
		
		// Remove links [text](url) -> text
		clean = clean.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
		
		// Remove wikilinks [[link]] -> link
		clean = clean.replace(/\[\[([^\]]+)\]\]/g, '$1');

		return clean;
	}

	async fetchGeminiAudio(text: string): Promise<ArrayBuffer> {
		const apiKey = this.settings.apiKey;
		if (!apiKey) throw new Error("API Key is missing in settings.");

		const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.settings.modelName}:generateContent`;

		const payload = {
			contents: [{
				parts: [{
					text: text
				}]
			}],
			config: {
				responseModalities: ["AUDIO"],
				speechConfig: {
					voiceConfig: {
						prebuiltVoiceConfig: {
							voiceName: this.settings.voiceName
						}
					}
				}
			},
			systemInstruction: {
				parts: [
					{ text: this.settings.stylePrompt }
				]
			}
		};

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': apiKey
			},
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`API Request failed (${response.status}): ${errText}`);
		}

		const data = await response.json();
		
		// Validate response structure
		// Gemini returns audio in candidates[0].content.parts[0].inlineData
		const candidates = data.candidates;
		if (!candidates || candidates.length === 0) throw new Error("No content generated.");
		
		const parts = candidates[0].content?.parts;
		if (!parts || parts.length === 0) throw new Error("No parts in response.");

		// Check for inlineData (base64)
		const inlineData = parts[0].inlineData;
		if (inlineData && inlineData.mimeType.startsWith("audio")) {
			const base64 = inlineData.data;
			// Efficiently convert base64 to ArrayBuffer using atob and Uint8Array.from
			const binaryString = window.atob(base64);
			const bytes = Uint8Array.from(binaryString, char => char.charCodeAt(0));
			return bytes.buffer;
		}
		
		throw new Error("No audio data found in response.");
	}

	playAudio(buffer: ArrayBuffer) {
		// Use generic audio type to allow browser to detect format
		const blob = new Blob([buffer], { type: 'audio/*' });
		const url = window.URL.createObjectURL(blob);
		
		if (this.currentAudio) {
			this.currentAudio.pause();
		}

		this.currentAudio = new Audio(url);
		
		this.currentAudio.onplay = () => {
			this.isPlaying = true;
			this.updateStatusBar("Playing...");
		};
		
		this.currentAudio.onended = () => {
			this.isPlaying = false;
			this.updateStatusBar("Done");
			// Clean up blob URL to prevent memory leak
			window.URL.revokeObjectURL(url);
		};

		this.currentAudio.onerror = (e) => {
			console.error("Audio playback error", e);
			this.isPlaying = false;
			this.updateStatusBar("Error");
			new Notice("Error playing audio.");
			// Clean up blob URL even on error
			window.URL.revokeObjectURL(url);
		};

		this.currentAudio.play();
	}

	stopAudio() {
		if (this.currentAudio) {
			this.currentAudio.pause();
			// Clean up blob URL if audio was manually stopped
			if (this.currentAudio.src) {
				window.URL.revokeObjectURL(this.currentAudio.src);
			}
			this.currentAudio = null;
		}
		this.isPlaying = false;
		this.updateStatusBar("Stopped");
	}

	updateStatusBar(text: string) {
		this.statusBarItem.setText(`Gemini TTS: ${text}`);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// --- Settings Tab ---
class GeminiTTSSettingTab extends PluginSettingTab {
	plugin: GeminiTTSPlugin;

	constructor(app: App, plugin: GeminiTTSPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Gemini TTS Settings' });

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your Google Gemini API Key')
			.addText(text => {
				text
					.setPlaceholder('Enter key...')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});

		new Setting(containerEl)
			.setName('Model Name')
			.setDesc('Gemini Model ID (e.g., gemini-2.5-flash-tts)')
			.addText(text => text
				.setValue(this.plugin.settings.modelName)
				.onChange(async (value) => {
					this.plugin.settings.modelName = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Voice')
			.setDesc('Select the voice persona.')
			.addDropdown(drop => drop
				.addOption('Puck', 'Puck')
				.addOption('Charon', 'Charon')
				.addOption('Kore', 'Kore')
				.addOption('Fenrir', 'Fenrir')
				.addOption('Aoede', 'Aoede')
				.setValue(this.plugin.settings.voiceName)
				.onChange(async (value) => {
					this.plugin.settings.voiceName = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Style Prompt')
			.setDesc('Instructions for the voice (e.g. "Read cheerfully").')
			.addTextArea(text => text
				.setValue(this.plugin.settings.stylePrompt)
				.onChange(async (value) => {
					this.plugin.settings.stylePrompt = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Skip Code Blocks')
			.setDesc('Remove content inside ``` blocks before reading.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.skipCodeBlocks)
				.onChange(async (value) => {
					this.plugin.settings.skipCodeBlocks = value;
					await this.plugin.saveSettings();
				}));
	}
}
