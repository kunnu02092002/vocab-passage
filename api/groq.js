// Vercel-compatible serverless function for the Vocab Passage app.
// Same functionality as netlify/functions/groq.mjs but using Vercel's
// standard Node.js runtime with CommonJS module.exports default function.
//
// Vercel routes:
//   POST /api/groq       -> this function
//
// Required environment variables:
//   GROQ_API_KEY    (required) - Groq API key
//   GEMINI_API_KEY  (optional) - Gemini API key, needed only if provider=gemini

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function callGroq({ messages, model, temperature, max_tokens }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens,
      // JSON mode forces the model to return valid JSON, eliminating
      // chain-of-thought leaks like "Let's draft paragraph by paragraph..."
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${errorText}`);
  }
  return await response.json();
}

async function callGemini({ messages, temperature, max_tokens, model = "gemini-3.5-flash" }) {
  const systemMessage = messages.find((m) => m.role === "system");
  const userMessages = messages.filter((m) => m.role === "user");

  const contents = userMessages.map((m) => ({
    role: "user",
    parts: [{ text: m.content }],
  }));

  const requestBody = { contents, generationConfig: { temperature, maxOutputTokens: max_tokens } };
  if (systemMessage) {
    requestBody.systemInstruction = { parts: [{ text: systemMessage.content }] };
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) throw new Error("GEMINI_API_KEY not configured");

  const response = await fetch(
    `${GEMINI_BASE}/${model}:generateContent?key=${geminiApiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${errorText}`);
  }
  const data = await response.json();
  return {
    choices: [{
      message: {
        content: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
        role: "assistant",
      },
    }],
  };
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const { messages, model = "llama-3.3-70b-versatile", temperature = 0.7, max_tokens = 4000, provider = "auto" } = req.body || {};

    if (provider === "gemini") {
      try {
        const data = await callGemini({ messages, temperature, max_tokens });
        res.status(200).json(data);
      } catch (err) {
        res.status(500).json({ error: `Gemini API failed: ${err.message}` });
      }
      return;
    }

    if (provider === "groq") {
      try {
        const data = await callGroq({ messages, model, temperature, max_tokens });
        res.status(200).json(data);
      } catch (err) {
        res.status(500).json({ error: `Groq API failed: ${err.message}` });
      }
      return;
    }

    // Auto: try Groq first, fall back to Gemini on rate limit
    try {
      const data = await callGroq({ messages, model, temperature, max_tokens });
      res.status(200).json(data);
    } catch (err) {
      const msg = err.message || "";
      const isRateLimit =
        msg.includes("rate_limit_exceeded") ||
        msg.includes("Rate limit") ||
        msg.includes("rate limit") ||
        msg.includes("tokens per day") ||
        msg.includes("TPD");
      if (isRateLimit) {
        try {
          const data = await callGemini({ messages, temperature, max_tokens });
          res.status(200).json(data);
          return;
        } catch (err2) {
          res.status(500).json({ error: `Both APIs failed. Groq: ${msg}. Gemini: ${err2.message}` });
          return;
        }
      }
      res.status(500).json({ error: `Groq API failed: ${msg}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
