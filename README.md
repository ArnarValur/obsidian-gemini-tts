# Obsidian Gemini TTS

Read your Obsidian notes aloud using Google's Gemini 2.5 Flash Preview TTS API with native text-to-speech capabilities.

## Features

- 🎙️ **Natural Voice Synthesis**: Uses Google Gemini's advanced TTS models
- 🎭 **Multiple Voices**: Choose from 5 different voice options (Puck, Charon, Kore, Fenrir, Aoede)
- 🎨 **Customizable Style**: Adjust reading style with custom prompts
- 📝 **Smart Text Cleaning**: Automatically removes markdown formatting, code blocks, and frontmatter
- ⚡ **Simple Controls**: Ribbon icon and keyboard commands for easy access
- 📱 **Cross-Platform**: Works on desktop and mobile

## Installation

### From Obsidian

1. Open Settings → Community Plugins
2. Disable Safe Mode
3. Browse and search for "Gemini TTS"
4. Install and enable the plugin

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to your vault's `.obsidian/plugins/gemini-tts/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

## Setup

1. Get a Google Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey).
   - **Note:** Ensure your API key has access to the **Generative Language API**.
2. Open Obsidian Settings → Gemini TTS
3. Enter your API key
4. Customize other settings as desired

## Usage

### Reading Notes

- **Ribbon Icon**: Click the microphone icon in the left sidebar
- **Command Palette**: Search for "Read active note" (Ctrl/Cmd+P)

### Stopping Playback

- **Command Palette**: Search for "Stop playback"
- Or simply start reading a new note

### Status Bar

The status bar at the bottom shows the current state:
- "Generating..." - Fetching audio from Gemini API
- "Playing..." - Audio is currently playing
- "Stopped" - Playback has ended or been stopped
- "Error" - Something went wrong

## Settings

### API Key
Your Google Gemini API key (required). Get one from [Google AI Studio](https://makersuite.google.com/app/apikey).

### Model Name
The Gemini model to use for TTS (default: `gemini-2.5-flash-preview-tts`).

### Voice Name
Choose from 5 different voices:
- **Puck**: Default voice
- **Charon**: Alternative voice option
- **Kore**: Alternative voice option
- **Fenrir**: Alternative voice option
- **Aoede**: Alternative voice option

### Style Prompt
Instructions for how the text should be read (default: "Read clearly and naturally."). Customize this to change the reading style, pace, or emphasis.

### Skip Code Blocks
When enabled, code blocks (both inline and fenced) are removed from the text before reading (default: enabled).

## How It Works

1. The plugin extracts text from your active note
2. Removes markdown formatting, frontmatter, and optionally code blocks
3. Sends the cleaned text to Google's Gemini API
4. Receives base64-encoded audio
5. Plays the audio using HTML5 Audio

## Privacy & Data

- **API Key Storage**: Your API key is stored locally in your vault's `.obsidian/plugins/gemini-tts/data.json` file. It is **never** sent to any third-party server other than Google's Gemini API for the purpose of generating audio.
- **Data Transmission**: Only the text content of your notes is sent to Google's Gemini API. No other vault data is accessed or transmitted.
- **Logging**: The plugin is designed to avoid logging sensitive information (like your API key) to the developer console.
- See [Google's Privacy Policy](https://policies.google.com/privacy) for API data handling

## Troubleshooting

### "API key is not set" error
Make sure you've entered your Gemini API key in the plugin settings.

### "No active note found" error
Open a note in edit or reading mode before trying to read it.

### "No audio data in response" error
Check your API key is valid and has access to the Gemini TTS models.

### Audio doesn't play
- Check your device volume
- Ensure your browser/Electron has audio permissions
- Try a different note to rule out content issues

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details.

## Support

If you encounter any issues or have suggestions, please [open an issue](https://github.com/ArnarValur/obsidian-gemini-tts/issues) on GitHub.
