# XENON — local voice AI

An Iron Man–inspired holographic voice assistant built with **Next.js**, **Three.js**, and **MediaPipe**. Xenon listens to your question, asks a local AI model for an answer, and speaks it back.

> 🔮 This is the open-source **interface** of [ULTRON](https://sagartamang.com/projects/ultron) — my AI that talks in real time and controls Android devices by itself. **[Read the write-up](https://sagartamang.com/projects/ultron)** or **[the X post](https://x.com/sagar_builds/status/2077277583646101921)**

> 📱 **[Watch the demo on Instagram](https://www.instagram.com/p/DayJ17OTwvx/)**

![XENON video UI](docs/screenshot.png)

https://github.com/user-attachments/assets/91578a83-9a27-44e8-84b0-96defcfd7366

## Getting started

```bash
npm install
npm run dev
```

## Stable hosted setup

For a deployment that works reliably away from your laptop, use a hosted model provider instead of Ollama.

Recommended no-cost start: Google Gemini via Google AI Studio. The free tier has usage limits and can change, but it does not require a paid OpenAI account.

```bash
cp .env.example .env
```

Then set:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash
```

Create your own key at https://aistudio.google.com/app/apikey. Never commit the key to GitHub; add it only as a Render environment variable.

This keeps the app working on Render or any other public host without depending on your PC being on 24/7. Free-tier quotas and Render's free-service sleep limits still apply.

Paid fallback: OpenAI

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

Alternative: Azure OpenAI

```bash
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your_key_here
AZURE_OPENAI_DEPLOYMENT=your-model-deployment-name
```

## Local fallback (optional)

If you still want to test locally, Xenon's brain can run through [Ollama](https://ollama.com) on your computer. Install Ollama, then run:

```bash
ollama pull qwen2.5:0.5b
```

Keep Ollama running and open the app at [http://localhost:3001](http://localhost:3001). The default model is `qwen2.5:0.5b`; set `OLLAMA_MODEL` to use another installed model, or `OLLAMA_URL` if Ollama is hosted elsewhere.

Voice input uses Chrome or Edge's built-in speech recognition. Voice replies use the free voices installed on your computer. Xenon prefers a lower-pitched English voice when one is available; install another system voice if you want a different character.

Open [http://localhost:3000](http://localhost:3000).

## Controls

## How it works

- **`public/black-hole-dark-space-moewalls-com.mp4`** — the looping visual
  background.
- **`components/JarvisOrb.tsx`** — the voice console, speech controls, and
  conversation history.

Hand gestures and the previous interactive orb are currently disabled.

## License

MIT
