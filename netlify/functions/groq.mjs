// Groq API proxy for Netlify serverless function with Gemini fallback
// Same pattern as the kanji-reading-practice app

async function callGroq(messages, model, temperature, max_tokens) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY not configured");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${errorText}`);
  }

  return await response.json();
}

async function callGemini(messages, temperature, max_tokens) {
  // Convert messages to Gemini format
  const systemMessage = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role === 'user');
  
  const contents = userMessages.map(m => ({
    role: 'user',
    parts: [{ text: m.content }]
  }));

  // Add system instruction if present
  const requestBody = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: max_tokens,
    },
  };

  if (systemMessage) {
    requestBody.systemInstruction = {
      parts: [{ text: systemMessage.content }]
    };
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${errorText}`);
  }

  const data = await response.json();
  
  // Convert Gemini response to OpenAI-compatible format
  return {
    choices: [{
      message: {
        content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
        role: 'assistant'
      }
    }]
  };
}

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // Handle preflight CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { messages, model = "llama-3.3-70b-versatile", temperature = 0.7, max_tokens = 4000 } = JSON.parse(event.body);

    // Try Groq first
    try {
      const data = await callGroq(messages, model, temperature, max_tokens);
      return {
        statusCode: 200,
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      };
    } catch (groqError) {
      // Check if it's a rate limit error
      const errorMsg = groqError.message;
      const isRateLimit = errorMsg.includes('rate_limit_exceeded') || 
                          errorMsg.includes('Rate limit') || 
                          errorMsg.includes('rate limit') ||
                          errorMsg.includes('tokens per day') ||
                          errorMsg.includes('TPD');
      
      console.log('Groq error:', errorMsg);
      console.log('Is rate limit:', isRateLimit);
      
      if (isRateLimit) {
        console.log('Groq rate limit hit, falling back to Gemini...');
        try {
          const data = await callGemini(messages, temperature, max_tokens);
          return {
            statusCode: 200,
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
          };
        } catch (geminiError) {
          console.log('Gemini error:', geminiError.message);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `Both APIs failed. Groq: ${errorMsg}. Gemini: ${geminiError.message}` }),
          };
        }
      }
      // Re-throw non-rate-limit errors
      throw groqError;
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};