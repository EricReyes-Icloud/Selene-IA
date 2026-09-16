import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildSystemInstruction } from "../config/systemInstruction";

// API Key from environment variables
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(API_KEY);

// Priority list for models
const MODEL_PRIORITY = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];

class SmartChatSession {
    constructor() {
        this.modelIndex = 0;
        this.history = [];
        this.currentSession = null;
        this.initializeSession();
    }

    initializeSession() {
        const modelName = MODEL_PRIORITY[this.modelIndex];
        //console.log(`[SmartSession] Initializing with model: ${modelName}`);

        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: buildSystemInstruction()
        });

        this.currentSession = model.startChat({
            history: this.history,
            generationConfig: {
                maxOutputTokens: 2000,
            },
        });
    }

    async sendMessage(message) {
        try {
            console.log(`[SmartSession] Sending message via ${MODEL_PRIORITY[this.modelIndex]}...`);
            const result = await this.currentSession.sendMessage(message);
            this.history = await this.currentSession.getHistory();
            return result;
        } catch (error) {
            console.warn(`[SmartSession] Error with ${MODEL_PRIORITY[this.modelIndex]}:`, error);

            if (this.switchModel()) {
                console.log(`[SmartSession] Retrying with new model...`);
                this.initializeSession();
                return await this.sendMessage(message);
            }

            throw error;
        }
    }

    switchModel() {
        if (this.modelIndex < MODEL_PRIORITY.length - 1) {
            this.modelIndex++;
            console.log(`[SmartSession] Switching fallback to: ${MODEL_PRIORITY[this.modelIndex]}`);
            return true;
        }

        return false;
    }
}

export const GeminiService = {
    startChat: () => {
        return new SmartChatSession();
    },

    generateTitle: async (message) => {
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
            const result = await model.generateContent(`
                Genera un titulo muy corto, conciso y directo (maximo 4 palabras) para esta conversacion
                basado en el siguiente mensaje del usuario.
                No uses comillas, ni puntos finales, ni texto extra como "Titulo:".
                Mensaje: "${message}"
            `);
            const response = await result.response;
            return response.text().trim();
        } catch (error) {
            console.warn("Title generation failed:", error);
            return message.substring(0, 20) + "...";
        }
    }
};
