import { GoogleGenAI, Modality } from "@google/genai";

const API_KEY = process.env.API_KEY || ''; 

// Singleton instance wrapper to prevent top-level initialization crashes
let aiInstance: GoogleGenAI | null = null;

const getAiClient = (): GoogleGenAI => {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: API_KEY });
  }
  return aiInstance;
};

// System instruction for standard chat with Multilingual Support
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

/**
 * Streams the health response chunk by chunk for faster UI feedback.
 */
export async function* generateHealthResponseStream(
  text: string, 
  imageBase64?: string
): AsyncGenerator<string, void, unknown> {
  try {
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

    // Using gemini-3-pro-preview for advanced health reasoning and multilingual tasks
    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-3-pro-preview', 
      contents: { parts },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        thinkingConfig: { thinkingBudget: 32768 } 
      }
    });

    for await (const chunk of responseStream) {
      const chunkText = chunk.text;
      if (chunkText) {
        yield chunkText;
      }
    }
  } catch (error) {
    console.error("Error generating health response stream:", error);
    yield "I encountered an error while processing your request. Please check your connection.";
  }
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
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: [{ text: "Generate a single, short, motivating health quote. It can be in English, Hindi, or Hinglish. No author names." }] },
      config: {
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    return response.text?.trim() || "Health is the greatest wealth.";
  } catch (error) {
    return "Your health is an investment, not an expense.";
  }
}

/**
 * Returns the Base64 audio string.
 * The TTS model automatically adapts its pronunciation to Hindi/Hinglish/English based on the text.
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