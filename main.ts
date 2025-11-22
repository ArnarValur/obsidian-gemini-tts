import {
	App,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting
} from 'obsidian';

interface GeminiTTSSettings {
	apiKey: string;
	modelName: string;
	voiceName: string;
	stylePrompt: string;
	skipCodeBlocks: boolean;
	saveAudioFiles: boolean;
	audioOutputFolder: string;
}

const DEFAULT_SETTINGS: GeminiTTSSettings = {
	apiKey: '',
	modelName: 'gemini-2.5-flash-preview-tts',
	voiceName: 'Puck',
	stylePrompt: 'Read clearly and naturally.',
	skipCodeBlocks: true,
	saveAudioFiles: false,
	audioOutputFolder: 'TTS Audio'
}

export default class GeminiTTSPlugin extends Plugin {
	settings: GeminiTTSSettings;
	statusBarItem: HTMLElement;
	currentAudio: HTMLAudioElement | null = null;
	currentAudioBlob: Blob | null = null;
	isPlaying: boolean = false;
	isPaused: boolean = false;
	audioPlayerView: HTMLElement | null = null;

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

		// Add command to pause/resume playback
		this.addCommand({
			id: 'pause-resume-playback',
			name: 'Pause/Resume playback',
			callback: () => {
				this.togglePauseResume();
			}
		});

		// Add command to save current audio
		this.addCommand({
			id: 'save-current-audio',
			name: 'Save current audio to file',
			callback: () => {
				this.saveCurrentAudio();
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

		// Remove frontmatter (YAML) - handle both start and end of file cases
		cleanedText = cleanedText.replace(/^---\n[\s\S]*?\n---(\n|$)/m, '');

		// Remove code blocks if skipCodeBlocks is enabled
		if (this.settings.skipCodeBlocks) {
			// Remove triple backtick code blocks
			cleanedText = cleanedText.replace(/```[\s\S]*?```/g, '');
			// Remove inline code
			cleanedText = cleanedText.replace(/`[^`]+`/g, '');
		}

		// Remove headers (# symbols) but keep text
		cleanedText = cleanedText.replace(/^#{1,6}\s+(.*)$/gm, '$1');

		// Remove bold markers
		cleanedText = cleanedText.replace(/\*\*([^*]+)\*\*/g, '$1');
		cleanedText = cleanedText.replace(/__([^_]+)__/g, '$1');

		// Remove italic markers
		cleanedText = cleanedText.replace(/\*([^*]+)\*/g, '$1');
		cleanedText = cleanedText.replace(/_([^_]+)_/g, '$1');

		// Convert markdown links [text](url) to just text
		cleanedText = cleanedText.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

		// Convert wikilinks [[text]] to just text
		cleanedText = cleanedText.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1');

		// Remove blockquotes
		cleanedText = cleanedText.replace(/^>\s+/gm, '');

		// Remove list markers (simple)
		cleanedText = cleanedText.replace(/^[-*+]\s+/gm, '');
		cleanedText = cleanedText.replace(/^\d+\.\s+/gm, '');

		return cleanedText.trim();
	}

	pcmToWav(pcmBuffer: ArrayBuffer, sampleRate: number = 24000): ArrayBuffer {
		const pcmData = new Uint8Array(pcmBuffer);
		const channels = 1;
		const bytesPerSample = 2;
		const numSamples = pcmData.length / bytesPerSample;
		
		// WAV file header
		const headerLength = 44;
		const wav = new Uint8Array(headerLength + pcmData.length);
		
		// Helper to write integers to the buffer
		const writeInt32 = (offset: number, value: number) => {
			wav[offset] = value & 0xff;
			wav[offset + 1] = (value >> 8) & 0xff;
			wav[offset + 2] = (value >> 16) & 0xff;
			wav[offset + 3] = (value >> 24) & 0xff;
		};
		
		const writeInt16 = (offset: number, value: number) => {
			wav[offset] = value & 0xff;
			wav[offset + 1] = (value >> 8) & 0xff;
		};
		
		// RIFF header
		wav.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
		writeInt32(4, 36 + pcmData.length); // File size - 8
		wav.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
		
		// fmt sub-chunk
		wav.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
		writeInt32(16, 16); // Sub-chunk size (16 for PCM)
		writeInt16(20, 1); // Audio format (1 = PCM)
		writeInt16(22, channels); // Number of channels
		writeInt32(24, sampleRate); // Sample rate
		writeInt32(28, sampleRate * channels * bytesPerSample); // Byte rate
		writeInt16(32, channels * bytesPerSample); // Block align
		writeInt16(34, 16); // Bits per sample
		
		// data sub-chunk
		wav.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
		writeInt32(40, pcmData.length); // Sub-chunk size
		
		// Copy PCM data
		wav.set(pcmData, headerLength);
		
		return wav.buffer;
	}

	async fetchGeminiAudio(text: string): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
		const { apiKey, modelName, voiceName, stylePrompt } = this.settings;
		
		if (!apiKey) {
			throw new Error('API key not configured. Please set your Gemini API key in plugin settings.');
		}

		const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

		const payload = {
			contents: [{ 
				parts: [{ text: text }] 
			}],
			generationConfig: {
				responseModalities: ["AUDIO"],
				speechConfig: {
					voiceConfig: {
						prebuiltVoiceConfig: { 
							voiceName: voiceName 
						}
					}
				}
			}
		};

		try {
			console.log('[Gemini TTS] Requesting audio generation for', text.length, 'characters');
			
			const startTime = performance.now();
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(payload)
			});

			const fetchTime = performance.now() - startTime;
			console.log('[Gemini TTS] API Response Status:', response.status, response.statusText);
			console.log('[Gemini TTS] Fetch time:', fetchTime.toFixed(2), 'ms');

			if (!response.ok) {
				const errorText = await response.text();
				console.error('[Gemini TTS] API Error:', response.status, response.statusText);
				throw new Error(`API request failed: ${response.status} ${response.statusText}`);
			}

			const data = await response.json();
			console.log('[Gemini TTS] ✓ Audio received from API');

			if (!data.candidates || !data.candidates[0]) {
				console.error('[Gemini TTS] Invalid response structure: no candidates');
				throw new Error('Invalid response structure from API: no candidates');
			}

			if (!data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
				console.error('[Gemini TTS] Invalid content structure');
				throw new Error('Invalid response structure from API: no content/parts');
			}

			const inlineData = data.candidates[0].content.parts[0].inlineData;
			const base64Audio = inlineData?.data;
			const mimeType = inlineData?.mimeType;
			
			if (!base64Audio) {
				console.error('[Gemini TTS] No audio data in response');
				throw new Error('No audio data in response');
			}

			console.log('[Gemini TTS] ✓ Audio data received, size:', base64Audio.length, 'characters');

			// Convert base64 to ArrayBuffer
			try {
				const binaryString = atob(base64Audio);
				const bytes = new Uint8Array(binaryString.length);
				for (let i = 0; i < binaryString.length; i++) {
					bytes[i] = binaryString.charCodeAt(i);
				}
				console.log('[Gemini TTS] ✓ Converted to ArrayBuffer, size:', bytes.buffer.byteLength, 'bytes');
				
				let audioBuffer = bytes.buffer;
				let playbackMimeType = 'audio/mpeg'; // Default
				
				// Detect format and convert if necessary
				if (mimeType?.includes('L16') || mimeType?.includes('pcm')) {
					console.log('[Gemini TTS] ⚠️ Detected PCM audio, converting to WAV format');
					// Extract sample rate from MIME type (e.g., "audio/L16;codec=pcm;rate=24000")
					const rateMatch = mimeType?.match(/rate=(\d+)/);
					const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;
					
					// Convert PCM to WAV
					audioBuffer = this.pcmToWav(audioBuffer, sampleRate);
					playbackMimeType = 'audio/wav';
					console.log('[Gemini TTS] ✓ Converted to WAV, new size:', audioBuffer.byteLength, 'bytes');
				} else if (mimeType?.includes('mpeg')) {
					playbackMimeType = 'audio/mpeg';
				} else if (mimeType?.includes('ogg')) {
					playbackMimeType = 'audio/ogg';
				}
				
				console.log('[Gemini TTS] Using MIME type for playback:', playbackMimeType);
				console.log('[Gemini TTS] ========== END API REQUEST ==========');
				
				// Return both buffer and MIME type so we can use the correct format
				return { buffer: audioBuffer, mimeType: playbackMimeType } as any;
			} catch (decodeError) {
				console.error('[Gemini TTS] Failed to decode base64:', decodeError);
				throw new Error(`Failed to decode audio data: ${decodeError.message}`);
			}
		} catch (error) {
			console.error('[Gemini TTS] Fetch error:', error.message);
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
			const audioResponse = await this.fetchGeminiAudio(cleanedText);
			const { buffer: audioBuffer, mimeType } = audioResponse;

			// Convert ArrayBuffer to Blob and create URL using the correct MIME type
			const audioBlob = new Blob([audioBuffer], { type: mimeType });
			this.currentAudioBlob = audioBlob;
			console.log('[Gemini TTS] Audio generated:', { size: audioBlob.size, type: audioBlob.type });
			
			audioUrl = URL.createObjectURL(audioBlob);

			// Create and play audio
			this.currentAudio = new Audio();
			this.currentAudio.crossOrigin = 'anonymous';
			this.currentAudio.src = audioUrl;
			this.isPlaying = true;
			this.isPaused = false;

			this.currentAudio.addEventListener('ended', () => {
				if (!this.currentAudio?.loop) {
					this.statusBarItem.setText('Gemini TTS: Stopped');
					cleanupAudio();
					this.hideAudioPlayer();
				}
			});

			this.currentAudio.addEventListener('error', (e) => {
				console.error('[Gemini TTS] Audio error:', this.currentAudio?.error?.message);
				new Notice('Error playing audio: ' + (this.currentAudio?.error?.message || 'Unknown error'));
				this.statusBarItem.setText('Gemini TTS: Error');
				cleanupAudio();
				this.hideAudioPlayer();
			});

			this.currentAudio.addEventListener('canplay', () => {
				console.log('[Gemini TTS] Audio ready, duration:', this.currentAudio?.duration);
			});

			this.currentAudio.addEventListener('loadedmetadata', () => {
				console.log('[Gemini TTS] Audio metadata loaded');
			});

			this.statusBarItem.setText('Gemini TTS: Playing...');
			await this.currentAudio.play();
			new Notice('Playing audio');
			
			// Show audio player
			this.showAudioPlayer();

			// Auto-save if enabled
			if (this.settings.saveAudioFiles) {
				await this.saveCurrentAudio();
			}
		} catch (error) {
			console.error('[Gemini TTS] Error:', error.message);
			new Notice(`Error: ${error.message}`);
			this.statusBarItem.setText('Gemini TTS: Error');
			cleanupAudio();
		}
	}

	stopPlayback() {
		if (this.currentAudio) {
			this.currentAudio.pause();
			this.currentAudio.currentTime = 0;
			this.currentAudio = null;
			this.isPlaying = false;
			this.isPaused = false;
			this.statusBarItem.setText('Gemini TTS: Stopped');
			new Notice('Playback stopped');
			this.hideAudioPlayer();
		}
	}

	togglePauseResume() {
		if (!this.currentAudio) {
			new Notice('No audio is currently loaded');
			return;
		}

		if (this.isPaused) {
			this.currentAudio.play();
			this.isPaused = false;
			this.isPlaying = true;
			this.statusBarItem.setText('Gemini TTS: Playing...');
			new Notice('Playback resumed');
		} else if (this.isPlaying) {
			this.currentAudio.pause();
			this.isPaused = true;
			this.isPlaying = false;
			this.statusBarItem.setText('Gemini TTS: Paused');
			new Notice('Playback paused');
		}
	}

	async saveCurrentAudio() {
		if (!this.currentAudioBlob) {
			new Notice('No audio available to save');
			return;
		}

		try {
			const activeFile = this.app.workspace.getActiveFile();
			const fileName = activeFile ? activeFile.basename : 'audio';
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
			const audioFileName = `${fileName}_${timestamp}.mp3`;

			// Ensure the output folder exists
			const folderPath = this.settings.audioOutputFolder;
			if (!await this.app.vault.adapter.exists(folderPath)) {
				await this.app.vault.createFolder(folderPath);
			}

			// Convert blob to ArrayBuffer
			const arrayBuffer = await this.currentAudioBlob.arrayBuffer();

			// Save the file
			const fullPath = `${folderPath}/${audioFileName}`;
			await this.app.vault.adapter.writeBinary(fullPath, arrayBuffer);

			new Notice(`Audio saved to ${fullPath}`);
		} catch (error) {
			new Notice(`Failed to save audio: ${error.message}`);
			console.error('Save audio error:', error);
		}
	}

	showAudioPlayer() {
		if (this.audioPlayerView || !this.currentAudio) {
			return;
		}

		this.audioPlayerView = document.body.createDiv({ cls: 'gemini-tts-player' });
		
		const container = this.audioPlayerView.createDiv({ cls: 'gemini-tts-player-container' });
		
		// Title
		const titleRow = container.createDiv({ cls: 'gemini-tts-player-title-row' });
		const title = titleRow.createDiv({ cls: 'gemini-tts-player-title', text: '🎵 Gemini TTS Player' });
		
		// Close button in top right
		const closeBtn = titleRow.createEl('button', { cls: 'gemini-tts-btn gemini-tts-close-btn', text: '✕' });
		closeBtn.setAttribute('aria-label', 'Close player');
		closeBtn.onclick = () => {
			this.hideAudioPlayer();
		};
		
		// Main controls
		const controls = container.createDiv({ cls: 'gemini-tts-player-controls' });
		
		// Play/Pause button
		const playPauseBtn = controls.createEl('button', { cls: 'gemini-tts-btn gemini-tts-btn-large', text: '⏸️ Pause' });
		playPauseBtn.setAttribute('aria-label', 'Play or pause audio');
		playPauseBtn.onclick = () => {
			this.togglePauseResume();
			playPauseBtn.textContent = this.isPaused ? '▶️ Play' : '⏸️ Pause';
		};
		
		// Stop button
		const stopBtn = controls.createEl('button', { cls: 'gemini-tts-btn gemini-tts-btn-medium', text: '⏹️ Stop' });
		stopBtn.setAttribute('aria-label', 'Stop playback');
		stopBtn.onclick = () => {
			this.stopPlayback();
		};
		
		// Volume control
		const volumeContainer = controls.createDiv({ cls: 'gemini-tts-volume-container' });
		const volumeLabel = volumeContainer.createDiv({ cls: 'gemini-tts-volume-label', text: '🔊' });
		const volumeSlider = volumeContainer.createEl('input', { 
			type: 'range',
			cls: 'gemini-tts-volume-slider',
			attr: { min: '0', max: '100', value: '100' }
		});
		volumeSlider.setAttribute('aria-label', 'Volume control');
		volumeSlider.addEventListener('input', () => {
			if (this.currentAudio) {
				this.currentAudio.volume = parseFloat(volumeSlider.value) / 100;
			}
		});
		
		// Secondary controls row
		const secondaryControls = container.createDiv({ cls: 'gemini-tts-secondary-controls' });
		
		// Repeat button
		const repeatBtn = secondaryControls.createEl('button', { cls: 'gemini-tts-btn gemini-tts-btn-small', text: '🔁 Repeat OFF' });
		repeatBtn.setAttribute('aria-label', 'Toggle repeat');
		repeatBtn.onclick = () => {
			if (this.currentAudio) {
				this.currentAudio.loop = !this.currentAudio.loop;
				repeatBtn.textContent = this.currentAudio.loop ? '🔁 Repeat ON' : '🔁 Repeat OFF';
			}
		};
		
		// Speed control
		const speedContainer = secondaryControls.createDiv({ cls: 'gemini-tts-speed-container' });
		speedContainer.createDiv({ cls: 'gemini-tts-speed-label', text: 'Speed:' });
		const speedSelect = speedContainer.createEl('select', { cls: 'gemini-tts-speed-select' });
		speedSelect.setAttribute('aria-label', 'Playback speed');
		const speeds = ['0.5x', '0.75x', '1.0x', '1.25x', '1.5x', '2x'];
		const speedValues = [0.5, 0.75, 1.0, 1.25, 1.5, 2];
		speeds.forEach((speed, idx) => {
			const option = speedSelect.createEl('option');
			option.value = speedValues[idx].toString();
			option.textContent = speed;
			if (idx === 2) option.selected = true; // 1.0x default
		});
		speedSelect.addEventListener('change', () => {
			if (this.currentAudio) {
				this.currentAudio.playbackRate = parseFloat(speedSelect.value);
			}
		});
		
		// Save button
		const saveBtn = secondaryControls.createEl('button', { cls: 'gemini-tts-btn gemini-tts-btn-small', text: '💾 Save' });
		saveBtn.setAttribute('aria-label', 'Save audio file');
		saveBtn.onclick = () => {
			this.saveCurrentAudio();
		};
		
		// Progress bar section
		const progressContainer = container.createDiv({ cls: 'gemini-tts-progress-container' });
		const progressBar = progressContainer.createEl('input', { 
			type: 'range',
			cls: 'gemini-tts-progress-bar',
			attr: { min: '0', max: '100', value: '0' }
		});
		progressBar.setAttribute('aria-label', 'Seek through audio');
		
		const timeDisplay = container.createDiv({ cls: 'gemini-tts-time-display', text: '0:00 / 0:00' });
		
		// Update progress bar and time display
		if (this.currentAudio) {
			this.currentAudio.addEventListener('timeupdate', () => {
				if (!this.currentAudio) return;
				const progress = (this.currentAudio.currentTime / this.currentAudio.duration) * 100;
				progressBar.value = progress.toString();
				
				const currentMin = Math.floor(this.currentAudio.currentTime / 60);
				const currentSec = Math.floor(this.currentAudio.currentTime % 60).toString().padStart(2, '0');
				const durationMin = Math.floor(this.currentAudio.duration / 60);
				const durationSec = Math.floor(this.currentAudio.duration % 60).toString().padStart(2, '0');
				timeDisplay.textContent = `${currentMin}:${currentSec} / ${durationMin}:${durationSec}`;
			});
			
		progressBar.addEventListener('input', () => {
			if (!this.currentAudio) return;
			const time = (parseFloat(progressBar.value) / 100) * this.currentAudio.duration;
			this.currentAudio.currentTime = time;
		});
		}
	}

	hideAudioPlayer() {
		if (this.audioPlayerView) {
			this.audioPlayerView.remove();
			this.audioPlayerView = null;
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
				.setPlaceholder('gemini-2.5-flash-preview-tts')
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

		// Save Audio Files setting
		new Setting(containerEl)
			.setName('Auto-save Audio Files')
			.setDesc('Automatically save generated audio files to the vault')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.saveAudioFiles)
				.onChange(async (value) => {
					this.plugin.settings.saveAudioFiles = value;
					await this.plugin.saveSettings();
				})
			);

		// Audio Output Folder setting
		new Setting(containerEl)
			.setName('Audio Output Folder')
			.setDesc('Folder path where audio files will be saved')
			.addText(text => text
				.setPlaceholder('TTS Audio')
				.setValue(this.plugin.settings.audioOutputFolder)
				.onChange(async (value) => {
					this.plugin.settings.audioOutputFolder = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
