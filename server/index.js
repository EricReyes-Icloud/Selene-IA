import express from "express";
import cors from "cors";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildSystemInstruction } from "../src/config/systemInstruction.js";

// --- Config ---
const PORT = 3001;
const MODEL_PRIORITY = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
const CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const USAGE_LOG_PATH = join(__dirname, "data", "usage.log.jsonl");

// --- API Key ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error("[server] GEMINI_API_KEY is not set. Add it to .env");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);

// --- Express setup ---
const app = express();

app.use(
    cors({
        origin(origin, callback) {
            // Allow requests with no origin (curl, server-to-server)
            if (!origin || CORS_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
    })
);

app.use(express.json({ limit: "1mb" }));

// --- Helpers ---

function ensureUsageLogDir() {
    const dir = dirname(USAGE_LOG_PATH);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

function logUsage({ userId, chatId, endpoint, model, usageMetadata }) {
    ensureUsageLogDir();
    const entry = {
        ts: new Date().toISOString(),
        userId,
        chatId,
        endpoint,
        model,
        tokens: {
            prompt: usageMetadata?.promptTokenCount ?? 0,
            candidates: usageMetadata?.candidatesTokenCount ?? 0,
            total: usageMetadata?.totalTokenCount ?? 0,
        },
    };
    appendFileSync(USAGE_LOG_PATH, JSON.stringify(entry) + "\n");
}

const TITLE_PROMPT = `
Genera un titulo muy corto, conciso y directo (maximo 4 palabras) para esta conversacion
basado en el siguiente mensaje del usuario.
No uses comillas, ni puntos finales, ni texto extra como "Titulo:".
Mensaje:`;

/**
 * Send a message to Gemini with fallback across MODEL_PRIORITY.
 * Returns { text, model } or throws on total failure.
 */
async function sendWithFallback(message, history, systemInstruction) {
    let lastError;

    for (const modelName of MODEL_PRIORITY) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                systemInstruction,
            });

            const chat = model.startChat({
                history,
                generationConfig: { maxOutputTokens: 2000 },
            });

            const result = await chat.sendMessage(message);
            const response = result.response;
            const text = response.text();

            return { text, model: modelName, usageMetadata: response.usageMetadata };
        } catch (err) {
            console.warn(`[server] Model ${modelName} failed:`, err.message);
            lastError = err;
        }
    }

    throw lastError;
}

/**
 * Generate a title using MODEL_PRIORITY[0] with fallback.
 */
async function generateTitle(message, history) {
    let lastError;

    for (const modelName of MODEL_PRIORITY) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(`${TITLE_PROMPT}\n"${message}"`);
            const response = result.response;
            const text = response.text().trim();

            return { text, model: modelName, usageMetadata: response.usageMetadata };
        } catch (err) {
            console.warn(`[server] Title model ${modelName} failed:`, err.message);
            lastError = err;
        }
    }

    throw lastError;
}

// --- Routes ---

app.post("/api/gemini/chat", async (req, res) => {
    try {
        const { userId, chatId, message, history = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Missing required field: message" });
        }

        const systemInstruction = buildSystemInstruction();
        const result = await sendWithFallback(message, history, systemInstruction);

        logUsage({
            userId,
            chatId,
            endpoint: "chat",
            model: result.model,
            usageMetadata: result.usageMetadata,
        });

        res.json({ text: result.text });
    } catch (err) {
        console.error("[server] /api/gemini/chat error:", err);
        res.status(500).json({ error: "Gemini API error" });
    }
});

app.post("/api/gemini/title", async (req, res) => {
    try {
        const { userId, chatId, message, history = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Missing required field: message" });
        }

        const result = await generateTitle(message, history);

        logUsage({
            userId,
            chatId,
            endpoint: "title",
            model: result.model,
            usageMetadata: result.usageMetadata,
        });

        res.json({ text: result.text });
    } catch (err) {
        console.error("[server] /api/gemini/title error:", err);
        res.status(500).json({ error: "Gemini API error" });
    }
});

// --- Start ---
app.listen(PORT, () => {
    console.log(`[server] Gemini proxy running on http://localhost:${PORT}`);
});
