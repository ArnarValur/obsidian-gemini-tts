const https = require('https');
const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const MODEL_GENERIC = 'gemini-2.0-flash-exp';
const MODEL_TTS = 'gemini-2.5-flash-preview-tts';

async function testGeminiAPI(apiKey, modelName, useSpeechConfig) {
    console.log(`\n--- Testing Model: ${modelName} ---`);
    
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    let promptText = "Hello! This is a test of the Gemini Text to Speech capabilities.";
    
    // For generic models, we need to ask for speech explicitly in the prompt
    if (!useSpeechConfig) {
        promptText = "Please read the following text aloud clearly and naturally.\n\nText to read:\n" + promptText;
    }

    const generationConfig = {
        responseModalities: ["AUDIO"]
    };

    if (useSpeechConfig) {
        generationConfig.speechConfig = {
            voiceConfig: {
                prebuiltVoiceConfig: { 
                    voiceName: "Puck" 
                }
            }
        };
    }

    const payload = {
        contents: [{ 
            parts: [{ text: promptText }] 
        }],
        generationConfig: generationConfig
    };

    console.log("Sending Payload:", JSON.stringify(payload, null, 2));

    return new Promise((resolve, reject) => {
        const req = https.request(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log(`Status Code: ${res.statusCode}`);
                
                if (res.statusCode !== 200) {
                    console.error("Error Response:", data);
                    resolve(false);
                    return;
                }

                try {
                    const jsonResponse = JSON.parse(data);
                    // console.log("Full Response:", JSON.stringify(jsonResponse, null, 2));

                    if (jsonResponse.candidates && 
                        jsonResponse.candidates[0] && 
                        jsonResponse.candidates[0].content && 
                        jsonResponse.candidates[0].content.parts && 
                        jsonResponse.candidates[0].content.parts[0].inlineData) {
                        
                        const audioData = jsonResponse.candidates[0].content.parts[0].inlineData.data;
                        const buffer = Buffer.from(audioData, 'base64');
                        const filename = `test_output_${modelName}.mp3`;
                        fs.writeFileSync(filename, buffer);
                        console.log(`SUCCESS! Audio saved to ${filename}`);
                        resolve(true);
                    } else {
                        console.error("Unexpected response structure:", JSON.stringify(jsonResponse, null, 2));
                        resolve(false);
                    }
                } catch (e) {
                    console.error("Failed to parse JSON:", e);
                    resolve(false);
                }
            });
        });

        req.on('error', (e) => {
            console.error("Request Error:", e);
            resolve(false);
        });

        req.write(JSON.stringify(payload));
        req.end();
    });
}

console.log("This script will test the Gemini API connectivity for TTS.");
console.log("It will attempt to generate audio using two different configurations.");

const apiKeyArg = process.argv[2];

if (apiKeyArg) {
    runTests(apiKeyArg);
} else {
    rl.question('Enter your Gemini API Key: ', (apiKey) => {
        runTests(apiKey);
    });
}

async function runTests(apiKey) {
    if (!apiKey) {
        console.error("API Key is required.");
        if (!apiKeyArg) rl.close();
        return;
    }

    // Test 1: Generic Model (gemini-2.0-flash-exp) - The "Safe" fallback
    console.log("\nTest 1: Generic Model (gemini-2.0-flash-exp)");
    console.log("This uses the multimodal capabilities of the main model.");
    const success1 = await testGeminiAPI(apiKey, MODEL_GENERIC, false);

    // Test 2: TTS Specific Model (gemini-2.5-flash-preview-tts)
    console.log("\nTest 2: TTS Specific Model (gemini-2.5-flash-preview-tts)");
    console.log("This uses the dedicated TTS model with voice configuration.");
    const success2 = await testGeminiAPI(apiKey, MODEL_TTS, true);

    console.log("\n--- Summary ---");
    console.log(`Generic Model (${MODEL_GENERIC}): ${success1 ? "PASSED" : "FAILED"}`);
    console.log(`TTS Model (${MODEL_TTS}): ${success2 ? "PASSED" : "FAILED"}`);

    if (success1 || success2) {
        console.log("\nAt least one configuration works! The plugin is updated to handle both.");
        if (success1 && !success2) {
            console.log("Recommendation: Use 'gemini-2.0-flash-exp' in the plugin settings.");
        } else if (success2) {
            console.log("Recommendation: You can use 'gemini-2.5-flash-preview-tts' in the plugin settings.");
        }
    } else {
        console.log("\nBoth tests failed. Please check your API key and quota.");
    }

    if (!apiKeyArg) rl.close();
}
