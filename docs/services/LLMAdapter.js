import {GoogleGenerativeAI} from "https://esm.run/@google/generative-ai";

export class LLMAdapter {
    constructor() {
        this.settings = null;
        this.provider = "gemini"; // default provider
        this.geminiApiKey = null;
        this.geminiModel = "gemini-2.5-flash"; // default model
        this.openrouterApiKey = null;
        this.openrouterModel = "anthropic/claude-3.5-sonnet"; // default OpenRouter model
        this.grokApiKey = null;
        this.grokModel = "grok-beta"; // default Grok model
        this.mistralApiKey = null;
        this.mistralModel = "mistral-large-latest"; // default Mistral model
    }

    async init() {
        const settings = await window.LocalStorage.get("llm-settings");
        console.log("🤖 LLMAdapter.init() - Raw settings from storage:", settings);
        if (settings) {
            this.provider = settings.provider || "gemini";
            this.geminiApiKey = settings.geminiApiKey;
            this.geminiModel = settings.geminiModel || "gemini-2.5-flash";
            this.openrouterApiKey = settings.openrouterApiKey;
            this.openrouterModel = settings.openrouterModel || "anthropic/claude-3.5-sonnet";
            this.grokApiKey = settings.grokApiKey;
            this.grokModel = settings.grokModel || "grok-beta";
            this.mistralApiKey = settings.mistralApiKey;
            this.mistralModel = settings.mistralModel || "mistral-large-latest";

            const currentApiKey = this.provider === "gemini" ? this.geminiApiKey :
                this.provider === "openrouter" ? this.openrouterApiKey :
                    this.provider === "grok" ? this.grokApiKey : this.mistralApiKey;
            console.log("✅ LLMAdapter.init() - Configuration loaded:");
            console.log("   📍 Provider:", this.provider);
            console.log("   🎯 Current Model:", this.getCurrentModel());
            console.log("   🔑 API Key available:", currentApiKey ? "YES" : "NO");
            console.log("   🔧 All models configured:", {
                gemini: this.geminiModel,
                openrouter: this.openrouterModel,
                grok: this.grokModel,
                mistral: this.mistralModel
            });
        } else {
            console.log("⚠️  LLMAdapter.init() - No settings found, using defaults");
            console.log("   📍 Default Provider:", this.provider);
            console.log("   🎯 Default Model:", this.getCurrentModel());
        }
    }

    getCurrentModel() {
        switch (this.provider) {
            case "gemini":
                return this.geminiModel;
            case "openrouter":
                return this.openrouterModel;
            case "grok":
                return this.grokModel;
            case "mistral":
                return this.mistralModel;
            default:
                return "unknown";
        }
    }

    // Utility method to get current configuration summary
    getConfigurationSummary() {
        return {
            provider: this.provider,
            model: this.getCurrentModel(),
            hasApiKey: this.hasCurrentApiKey(),
            fallbackAvailable: !!this.geminiApiKey
        };
    }

    hasCurrentApiKey() {
        switch (this.provider) {
            case "gemini":
                return !!this.geminiApiKey;
            case "openrouter":
                return !!this.openrouterApiKey;
            case "grok":
                return !!this.grokApiKey;
            case "mistral":
                return !!this.mistralApiKey;
            default:
                return false;
        }
    }

    async saveSettings(settings) {
        await window.LocalStorage.set("llm-settings", settings);
        await this.init();
    }

    async generate(prompt, schema) {
        await this.init();
        console.log("🚀 LLMAdapter.generate() - Starting generation with:", {
            provider: this.provider,
            model: this.getCurrentModel()
        });
        let rawResponse;

        if (this.provider === "gemini") {
            console.log("📨 Using Gemini API with model:", this.geminiModel);
            rawResponse = await this.callGeminiAPI(prompt, this.geminiModel);
        } else if (this.provider === "openrouter") {
            console.log("📨 Using OpenRouter API with model:", this.openrouterModel);
            rawResponse = await this.callOpenRouterAPI(prompt, this.openrouterModel);
        } else if (this.provider === "grok") {
            console.log("📨 Using Grok API with model:", this.grokModel);
            rawResponse = await this.callGrokAPI(prompt, this.grokModel);
        } else if (this.provider === "mistral") {
            console.log("📨 Using Mistral API with model:", this.mistralModel);
            rawResponse = await this.callMistralAPI(prompt, this.mistralModel);
        } else {
            throw new Error("No valid LLM provider selected");
        }

        if (!rawResponse) {
            return null; // Error was already shown to the user
        }

        try {
            // Clean up the response before parsing
            const cleanedResponse = this.cleanJSONResponse(rawResponse);

            if (!cleanedResponse) {
                throw new Error("Empty response after cleaning");
            }

            console.log("🔍 About to parse cleaned JSON:", cleanedResponse.substring(0, 500) + "...");

            let jsonResponse;
            try {
                jsonResponse = JSON.parse(cleanedResponse);
            } catch (parseError) {
                console.error("🚨 JSON Parse Error:", parseError.message);
                console.log("🔍 Failed to parse:", cleanedResponse);
                throw new Error(`Invalid JSON format: ${parseError.message}. The AI response may be incomplete or corrupted.`);
            }

            if (schema && !this.validateJSON(jsonResponse, schema)) {
                console.error("🚨 Schema validation failed");
                console.log("🔍 Expected schema:", schema);
                console.log("🔍 Received object:", jsonResponse);
                throw new Error("The AI's response did not match the expected format.");
            }

            console.log("✅ Successfully parsed and validated JSON response");
            return jsonResponse;
        } catch (error) {
            console.error("❌ Error processing AI response:", error);
            console.log("📝 Raw response was:", rawResponse);

            let errorMessage = `There was an issue with the AI's response: ${error.message}`;

            if (error.message.includes('JSON') || error.message.includes('parse')) {
                errorMessage += "\n\nThis usually happens when the AI response is incomplete or contains invalid characters. Try generating again.";
            }

            await window.webSkel.showModal("show-error-modal", {
                title: "Response Processing Error",
                message: errorMessage
            });
            return null;
        }
    }

    async callGeminiAPI(prompt, modelName = "gemini-2.5-flash") {
        console.log("callGeminiAPI - API key check:", this.geminiApiKey ? "FOUND" : "NOT FOUND");
        if (!this.geminiApiKey) {
            console.log("callGeminiAPI - No API key, showing error modal");
            await window.webSkel.showModal("show-error-modal", {
                title: "API Key Error",
                message: "Please set a Gemini API key in the settings page."
            });
            return null;
        }
        const genAI = new GoogleGenerativeAI(this.geminiApiKey);
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    response_mime_type: "application/json",
                    max_output_tokens: 8192, // Increase token limit
                    temperature: 0.7
                }
            });
            // Enhance prompt to ensure complete JSON response
            const enhancedPrompt = `${prompt}

CRITICAL: Your response must be COMPLETE, VALID JSON only. No explanations, no truncation, no additional text. Start with { and end with }. If the JSON would be very long, prioritize completeness over detail.`;

            const result = await model.generateContent(enhancedPrompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error(`Error calling Gemini API with model ${modelName}:`, error);
            // Fallback logic for 2.5 models to 1.5-flash if there's a server error
            if ((modelName === "gemini-2.5-flash" || modelName === "gemini-2.5-pro") &&
                (error.message.includes("500") || error.message.includes("not found") || error.message.includes("unavailable"))) {
                console.log(`⚠️  Falling back from ${modelName} to gemini-1.5-flash due to server error...`);
                return this.callGeminiAPI(prompt, "gemini-1.5-flash");
            }
            let errorMessage = `Gemini ${modelName} failed: `;

            if (error.message.includes('API_KEY_INVALID')) {
                errorMessage += "Invalid API key. Please check your Gemini API key in Settings.";
            } else if (error.message.includes('QUOTA_EXCEEDED')) {
                errorMessage += "API quota exceeded. Check your Gemini usage limits or wait for quota reset.";
            } else if (error.message.includes('403')) {
                errorMessage += "Access forbidden. Your API key might not have access to this model.";
            } else if (error.message.includes('429')) {
                errorMessage += "Too many requests. Please wait a moment and try again.";
            } else if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
                errorMessage += "Gemini service is temporarily unavailable. Please try again later.";
            } else {
                errorMessage += error.message;
            }

            await window.webSkel.showModal("show-error-modal", {
                title: "Gemini API Error",
                message: errorMessage
            });
            return null;
        }
    }

    async callOpenRouterAPI(prompt, modelName = "anthropic/claude-3.5-sonnet") {
        if (!this.openrouterApiKey) {
            await window.webSkel.showModal("show-error-modal", {
                title: "API Key Error",
                message: "Please set an OpenRouter API key in the settings page."
            });
            return null;
        }

        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.openrouterApiKey}`,
                    "HTTP-Referer": window.location.origin,
                    "X-Title": "MemeHIT Studio"
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [
                        {
                            role: "system",
                            content: "You are a creative assistant that generates JSON responses for video content creation. Always respond with valid JSON only, no additional text."
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.7,
                    response_format: {type: "json_object"}
                })
            });

            if (!response.ok) {
                throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error(`❌ Error calling OpenRouter API with model ${modelName}:`, error);

            let errorMessage = `OpenRouter ${modelName} failed: `;

            if (error.message.includes('401')) {
                errorMessage += "Invalid API key. Please check your OpenRouter API key in Settings.";
            } else if (error.message.includes('429')) {
                errorMessage += "Rate limit exceeded or quota exhausted. Check your OpenRouter usage limits.";
            } else if (error.message.includes('400')) {
                errorMessage += "Invalid request format. This might be a model compatibility issue.";
            } else if (error.message.includes('402')) {
                errorMessage += "Insufficient credits. Please add credits to your OpenRouter account.";
            } else {
                errorMessage += error.message;
            }

            await window.webSkel.showModal("show-error-modal", {
                title: "OpenRouter API Error",
                message: errorMessage
            });
            return null;
        }
    }

    async callGrokAPI(prompt, modelName = "grok-beta") {
        if (!this.grokApiKey) {
            await window.webSkel.showModal("show-error-modal", {
                title: "API Key Error",
                message: "Please set a Grok API key in the settings page."
            });
            return null;
        }

        try {
            const response = await fetch("https://api.x.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.grokApiKey}`
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [
                        {
                            role: "system",
                            content: "You are a creative assistant that generates JSON responses for video content creation. Always respond with valid JSON only, no additional text."
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.7,
                    response_format: {type: "json_object"}
                })
            });

            if (!response.ok) {
                throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error(`❌ Error calling Grok API with model ${modelName}:`, error);

            let errorMessage = `Grok ${modelName} failed: `;

            if (error.message.includes('401')) {
                errorMessage += "Invalid API key. Please check your Grok API key in Settings.";
            } else if (error.message.includes('429')) {
                errorMessage += "Rate limit exceeded. Please wait and try again.";
            } else if (error.message.includes('400')) {
                errorMessage += "Invalid request format. This might be a model compatibility issue.";
            } else if (error.message.includes('402')) {
                errorMessage += "Insufficient credits. Please check your Grok account balance.";
            } else {
                errorMessage += error.message;
            }

            await window.webSkel.showModal("show-error-modal", {
                title: "Grok API Error",
                message: errorMessage
            });
            return null;
        }
    }

    async callMistralAPI(prompt, modelName = "mistral-large-latest") {
        if (!this.mistralApiKey) {
            await window.webSkel.showModal("show-error-modal", {
                title: "API Key Error",
                message: "Please set a Mistral API key in the settings page."
            });
            return null;
        }

        try {
            const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.mistralApiKey}`
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [
                        {
                            role: "system",
                            content: "You are a creative assistant that generates JSON responses for video content creation. Always respond with valid JSON only, no additional text."
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.7,
                    response_format: {type: "json_object"}
                })
            });

            if (!response.ok) {
                throw new Error(`Mistral API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error(`❌ Error calling Mistral API with model ${modelName}:`, error);

            let errorMessage = `Mistral ${modelName} failed: `;

            if (error.message.includes('401')) {
                errorMessage += "Invalid API key. Please check your Mistral API key in Settings.";
            } else if (error.message.includes('429')) {
                errorMessage += "Rate limit exceeded or quota exhausted. Check your Mistral usage limits.";
            } else if (error.message.includes('400')) {
                errorMessage += "Invalid request format. This might be a model compatibility issue.";
            } else if (error.message.includes('402')) {
                errorMessage += "Insufficient credits. Please add credits to your Mistral account.";
            } else {
                errorMessage += error.message;
            }

            await window.webSkel.showModal("show-error-modal", {
                title: "Mistral API Error",
                message: errorMessage
            });
            return null;
        }
    }

    cleanJSONResponse(rawResponse) {
        if (!rawResponse) {
            console.error("🚨 cleanJSONResponse: rawResponse is null/empty");
            return rawResponse;
        }

        console.log("🧹 cleanJSONResponse: Original response length:", rawResponse.length);
        console.log("🧹 cleanJSONResponse: First 200 chars:", rawResponse.substring(0, 200));
        console.log("🧹 cleanJSONResponse: Last 200 chars:", rawResponse.substring(rawResponse.length - 200));

        let cleaned = rawResponse.trim();
        try {
            JSON.parse(cleaned);
            return cleaned;
        } catch (e) {
            console.log("Try to fix the JSON");
        }

        // First, try to extract JSON from markdown code blocks
        const codeBlockMatch = cleaned.match(/```json\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
            cleaned = codeBlockMatch[1].trim();
            console.log("✂️  cleanJSONResponse: Extracted JSON from code block");
        } else {
            // Remove any markdown code block markers if they exist without proper closing
            cleaned = cleaned.replace(/```json\s*|\s*```/g, '');
        }

        // Remove any leading/trailing whitespace
        cleaned = cleaned.trim();

        // Find the first { and last } to extract just the JSON
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');

        if (firstBrace >= 0 && lastBrace > firstBrace) {
            // Check if there might be multiple JSON objects - take the largest valid one
            const beforeFirstBrace = cleaned.substring(0, firstBrace);
            if (beforeFirstBrace.trim() && !beforeFirstBrace.includes('```')) {
                console.log("🔍 cleanJSONResponse: Found text before JSON, extracting pure JSON");
            }
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
            console.log("✂️  cleanJSONResponse: Extracted JSON between braces");
        } else {
            console.error("🚨 cleanJSONResponse: No valid JSON braces found!");
            console.log("🔍 First brace at:", firstBrace, "Last brace at:", lastBrace);
        }

        // Fix common JSON issues
        // Remove trailing commas before } or ]
        cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

        // Fix unescaped quotes in strings (basic fix)
        cleaned = cleaned.replace(/([{,]\s*"[^"]*":\s*"[^"]*)"([^"]*"[,}])/g, '$1\\"$2');

        // Additional fixes for common Gemini issues
        // Fix newlines in string values that break JSON (more comprehensive)
        cleaned = cleaned.replace(/("(?:[^"\\]|\\.)*?")\s*:\s*"([^"]*?)\n/g, (match, key, value) => {
            return key + ': "' + value.replace(/\n/g, '\\n');
        });

        // Fix unescaped newlines in long string values
        cleaned = cleaned.replace(/:\s*"([^"]*(?:\n[^"]*)*)"([,\}])/g, (match, value, terminator) => {
            const escapedValue = value.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
            return ': "' + escapedValue + '"' + terminator;
        });

        // Enhanced JavaScript code field handling for backgroundAnimation.code
        // This is the most complex part since it contains full JavaScript code
        cleaned = cleaned.replace(/"code":\s*"((?:[^"\\]|\\.)*?)"/g, (match, codeContent) => {
            console.log("🔧 Processing JavaScript code field, original length:", codeContent.length);

            // Step 1: Properly escape the JavaScript code for JSON
            let processedCode = codeContent;

            // Step 2: Handle control characters first (newlines, tabs, etc.)
            processedCode = processedCode
                .replace(/\\\\/g, '\\\\\\\\')  // Escape backslashes first 
                .replace(/\\n/g, '\\\\n')      // Escape newlines
                .replace(/\\t/g, '\\\\t')      // Escape tabs
                .replace(/\\r/g, '\\\\r')      // Escape carriage returns
                .replace(/\n/g, '\\\\n')       // Escape literal newlines 
                .replace(/\t/g, '\\\\t')       // Escape literal tabs
                .replace(/\r/g, '\\\\r');      // Escape literal returns

            // Step 3: Handle quotes - this is the trickiest part
            // First, protect already escaped quotes
            processedCode = processedCode.replace(/\\\\"/g, '___ESCAPED_QUOTE___');
            // Then escape unescaped quotes
            processedCode = processedCode.replace(/"/g, '\\\\"');
            // Restore protected quotes
            processedCode = processedCode.replace(/___ESCAPED_QUOTE___/g, '\\\\"');

            console.log("✅ Processed JavaScript code field, new length:", processedCode.length);
            return '"code": "' + processedCode + '"';
        });

        // Fix incomplete JSON at the end (truncated response)
        const openBraces = (cleaned.match(/{/g) || []).length;
        const closeBraces = (cleaned.match(/}/g) || []).length;
        if (openBraces > closeBraces) {
            console.log("🔧 cleanJSONResponse: Adding missing closing braces");
            const missingBraces = '}'.repeat(openBraces - closeBraces);
            cleaned += missingBraces;
        }

        // Final validation attempt - try to catch remaining issues
        try {
            JSON.parse(cleaned);
            console.log("✅ cleanJSONResponse: Successfully validated cleaned JSON");
        } catch (testError) {
            console.error("⚠️  cleanJSONResponse: Cleaned JSON still has issues:", testError.message);
            console.log("🔍 Problematic position around:", testError.message.match(/position (\d+)/)?.[1] || "unknown");

            // Last resort fixes for common remaining issues
            if (testError.message.includes('Unexpected token') || testError.message.includes('Expected')) {
                // Try to identify and fix the problematic area
                const errorPos = testError.message.match(/position (\d+)/)?.[1];
                if (errorPos) {
                    const pos = parseInt(errorPos);
                    const contextStart = Math.max(0, pos - 50);
                    const contextEnd = Math.min(cleaned.length, pos + 50);
                    console.log("🔍 Context around error:", cleaned.substring(contextStart, contextEnd));
                }

                // Apply additional generic fixes
                cleaned = cleaned.replace(/\\\\\\\\/g, '\\\\');  // Fix over-escaped backslashes
                cleaned = cleaned.replace(/\\\\\\"/g, '\\"');    // Fix over-escaped quotes

                console.log("🛠️  cleanJSONResponse: Applied last resort fixes");
            }
        }

        console.log("✅ cleanJSONResponse: Final cleaned response length:", cleaned.length);
        console.log("🔍 cleanJSONResponse: Final first 200 chars:", cleaned.substring(0, 200));

        return cleaned;
    }

    getScriptStructure() {
        return {
            "title": "string",
            "scenes": [
                {
                    "sceneId": "string",
                    "question": "string",
                    "answers": ["string"],
                    "correctAnswer": "string",
                    "duration": "number"
                }
            ]
        };
    }

    validateJSON(json, schema) {
        if (typeof json !== 'object' || json === null) return false;
        for (const key in schema) {
            if (!json.hasOwnProperty(key)) return false;
            const schemaType = schema[key];
            const value = json[key];
            if (Array.isArray(schemaType)) {
                if (!Array.isArray(value)) return false;
                if (value.length > 0 && typeof value[0] !== schemaType[0]) return false;
            } else if (typeof value !== schemaType) {
                return false;
            }
        }
        return true;
    }
}

window.llmAdapter = new LLMAdapter();
