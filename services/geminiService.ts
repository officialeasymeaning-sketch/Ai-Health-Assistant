import { GoogleGenAI, Modality } from "@google/genai";

// HARDCODED KEY AS REQUESTED - ENSURING IT IS USED DIRECTLY
const API_KEY = 'AIzaSyDD6FI6qBvUiwBOIAN4huqtr00rSM75k5A';

export const getApiKey = (): string => {
  return API_KEY;
};

// Singleton instance wrapper
let aiInstance: GoogleGenAI | null = null;

const getAiClient = (): GoogleGenAI => {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: API_KEY });
  }
  return aiInstance;
};

const SYSTEM_INSTRUCTION = `You are an expert AI Health Assistant.
Analyze symptoms provided via text or images and provide detailed, professional, and empathetic health advice.

**PROTOCOL**:
1. **Detect Language**: Respond in the SAME language as the user (English, Hindi, or Hinglish).
2. **Structure**: 
   - **Summary**: 1-sentence reassurance.
   - **Analysis**: Clear paragraphs.
   - **Steps**: Bullet points.
3. **Safety**: Always advise consulting a doctor.

**Formatting**: Use bolding for key terms. Do not use markdown tables.

**Ending**:
End with "---SUGGESTIONS---" followed by 3 short follow-up questions separated by "|".`;

// OPTIMIZED MODEL HIERARCHY FOR STABILITY
// 1. gemini-2.0-flash-exp: Highly capable and fast.
// 2. gemini-flash-latest: The current stable production version (fallback).
const MODEL_HIERARCHY = ['gemini-2.0-flash-exp', 'gemini-flash-latest'];

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
    const ai = getAiClient();
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
      // Retry Loop (2 attempts per model)
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const responseStream = await ai.models.generateContentStream({
            model: modelName, 
            contents: { parts },
            config: { 
              systemInstruction: SYSTEM_INSTRUCTION,
            }
          });

          for await (const chunk of responseStream) {
            if (chunk.text) yield chunk.text;
          }
          return; // Success, exit function

        } catch (error: any) {
          lastError = error;
          const msg = error.message || '';
          
          // Log for debugging
          console.warn(`Attempt failed on ${modelName}:`, msg);

          // Retryable Errors (Rate Limit 429 / Overload 503 / Network)
          if (msg.includes('429') || msg.includes('503') || msg.includes('fetch')) {
            await delay(1000 * (attempt + 1));
            continue;
          }
          
          // If it's a 404 (Model not found) or 400 (Bad Request), break to next model
          break;
        }
      }
    }
    
    // If we reach here, all models failed
    console.error("All models failed:", lastError);
    yield "I am currently experiencing high traffic or a connection issue. Please try again in a few seconds.";

  } catch (error: any) {
    console.error("Critical Stream Error:", error);
    yield "I encountered a technical error. Please check your internet connection.";
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
    // Using 2.5 for TTS as it supports the audio modality well
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