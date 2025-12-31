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
    console.warn("Invalid or missing environment API_KEY, using fallback.");
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

// Models to try in order of preference
// Note: gemini-3-flash-preview is the preferred model, but we fallback to 2.0-flash-exp if it fails/is unavailable.
const MODEL_HIERARCHY = ['gemini-3-flash-preview', 'gemini-2.0-flash-exp'];

/**
 * Streams the health response chunk by chunk with fallback support.
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
      // If we successfully yielded content, return immediately (don't try next model)
      return;
    } catch (error: any) {
      console.error(`Model ${modelName} failed:`, error);
      lastError = error;
      // Continue to next model in loop
    }
  }

  // If all models failed
  console.error("All models failed.", lastError);
  let errorMessage = "I encountered an error while processing your request. ";
  
  if (lastError?.message) {
      if (lastError.message.includes('403')) errorMessage += "Access Denied (403). check API Key restrictions.";
      else if (lastError.message.includes('429')) errorMessage += "Traffic is high (429). Please try again in a moment.";
      else if (lastError.message.includes('503')) errorMessage += "Service overloaded (503).";
      else errorMessage += `Details: ${lastError.message}`;
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
    // Use the reliable fallback model for simple tasks like quotes
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp', 
      contents: { parts: [{ text: "Generate a single, short, motivating health quote. It can be in English, Hindi, or Hinglish. No author names." }] },
    });
    return response.text?.trim() || "Health is the greatest wealth.";
  } catch (error) {
    return "Your health is an investment, not an expense.";
  }
}

/**
 * Returns the Base64 audio string.
 */
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