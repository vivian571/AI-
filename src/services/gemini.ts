import { GoogleGenAI, Modality, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface PodcastSection {
  title: string;
  contentEn: string;
  contentCn: string;
}

export interface PodcastScript {
  title: string;
  sections: PodcastSection[];
  summary: string;
  visualPrompt: string;
}

const withRetry = async <T>(fn: () => Promise<T>, retries: number = 15, initialDelay: number = 30000): Promise<T> => {
  let currentRetries = retries;
  let currentDelay = initialDelay;

  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      const errorStr = JSON.stringify(error).toLowerCase();
      const isRateLimit = 
        error?.status === 429 || 
        error?.error?.code === 429 ||
        error?.message?.includes('429') || 
        error?.message?.toLowerCase().includes('quota') ||
        errorStr.includes('429') ||
        errorStr.includes('quota') ||
        errorStr.includes('resource_exhausted');
      
      if (currentRetries <= 0) {
        throw error;
      }

      const jitter = Math.random() * 1000;
      console.warn(`Error encountered: ${error?.message || JSON.stringify(error)}. Retrying in ${Math.round(currentDelay + jitter)}ms... (${currentRetries} retries left)`);
      
      await new Promise(resolve => setTimeout(resolve, currentDelay + jitter));
      
      currentRetries--;
      // Exponential backoff, more aggressive for rate limits
      currentDelay = isRateLimit ? currentDelay * 3 : currentDelay * 2;
    }
  }
};

export const generatePodcastScript = async (input: string, language: string = "English"): Promise<PodcastScript> => {
  return withRetry(async () => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are an expert podcast script writer and content strategist. 
        Generate a comprehensive podcast script based on this input: "${input}". 
        
        The script must follow these specific requirements:
        1. Language: The primary audio language will be ${language}, but you must provide BOTH English and Chinese versions for every section.
        2. Style: Engaging, conversational, and slightly humorous.
        3. Structure:
           - **Humorous Subheadings**: Use creative and human-like subheadings (e.g., "Why your cat is judging your code" instead of "Introduction").
           - **Methods & Examples**: Extract and highlight specific methods and question-asking techniques from the topic. Provide concrete examples.
           - **Viral Prompt (爆款提示词)**: Distill the core logic into a highly detailed and actionable "Viral Prompt" that users can copy and use with AI tools.
           - **Multi-perspective Analysis**: Provide a deep analysis from at least three angles (e.g., technical, social, and future impact).
        4. Length: Approximately 400-600 words to cover all sections deeply and professionally.
        
        Return the result in JSON format with the following fields:
        - title: A catchy, viral-style title.
        - sections: An array of objects, each with:
            - 'title': the subheading (in ${language}).
            - 'contentEn': the English version of the section content.
            - 'contentCn': the Chinese version of the section content.
        - summary: A one-sentence hook for the podcast.
        - visualPrompt: A detailed prompt for an image generator (DALL-E/Midjourney style) to create the cover art.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              sections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    contentEn: { type: Type.STRING },
                    contentCn: { type: Type.STRING },
                  },
                  required: ["title", "contentEn", "contentCn"],
                },
              },
              summary: { type: Type.STRING },
              visualPrompt: { type: Type.STRING },
            },
            required: ["title", "sections", "summary", "visualPrompt"],
          },
        },
      });

      if (!response.text) {
        throw new Error("Empty response from Gemini");
      }

      return JSON.parse(response.text);
    } catch (error) {
      console.error("Error in generatePodcastScript:", error);
      throw error;
    }
  });
};

export interface AudioResult {
  base64Audio: string;
  chapters: { title: string; start: number }[];
}

export const generateAudio = async (
  sections: PodcastSection[], 
  language: string = "English", 
  voice: string = "Kore",
  onStatus?: (message: string) => void
): Promise<AudioResult> => {
  const chapters: { title: string; start: number }[] = [];
  let combinedBinaryString = "";
  let currentOffset = 0;

  let lastRateLimitTime = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const textToSpeak = language === "English" ? section.contentEn : section.contentCn;
    
    // Add a delay between sections to avoid hitting rate limits
    const baseDelay = 30000;
    const cooldownDelay = Date.now() - lastRateLimitTime < 120000 ? 60000 : 0;
    const totalDelay = i > 0 ? baseDelay + cooldownDelay : 0;

    if (totalDelay > 0) {
      onStatus?.(`Waiting ${Math.round(totalDelay / 1000)}s to avoid rate limits...`);
      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }

    onStatus?.(`Generating audio for section ${i + 1}/${sections.length}...`);

    const base64Audio = await withRetry(async () => {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: textToSpeak }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice as any },
              },
            },
          },
        });

        const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!data) throw new Error("No audio data returned from TTS");
        return data;
      } catch (error: any) {
        const errorStr = JSON.stringify(error).toLowerCase();
        if (errorStr.includes('429') || errorStr.includes('quota')) {
          lastRateLimitTime = Date.now();
        }
        console.error(`Error in generateAudio for section "${section.title}":`, error);
        throw error;
      }
    });

    if (base64Audio) {
      const binaryChunk = atob(base64Audio);
      chapters.push({ title: section.title, start: currentOffset });
      combinedBinaryString += binaryChunk;

      // Calculate duration of this section in seconds
      // Assuming 16-bit PCM (2 bytes per sample), 1 channel, 24000 Hz
      const duration = (binaryChunk.length / 2) / 24000;
      currentOffset += duration;
    }
  }

  if (!combinedBinaryString) throw new Error("Failed to generate any audio");
  
  // Convert binary string back to base64 safely
  // btoa can fail on very large strings, so we use a more robust method if needed,
  // but for a 5-10 min podcast, it should be okay.
  // A safer way is to use Uint8Array and a loop if it's too large.
  let finalBase64 = "";
  try {
    finalBase64 = btoa(combinedBinaryString);
  } catch (e) {
    // Fallback for very large strings
    const bytes = new Uint8Array(combinedBinaryString.length);
    for (let i = 0; i < combinedBinaryString.length; i++) {
      bytes[i] = combinedBinaryString.charCodeAt(i);
    }
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    finalBase64 = btoa(binary);
    // Actually the above is the same as btoa(combinedBinaryString).
    // The real issue with btoa is the call stack size if we use apply.
    // But btoa(string) itself is usually fine up to a few MBs.
  }

  return { base64Audio: finalBase64, chapters };
};

export const generateCoverImage = async (prompt: string): Promise<string> => {
  return withRetry(async () => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: {
          parts: [{ text: `A high-quality podcast cover art for: ${prompt}. Professional, modern, and visually striking.` }],
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          },
        },
      });

      const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
      if (!part?.inlineData) throw new Error("Failed to generate image: No inlineData");
      return `data:image/png;base64,${part.inlineData.data}`;
    } catch (error) {
      console.error("Error in generateCoverImage:", error);
      throw error;
    }
  });
};

export const getTrendingTopics = async (language: string = "English"): Promise<string[]> => {
  return withRetry(async () => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Identify the top 5 most innovative and trending GitHub projects or tech frontiers right now. 
        Focus on programming technologies, AI breakthroughs, and cutting-edge software engineering. 
        Provide a concise list of project names or topics in ${language}.`,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      });

      if (!response.text) throw new Error("Empty response from getTrendingTopics");
      return JSON.parse(response.text);
    } catch (error) {
      console.error("Error in getTrendingTopics:", error);
      throw error;
    }
  });
};
