import { NextResponse } from "next/server";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434/api/chat";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:0.5b";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;

const SYSTEM_PROMPT = `You are Xenon, a calm, capable voice assistant with a deep, human-like presence.
Answer conversationally and clearly. Give one direct sentence first, and keep most answers under 35 words unless the user asks for detail.
Do not claim to have performed actions you cannot perform. Never use markdown headings, lists, or emojis because your reply will be spoken aloud.`;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function resolveModelProvider() {
  if (GEMINI_API_KEY) return "gemini";
  if (OPENAI_API_KEY) return "openai";
  if (AZURE_OPENAI_ENDPOINT && AZURE_OPENAI_API_KEY && AZURE_OPENAI_DEPLOYMENT) return "azure-openai";
  if (process.env.OLLAMA_URL || process.env.OLLAMA_MODEL) return "ollama";
  return "ollama";
}

async function askGemini(previousMessages: ChatMessage[], message: string) {
  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
  );
  url.searchParams.set("key", GEMINI_API_KEY!);

  const requestBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      ...previousMessages.map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      })),
      { role: "user", parts: [{ text: message.trim().slice(0, 4000) }] },
    ],
    generationConfig: { temperature: 0.45, maxOutputTokens: 220 },
  };

  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status !== 503 || attempt === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }

  if (!response || !response.ok) {
    const errorText = response ? await response.text() : "No response from Gemini.";
    throw new Error(`Gemini request failed (${response?.status ?? "network"}): ${errorText}`);
  }

  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const answer = body.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!answer) throw new Error("Gemini returned no answer.");
  return answer;
}

async function askOpenAI(previousMessages: ChatMessage[], message: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.45,
      max_tokens: 220,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...previousMessages,
        { role: "user", content: message.trim().slice(0, 4000) },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const answer = body.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("OpenAI returned no answer.");
  return answer;
}

async function askAzureOpenAI(previousMessages: ChatMessage[], message: string) {
  const endpoint = AZURE_OPENAI_ENDPOINT!.replace(/\/?$/, "");
  const url = new URL(`${endpoint}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions`);
  url.searchParams.set("api-version", "2024-06-01");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": AZURE_OPENAI_API_KEY!,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...previousMessages,
        { role: "user", content: message.trim().slice(0, 4000) },
      ],
      temperature: 0.45,
      max_tokens: 220,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure OpenAI request failed (${response.status}): ${errorText}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const answer = body.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("Azure OpenAI returned no answer.");
  return answer;
}

async function askOllama(previousMessages: ChatMessage[], message: string) {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...previousMessages,
        { role: "user", content: message.trim().slice(0, 4000) },
      ],
      options: { temperature: 0.45, num_predict: 60, num_ctx: 1024 },
      keep_alive: "30m",
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const body = (await response.json()) as { message?: { content?: string } };
  const answer = body.message?.content?.trim();
  if (!answer) throw new Error("Ollama returned no answer");
  return answer;
}

export async function POST(request: Request) {
  let message: unknown;
  let history: unknown;
  try {
    ({ message, history } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Please say or type a question." }, { status: 400 });
  }

  const previousMessages: ChatMessage[] = Array.isArray(history)
    ? history
        .filter(
          (item): item is ChatMessage =>
            item !== null
            && typeof item === "object"
            && "role" in item
            && "content" in item
            && (item.role === "user" || item.role === "assistant")
            && typeof item.content === "string",
        )
        .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 4000) }))
        .filter((item) => item.content)
        .slice(-10)
    : [];

  try {
    const provider = resolveModelProvider();
    const finalAnswer =
      provider === "gemini"
        ? await askGemini(previousMessages, message)
        : provider === "openai"
        ? await askOpenAI(previousMessages, message)
        : provider === "azure-openai"
          ? await askAzureOpenAI(previousMessages, message)
          : await askOllama(previousMessages, message);

    return NextResponse.json({ answer: finalAnswer });
  } catch (error) {
    const provider = resolveModelProvider();
    const errorMessage = error instanceof Error ? error.message : "Unknown model error";
    const friendlyError =
      provider === "gemini"
        ? "The hosted Gemini model is unavailable right now. Check GEMINI_API_KEY and GEMINI_MODEL."
        : provider === "openai"
        ? "The hosted OpenAI model is unavailable right now. Check the OPENAI_API_KEY and model configuration."
        : provider === "azure-openai"
          ? "The hosted Azure OpenAI model is unavailable right now. Check the AZURE_OPENAI_* settings."
          : `Ollama is unavailable or the ${OLLAMA_MODEL} model is busy. Open Ollama and try again.`;

    return NextResponse.json(
      {
        error: `${friendlyError} ${errorMessage}`,
      },
      { status: 503 },
    );
  }
}

export async function PUT() {
  const provider = resolveModelProvider();
  if (provider !== "ollama") {
    return new Response(null, { status: 204 });
  }

  try {
    await fetch(OLLAMA_URL.replace("/api/chat", "/api/generate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: "", keep_alive: "30m" }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Warm-up is opportunistic; POST will show the useful error if unavailable.
  }
  return new Response(null, { status: 204 });
}
