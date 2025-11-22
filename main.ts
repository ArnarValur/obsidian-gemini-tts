import {
	App,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	ItemView,
	WorkspaceLeaf
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

interface AudioFile {
	name: string;
	path: string;
	createdTime: number;
}

const SIDEBAR_VIEW_TYPE = 'gemini-tts-sidebar';

class GeminiTTSSidebarView extends ItemView {
	plugin: GeminiTTSPlugin;
	audioList: AudioFile[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: GeminiTTSPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return SIDEBAR_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Gemini TTS';
	}

	getIcon() {
		return 'mic';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		
		const contentDiv = container.createDiv({ cls: 'gemini-tts-sidebar-content' });
		
		// Title
		contentDiv.createEl('h3', { text: '🎙️ TTS Player', cls: 'gemini-tts-sidebar-title' });
		
		// Player container (will be populated when audio is generated)
		const playerContainer = contentDiv.createDiv({ cls: 'gemini-tts-sidebar-player', attr: { id: 'sidebar-player-container' } });
		playerContainer.createDiv({ cls: 'gemini-tts-sidebar-empty', text: 'No audio playing' });
		
		// Audio history section
		const historyDiv = contentDiv.createDiv({ cls: 'gemini-tts-sidebar-history' });
		historyDiv.createEl('h4', { text: 'Recent Audio', cls: 'gemini-tts-sidebar-history-title' });
		
		const audioListContainer = historyDiv.createDiv({ cls: 'gemini-tts-audio-list', attr: { id: 'audio-list' } });
		
		// Load existing audio files
		await this.loadAudioFiles();
		this.renderAudioList(audioListContainer);
	}

	async loadAudioFiles() {
		// Priority: 1) Current note's folder, 2) Configured folder in settings
		let folderPath = this.plugin.settings.audioOutputFolder;
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile && activeFile.parent) {
			folderPath = activeFile.parent.path;
		}
		
		try {
			if (!await this.plugin.app.vault.adapter.exists(folderPath)) {
				this.audioList = [];
				return;
			}

			const files = await this.plugin.app.vault.adapter.list(folderPath);
			
			this.audioList = [];
			for (const fileName of files.files) {
				// Only include audio files
				if (fileName.match(/\.(wav|mp3|ogg|m4a)$/i)) {
					const filePath = `${folderPath}/${fileName}`;
					const stat = await this.plugin.app.vault.adapter.stat(filePath);
					this.audioList.push({
						name: fileName,
						path: filePath,
						createdTime: stat?.mtime || 0
					});
				}
			}
			
			// Sort by creation time (newest first)
			this.audioList.sort((a, b) => b.createdTime - a.createdTime);
		} catch (error) {
			console.error('[Gemini TTS] Error loading audio files:', error);
		}
	}

	renderAudioList(container: HTMLElement) {
		container.empty();
		
		if (this.audioList.length === 0) {
			container.createDiv({ cls: 'gemini-tts-audio-list-empty', text: 'No audio files yet' });
			return;
		}

		this.audioList.forEach((audio) => {
			const itemDiv = container.createDiv({ cls: 'gemini-tts-audio-item' });
			
			// File name and date
			const fileName = audio.name.split('/').pop() || 'unknown';
			const date = new Date(audio.createdTime).toLocaleDateString();
			
			itemDiv.createEl('div', { cls: 'gemini-tts-audio-name', text: fileName });
			itemDiv.createEl('div', { cls: 'gemini-tts-audio-date', text: date });
			
			// Play button
			const playBtn = itemDiv.createEl('button', { cls: 'gemini-tts-audio-play-btn', text: '▶️' });
			playBtn.setAttribute('aria-label', `Play ${fileName}`);
			playBtn.onclick = () => this.playAudio(audio);
			
			// Delete button
			const deleteBtn = itemDiv.createEl('button', { cls: 'gemini-tts-audio-delete-btn', text: '🗑️' });
			deleteBtn.setAttribute('aria-label', `Delete ${fileName}`);
			deleteBtn.onclick = () => this.deleteAudio(audio);
		});
	}

	async playAudio(audio: AudioFile) {
		try {
			const audioData = await this.plugin.app.vault.adapter.readBinary(audio.path);
			
			// Detect file extension and map to correct MIME type
			const ext = audio.name.split('.').pop()?.toLowerCase();
			let mimeType = 'audio/mpeg'; // default
			if (ext === 'wav') mimeType = 'audio/wav';
			else if (ext === 'ogg') mimeType = 'audio/ogg';
			else if (ext === 'm4a') mimeType = 'audio/mp4';
			else if (ext === 'mp3') mimeType = 'audio/mpeg';
			
			const audioBlob = new Blob([audioData], { type: mimeType });
			const audioUrl = URL.createObjectURL(audioBlob);
			
			// Stop current audio if playing
			if (this.plugin.currentAudio) {
				this.plugin.currentAudio.pause();
				URL.revokeObjectURL(this.plugin.currentAudio.src);
			}
			
			// Create and play new audio
			this.plugin.currentAudio = new Audio();
			this.plugin.currentAudio.src = audioUrl;
			this.plugin.currentAudio.play();
			this.plugin.isPlaying = true;
			this.plugin.isPaused = false;
			
			new Notice(`Playing: ${audio.name}`);
		} catch (error) {
			new Notice(`Error playing audio: ${error.message}`);
			console.error('[Gemini TTS] Error playing audio:', error);
		}
	}

	async deleteAudio(audio: AudioFile) {
		if (confirm(`Delete ${audio.name}?`)) {
			try {
				await this.plugin.app.vault.adapter.remove(audio.path);
				this.audioList = this.audioList.filter(a => a.path !== audio.path);
				const container = this.containerEl.querySelector('#audio-list') as HTMLElement;
				if (container) {
					this.renderAudioList(container);
				}
				new Notice(`Deleted: ${audio.name}`);
			} catch (error) {
				new Notice(`Error deleting audio: ${error.message}`);
				console.error('[Gemini TTS] Error deleting audio:', error);
			}
		}
	}

	async refreshAudioList() {
		await this.loadAudioFiles();
		const container = this.containerEl.querySelector('#audio-list') as HTMLElement;
		if (container) {
			this.renderAudioList(container);
		}
	}

	updatePlayerDisplay(isPlaying: boolean = false) {
		const playerContainer = this.containerEl.querySelector('#sidebar-player-container') as HTMLElement;
		if (!playerContainer) return;

		playerContainer.empty();
		
		if (!isPlaying || !this.plugin.currentAudio) {
			playerContainer.createDiv({ cls: 'gemini-tts-sidebar-empty', text: 'No audio playing' });
		} else {
			const playerDiv = playerContainer.createDiv({ cls: 'gemini-tts-sidebar-player-active' });
			
			// Main controls - Play/Pause and Stop buttons
			const controlsDiv = playerDiv.createDiv({ cls: 'gemini-tts-sidebar-controls' });
			
			const pauseBtn = controlsDiv.createEl('button', { cls: 'gemini-tts-sidebar-btn gemini-tts-btn-large', text: '⏸️ Pause' });
			pauseBtn.onclick = () => this.plugin.togglePauseResume();
			
			const stopBtn = controlsDiv.createEl('button', { cls: 'gemini-tts-sidebar-btn gemini-tts-btn-medium', text: '⏹️' });
			stopBtn.onclick = () => {
				this.plugin.stopPlayback();
				this.updatePlayerDisplay(false);
			};
			
			// Progress bar
			const progressContainer = playerDiv.createDiv({ cls: 'gemini-tts-progress-container' });
			const progressBar = progressContainer.createEl('input', { cls: 'gemini-tts-progress-bar', attr: { type: 'range', min: '0', max: '100', value: '0' } }) as HTMLInputElement;
			
			// Time display
			const timeDiv = progressContainer.createDiv({ cls: 'gemini-tts-time-display', text: '0:00 / 0:00' });
			
			// Volume control
			const volumeContainer = playerDiv.createDiv({ cls: 'gemini-tts-volume-container' });
			const volumeLabel = volumeContainer.createEl('span', { cls: 'gemini-tts-volume-label', text: '🔊' });
			const volumeSlider = volumeContainer.createEl('input', { cls: 'gemini-tts-volume-slider', attr: { type: 'range', min: '0', max: '100', value: '100' } }) as HTMLInputElement;
			
			if (this.plugin.currentAudio) {
				// Set initial volume
				this.plugin.currentAudio.volume = 1.0;
				
				// Update progress bar
				const updateProgress = () => {
					const current = Math.floor(this.plugin.currentAudio?.currentTime || 0);
					const duration = Math.floor(this.plugin.currentAudio?.duration || 0);
					
					if (duration > 0) {
						progressBar.max = duration.toString();
						progressBar.value = current.toString();
					}
					
					const currentMin = Math.floor(current / 60);
					const currentSec = (current % 60).toString().padStart(2, '0');
					const durationMin = Math.floor(duration / 60);
					const durationSec = (duration % 60).toString().padStart(2, '0');
					timeDiv.textContent = `${currentMin}:${currentSec} / ${durationMin}:${durationSec}`;
				};
				
				this.plugin.currentAudio.addEventListener('timeupdate', updateProgress);
				this.plugin.currentAudio.addEventListener('loadedmetadata', updateProgress);
				
				// Seeking via progress bar
				progressBar.addEventListener('input', (e) => {
					const newTime = parseFloat((e.target as HTMLInputElement).value);
					if (this.plugin.currentAudio) {
						this.plugin.currentAudio.currentTime = newTime;
					}
				});
				
				// Volume control
				volumeSlider.addEventListener('input', (e) => {
					const volume = parseFloat((e.target as HTMLInputElement).value) / 100;
					if (this.plugin.currentAudio) {
						this.plugin.currentAudio.volume = volume;
					}
				});
			}
		}
	}
}

export default class GeminiTTSPlugin extends Plugin {
	settings: GeminiTTSSettings;
	statusBarItem: HTMLElement;
	currentAudio: HTMLAudioElement | null = null;
	currentAudioBlob: Blob | null = null;
	isPlaying: boolean = false;
	isPaused: boolean = false;
	audioPlayerView: HTMLElement | null = null;
	sidebarView: GeminiTTSSidebarView | null = null;

	async onload() {
		await this.loadSettings();

		// Register sidebar view
		this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => {
			this.sidebarView = new GeminiTTSSidebarView(leaf, this);
			return this.sidebarView;
		});

		// Open sidebar automatically on startup
		this.app.workspace.onLayoutReady(async () => {
			const existing = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
			if (existing.length === 0) {
				const rightLeaf = this.app.workspace.getRightLeaf(false);
				if (rightLeaf) {
					await rightLeaf.setViewState({
						type: SIDEBAR_VIEW_TYPE,
						active: true
					});
				}
			}
		});

		// Add sidebar toggle command
		this.addCommand({
			id: 'toggle-tts-sidebar',
			name: 'Toggle TTS sidebar',
			callback: async () => {
				const existing = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
				if (existing.length > 0) {
					this.app.workspace.detachLeavesOfType(SIDEBAR_VIEW_TYPE);
				} else {
					const rightLeaf = this.app.workspace.getRightLeaf(false);
					if (rightLeaf) {
						await rightLeaf.setViewState({
							type: SIDEBAR_VIEW_TYPE,
							active: true
						});
					}
				}
			}
		});

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

		// Extract just the voice name, removing description if present (e.g., "Zephyr - Bright" -> "Zephyr")
		const cleanVoiceName = voiceName.includes(' - ') ? voiceName.split(' - ')[0] : voiceName;

		const payload = {
			contents: [{ 
				parts: [{ text: text }] 
			}],
			generationConfig: {
				responseModalities: ["AUDIO"],
				speechConfig: {
					voiceConfig: {
						prebuiltVoiceConfig: { 
							voiceName: cleanVoiceName 
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
					if (this.sidebarView) {
						this.sidebarView.updatePlayerDisplay(false);
					}
				}
			});

			this.currentAudio.addEventListener('error', (e) => {
				console.error('[Gemini TTS] Audio error:', this.currentAudio?.error?.message);
				new Notice('Error playing audio: ' + (this.currentAudio?.error?.message || 'Unknown error'));
				this.statusBarItem.setText('Gemini TTS: Error');
				cleanupAudio();
				if (this.sidebarView) {
					this.sidebarView.updatePlayerDisplay(false);
				}
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
			
			// Update sidebar player display
			if (this.sidebarView) {
				this.sidebarView.updatePlayerDisplay(true);
			}

			// Auto-save audio to sidebar
			await this.saveCurrentAudio();
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
			
			// Update sidebar to show no audio playing
			if (this.sidebarView) {
				this.sidebarView.updatePlayerDisplay(false);
			}
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
			const audioFileName = `${fileName}_${timestamp}.wav`;

			// Determine save location
			// Priority: 1) Same folder as note, 2) Configured folder in settings
			let folderPath = this.settings.audioOutputFolder;
			if (activeFile && activeFile.parent) {
				folderPath = activeFile.parent.path;
			}

			// Ensure the folder exists
			if (!await this.app.vault.adapter.exists(folderPath)) {
				await this.app.vault.createFolder(folderPath);
			}

			// Convert blob to ArrayBuffer
			const arrayBuffer = await this.currentAudioBlob.arrayBuffer();

			// Save the file
			const fullPath = folderPath ? `${folderPath}/${audioFileName}` : audioFileName;
			await this.app.vault.adapter.writeBinary(fullPath, arrayBuffer);

			// Refresh sidebar audio list
			if (this.sidebarView) {
				await this.sidebarView.refreshAudioList();
			}

			new Notice(`Audio saved: ${audioFileName}`);
		} catch (error) {
			new Notice(`Failed to save audio: ${error.message}`);
			console.error('Save audio error:', error);
		}
	}

	showAudioPlayer() {
		// Popup player no longer used - all playback is handled in sidebar
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
				.addOption('Zephyr', 'Zephyr - Bright')
				.addOption('Puck', 'Puck - Upbeat')
				.addOption('Charon', 'Charon - Informative')
				.addOption('Kore', 'Kore - Firm')
				.addOption('Fenrir', 'Fenrir - Excitable')
				.addOption('Leda', 'Leda - Youthful')
				.addOption('Orus', 'Orus - Firm')
				.addOption('Aoede', 'Aoede - Breezy')
				.addOption('Callirhoe', 'Callirhoe - Easy-going')
				.addOption('Autonoe', 'Autonoe - Bright')
				.addOption('Enceladus', 'Enceladus - Breathy')
				.addOption('Iapetus', 'Iapetus - Clear')
				.addOption('Umbriel', 'Umbriel - Easy-going')
				.addOption('Algieba', 'Algieba - Smooth')
				.addOption('Despina', 'Despina - Smooth')
				.addOption('Erinome', 'Erinome - Clear')
				.addOption('Algenib', 'Algenib - Gravelly')
				.addOption('Rasalgethi', 'Rasalgethi - Informative')
				.addOption('Laomedeai', 'Laomedeai - Upbeat')
				.addOption('Achernar', 'Achernar - Soft')
				.addOption('Alnilam', 'Alnilam - Firm')
				.addOption('Schedar', 'Schedar - Even')
				.addOption('Gacrux', 'Gacrux - Mature')
				.addOption('Pulcherrima', 'Pulcherrima - Forward')
				.addOption('Achird', 'Achird - Friendly')
				.addOption('Zubenelgenubi', 'Zubenelgenubi - Casual')
				.addOption('Vindemiatrix', 'Vindemiatrix - Gentle')
				.addOption('Sadachbia', 'Sadachbia - Lively')
				.addOption('Sadaltager', 'Sadaltager - Knowledgeable')
				.addOption('Sulafat', 'Sulafat - Warm')
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
