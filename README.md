# Gemini TTS for Obsidian

Read your Obsidian notes aloud using Google's Gemini 2.5 Flash TTS API.

## Features

- **Text-to-Speech**: Convert your notes to natural-sounding speech using Google's Gemini AI
- **Voice Selection**: Choose from 5 different voice personas (Puck, Charon, Kore, Fenrir, Aoede)
- **Smart Text Cleaning**: Automatically removes Markdown formatting for natural speech
- **Selective Reading**: Read the entire note or just selected text
- **Customizable Style**: Add style prompts to control how the AI reads (e.g., "Read cheerfully")
- **Code Block Filtering**: Optionally skip code blocks when reading

## Installation

### From Community Plugins (Recommended)
1. Open Obsidian Settings → Community plugins
2. Turn off Safe mode
3. Click Browse and search for "Gemini TTS"
4. Install and enable the plugin

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/ArnarValur/obsidian-gemini-tts/releases/latest)
2. Create a folder called `gemini-tts` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the folder
4. Reload Obsidian and enable the plugin in Settings → Community plugins

## Setup

1. Get a Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Open Obsidian Settings → Gemini TTS
3. Enter your API key in the settings

## Usage

- **Ribbon Icon**: Click the microphone icon in the left ribbon to read the active note
- **Command Palette**: Use `Gemini TTS: Read active note` or `Gemini TTS: Stop playback`
- **Selected Text**: Select text in your note and trigger TTS to read only the selection

## Settings

| Setting | Description |
|---------|-------------|
| **API Key** | Your Google Gemini API key (stored locally, see Security section) |
| **Model Name** | Gemini model to use (default: `gemini-2.5-flash-tts`) |
| **Voice** | Voice persona to use for speech |
| **Style Prompt** | Instructions for how the AI should read (e.g., "Read clearly and naturally") |
| **Skip Code Blocks** | When enabled, removes code blocks before reading |

## Security

### API Key Storage
Your API key is stored locally in your vault's plugin data folder (`data.json`). This file is:
- **Not encrypted** by default (standard Obsidian plugin behavior)
- Stored only on your device
- **Not synced** if you have `data.json` excluded from Obsidian Sync

**Recommendations:**
- Keep your vault secure and backed up
- Do not share your `data.json` file
- Regularly rotate your API key if concerned about security
- The API key is transmitted securely via HTTPS headers, not URL parameters

### Network Usage
This plugin requires an internet connection to communicate with Google's Gemini API. Your note content is sent to Google for TTS processing.

## Troubleshooting

- **No audio plays**: Check your API key is valid and you have API quota remaining
- **Error in console**: Open Developer Tools (Ctrl+Shift+I) for detailed error messages
- **Mobile not working**: Ensure you have internet connectivity and the API key is configured

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- [Report issues](https://github.com/ArnarValur/obsidian-gemini-tts/issues)
- [GitHub Repository](https://github.com/ArnarValur/obsidian-gemini-tts)