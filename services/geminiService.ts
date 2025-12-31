import { GoogleGenAI, Modality } from "@google/genai";

// Hardcoded fallback key provided by user
const FALLBACK_KEY = 'AIzaSyDD6FI6qBvUiwBOIAN4huqtr00rSM75k5A';

/**
 * robustly retrieves the API key.
 * Checks process.env first. If invalid or missing, uses fallback.
 */
const getApiKey = (): string => {
  let key = process.env.API_KEY;
  
  // Basic validation: Must start with 'AIza' to be a valid Google API key
  if (!key || typeof key !== 'string' || !key.startsWith('AIza')) {
    key = FALLBACK_KEY;
  }
  return key.trim();
};

// Singleton instance wrapper
let aiInstance: GoogleGenAI | null = null;

const getAiClient = (): GoogleGenAI => {
  if (!aiInstance) {
    const apiKey = getApiKey();
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

// System instruction for standard chat
const SYSTEM_INSTRUCTION = `You are an expert AI Health Assistant with advanced multilingual capabilities.
Analyze symptoms provided via text or images and provide detailed, professional, and empathetic health advice.

**LANGUAGE DETECTION & RESPONSE PROTOCOL**:
1. **Detect Language**: Identify if the user is communicating in English, Hindi (Devanagari script), or Hinglish (Hindi words written in Latin/English script).
2. **Respond in Kind**: 
   - If the user asks in Hindi, respond strictly in Hindi (Devanagari).
   - If the user asks in Hinglish, respond strictly in Hinglish (Roman script).
   - If the user asks in English, respond strictly in English.
3. **Consistency**: Ensure the entire response (Summary, Analysis, Steps, and Suggestions) is in the SAME language as the user's input.
4. **Tone**: Maintain a professional, reassuring, and energetic tone across all languages.

**Formatting & Style Guidelines:**
1.  **NO TABLES**: Do NOT use Markdown tables. Use bulleted lists or clear paragraphs.
2.  **Structure**:
    *   **Summary**: A direct, reassuring 1-sentence summary.
    *   **Detailed Analysis**: Paragraphs with **bold** key terms.
    *   **Actionable Steps**: Bullet points for recommendations.
3.  **Rich Visuals**: Use emojis (🩺, 💊, 🥗, etc.) and headings (###).
4.  **Safety**: Always advise consulting a doctor for serious conditions.

**Suggested Questions**:
At the very end of your response, strictly add a separator line "---SUGGESTIONS---" followed by exactly 3 short, relevant follow-up questions in the SAME LANGUAGE as the response, separated by a pipe symbol "|".`;

// OPTIMIZED MODEL HIERARCHY
// 1. gemini-2.0-flash-exp: Fastest, most generous rate limits for free tier.
// 2. gemini-3-flash-preview: Newer, but sometimes strictly rate limited.
// 3. gemini-flash-latest: Stable fallback.
const MODEL_HIERARCHY = ['gemini-2.0-flash-exp', 'gemini-3-flash-preview', 'gemini-flash-latest'];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const LOCAL_QUOTES = [
  "Health is the greatest wealth.",
  "Take care of your body. It's the only place you have to live.",
  "A healthy outside starts from the inside.",
  "Your health is an investment, not an expense.",
  "Wellness is the complete integration of body, mind, and spirit."
];

/**
 * Streams the health response chunk by chunk with robust retry logic (Exponential Backoff).
 */
export async function* generateHealthResponseStream(
  text: string, 
  imageBase64?: string
): AsyncGenerator<string, void, unknown> {
  const ai = getAiClient();
  const parts: any[] = [];
  
  if (imageBase64) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageBase64
      }
    });
  }
  
  if (text) {
    parts.push({ text });
  }

  let lastError: any = null;

  // Try models in sequence
  for (const modelName of MODEL_HIERARCHY) {
    // Retry logic per model: 3 attempts with backoff
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const responseStream = await ai.models.generateContentStream({
          model: modelName, 
          contents: { parts },
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
          }
        });

        for await (const chunk of responseStream) {
          const chunkText = chunk.text;
          if (chunkText) {
            yield chunkText;
          }
        }
        // Success! Exit function entirely.
        return;

      } catch (error: any) {
        lastError = error;
        const isRateLimit = error.message?.includes('429') || error.status === 429;
        const isOverloaded = error.message?.includes('503') || error.status === 503;

        if (isRateLimit || isOverloaded) {
          const waitTime = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
          console.warn(`Model ${modelName} hit rate limit (429/503). Retrying in ${waitTime}ms...`);
          await delay(waitTime);
          continue; // Retry loop
        } else {
          // If it's a different error (e.g., 400 Bad Request), break to next model
          console.error(`Model ${modelName} error (non-retriable):`, error);
          break; 
        }
      }
    }
  }

  // If all models and retries failed
  console.error("All models failed.", lastError);
  let errorMessage = "I encountered an error while processing your request. ";
  
  if (lastError?.message) {
      if (lastError.message.includes('429')) errorMessage += "Traffic is exceptionally high right now. Please wait 1 minute and try again.";
      else if (lastError.message.includes('403')) errorMessage += "Access Denied. Please check API Key.";
      else errorMessage += "Please check your internet connection.";
  } else {
      errorMessage += "Please check your internet connection.";
  }
  
  yield errorMessage;
}

export async function generateHealthResponse(
  text: string, 
  imageBase64?: string
): Promise<string> {
  let fullText = "";
  for await (const chunk of generateHealthResponseStream(text, imageBase64)) {
    fullText += chunk;
  }
  return fullText;
}

export async function generateHealthQuote(): Promise<string> {
  try {
    const ai = getAiClient();
    // Try to get a fresh quote
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp', 
      contents: { parts: [{ text: "Generate a single, short, motivating health quote. No author names." }] },
    });
    return response.text?.trim() || LOCAL_QUOTES[0];
  } catch (error) {
    // Fail silently to local quotes to keep UI clean
    return LOCAL_QUOTES[Math.floor(Math.random() * LOCAL_QUOTES.length)];
  }
}

/**
 * Returns the Base64 audio string.
 */
export async function generateSpeech(text: string): Promise<string | null> {
  try {
    if (!text || text.trim().length === 0) return null;
    
    const ai = getAiClient();
    // TTS usually has separate quotas, so 2.5 is generally fine
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error) {
    console.warn("Error generating speech:", error);
    return null;
  }
}