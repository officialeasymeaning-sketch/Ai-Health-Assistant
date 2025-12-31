import { GoogleGenAI, Modality } from "@google/genai";

/**
 * Robustly retrieves the API key.
 * Priority: 
 * 1. Local Storage (User override for deployed apps)
 * 2. Environment Variable (Vercel/Local)
 */
export const getApiKey = (): string => {
  // 1. Check Browser Local Storage
  if (typeof window !== 'undefined') {
    const localKey = localStorage.getItem('GEMINI_API_KEY');
    if (localKey && localKey.length > 10) return localKey.trim();
  }
  
  // 2. Check Environment Variable
  const envKey = process.env.API_KEY;
  if (envKey && envKey.length > 10 && envKey.startsWith('AIza')) {
    return envKey.trim();
  }

  // Return empty to trigger "Missing Key" logic in UI
  return '';
};

// Singleton instance wrapper
let aiInstance: GoogleGenAI | null = null;
let currentKey: string | null = null;

const getAiClient = (): GoogleGenAI => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error("MISSING_API_KEY");
  }

  // Re-initialize if key changes
  if (!aiInstance || currentKey !== apiKey) {
    aiInstance = new GoogleGenAI({ apiKey });
    currentKey = apiKey;
  }
  return aiInstance;
};

const SYSTEM_INSTRUCTION = `You are an expert AI Health Assistant with advanced multilingual capabilities.
Analyze symptoms provided via text or images and provide detailed, professional, and empathetic health advice.

**LANGUAGE DETECTION & RESPONSE PROTOCOL**:
1. **Detect Language**: Identify if the user is communicating in English, Hindi (Devanagari script), or Hinglish.
2. **Respond in Kind**: Respond in the SAME language as the user's input.
3. **Consistency**: Ensure the entire response is consistent in language.

**Formatting**:
*   **Summary**: A direct, reassuring 1-sentence summary.
*   **Detailed Analysis**: Paragraphs with **bold** key terms.
*   **Actionable Steps**: Bullet points.
*   **Safety**: Always advise consulting a doctor.

**Suggested Questions**:
At the very end, add "---SUGGESTIONS---" followed by 3 short follow-up questions separated by "|" pipe.`;

// Optimized Model Hierarchy
const MODEL_HIERARCHY = ['gemini-3-flash-preview', 'gemini-2.0-flash-exp'];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const LOCAL_QUOTES = [
  "Health is the greatest wealth.",
  "Take care of your body. It's the only place you have to live.",
  "A healthy outside starts from the inside.",
  "Your health is an investment, not an expense.",
  "Wellness is the complete integration of body, mind, and spirit."
];

export async function* generateHealthResponseStream(
  text: string, 
  imageBase64?: string
): AsyncGenerator<string, void, unknown> {
  try {
    const ai = getAiClient(); // Will throw if no key
    const parts: any[] = [];
    
    if (imageBase64) {
      parts.push({
        inlineData: { mimeType: 'image/jpeg', data: imageBase64 }
      });
    }
    if (text) parts.push({ text });

    let lastError: any = null;

    // Model Fallback Loop
    for (const modelName of MODEL_HIERARCHY) {
      // Retry Loop
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const responseStream = await ai.models.generateContentStream({
            model: modelName, 
            contents: { parts },
            config: { systemInstruction: SYSTEM_INSTRUCTION }
          });

          for await (const chunk of responseStream) {
            if (chunk.text) yield chunk.text;
          }
          return; // Success

        } catch (error: any) {
          lastError = error;
          const msg = error.message || '';
          
          // Critical Errors - Stop immediately and report
          if (msg.includes('403') || msg.includes('API key')) {
             yield "ACCESS_DENIED_ERROR";
             return;
          }

          // Retryable Errors (Rate Limit/Overload)
          if (msg.includes('429') || msg.includes('503')) {
            console.warn(`Model ${modelName} busy. Retrying...`);
            await delay(1500 * (attempt + 1));
            continue;
          }
          
          // Other errors: try next model
          break;
        }
      }
    }
    
    // If we get here, all failed
    throw lastError;

  } catch (error: any) {
    console.error("Stream Error:", error);
    if (error.message === 'MISSING_API_KEY') {
      yield "MISSING_API_KEY_ERROR";
    } else if (error.message?.includes('403') || error.message?.includes('API key')) {
      yield "ACCESS_DENIED_ERROR";
    } else {
      yield "I encountered a connection error. Please try again in a moment.";
    }
  }
}

export async function generateHealthResponse(text: string, imageBase64?: string): Promise<string> {
  let fullText = "";
  for await (const chunk of generateHealthResponseStream(text, imageBase64)) {
    fullText += chunk;
  }
  return fullText;
}

export async function generateHealthQuote(): Promise<string> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) return LOCAL_QUOTES[0];

    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp', 
      contents: { parts: [{ text: "Generate a single, short, motivating health quote. No author names." }] },
    });
    return response.text?.trim() || LOCAL_QUOTES[0];
  } catch (error) {
    return LOCAL_QUOTES[Math.floor(Math.random() * LOCAL_QUOTES.length)];
  }
}

export async function generateSpeech(text: string): Promise<string | null> {
  try {
    if (!text || text.trim().length === 0) return null;
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    console.warn("Speech Error:", error);
    return null;
  }
}