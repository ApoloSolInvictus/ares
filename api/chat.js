const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";

const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "cedar";

const ARES_SYSTEM_PROMPT = `
Eres ARES, comandante de la Septima Dimension dentro de THE GRID: Sector Invictus.
Hablas en espanol con energia ceremonial, precision tecnica y tono protector.
Responde de forma clara, breve y util. Mantente en personaje sin mencionar politicas internas.
`;

function setCorsHeaders(req, res) {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || req.headers.origin || "*";

    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readJson(req) {
    if (req.body) {
        return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    }

    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");
    return rawBody ? JSON.parse(rawBody) : {};
}

function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];

    return history
        .filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
        .slice(-12)
        .map(item => ({
            role: item.role,
            content: item.content.slice(0, 4000)
        }));
}

function extractResponseText(data) {
    if (typeof data.output_text === "string" && data.output_text.trim()) {
        return data.output_text.trim();
    }

    const textParts = [];
    for (const item of data.output || []) {
        for (const content of item.content || []) {
            if (typeof content.text === "string") {
                textParts.push(content.text);
            } else if (typeof content.output_text === "string") {
                textParts.push(content.output_text);
            }
        }
    }

    return textParts.join("\n").trim();
}

async function createAresResponse(message, history) {
    const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: CHAT_MODEL,
            input: [
                { role: "system", content: ARES_SYSTEM_PROMPT },
                ...normalizeHistory(history),
                { role: "user", content: message }
            ],
            max_output_tokens: 650,
            store: false
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const errorMessage = data.error?.message || "OpenAI no pudo generar la respuesta.";
        throw new Error(errorMessage);
    }

    const text = extractResponseText(data);
    if (!text) {
        throw new Error("OpenAI devolvio una respuesta vacia.");
    }

    return text;
}

async function createVoiceBase64(text) {
    const response = await fetch(OPENAI_SPEECH_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: TTS_MODEL,
            voice: TTS_VOICE,
            input: text.slice(0, 3500),
            instructions: "Voz profunda, clara y firme. Ritmo natural en espanol latino, con presencia de comandante futurista.",
            response_format: "mp3"
        })
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const errorMessage = data.error?.message || "OpenAI no pudo generar la voz.";
        throw new Error(errorMessage);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return audioBuffer.toString("base64");
}

module.exports = async function handler(req, res) {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Metodo no permitido." });
    }

    if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: "Falta configurar OPENAI_API_KEY en Vercel." });
    }

    try {
        const { message, history } = await readJson(req);
        const cleanMessage = typeof message === "string" ? message.trim() : "";

        if (!cleanMessage) {
            return res.status(400).json({ error: "El mensaje es requerido." });
        }

        const responseText = await createAresResponse(cleanMessage.slice(0, 4000), history);
        let audioBase64 = null;
        let voiceWarning = null;

        try {
            audioBase64 = await createVoiceBase64(responseText);
        } catch (error) {
            voiceWarning = error.message;
        }

        return res.status(200).json({
            response: responseText,
            audio_base64: audioBase64,
            voice_warning: voiceWarning
        });
    } catch (error) {
        console.error("ARES API error:", error);
        return res.status(500).json({
            error: "ARES no pudo responder.",
            details: error.message
        });
    }
};
