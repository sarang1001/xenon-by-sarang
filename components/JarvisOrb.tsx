"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const CONVERSATION_STORAGE_KEY = "xenon-conversation";

type VoiceRecognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => VoiceRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

interface SpeechRecognitionEvent extends Event {
  results: { [index: number]: { [index: number]: { transcript: string } }; length: number };
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

export default function XenonOrb() {
  const recognitionRef = useRef<VoiceRecognition | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionTranscriptRef = useRef("");
  const recognitionHandledRef = useRef(false);
  const requestRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const speechRef = useRef(0);
  const conversationRef = useRef<ConversationMessage[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("I am Xenon. Ask me anything.");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("xenon-neural");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      const restored = parsed.filter(
        (item): item is ConversationMessage =>
          item !== null
          && typeof item === "object"
          && "role" in item
          && "content" in item
          && (item.role === "user" || item.role === "assistant")
          && typeof item.content === "string"
          && item.content.trim().length > 0,
      ).slice(-10);
      conversationRef.current = restored;
      const lastAnswer = [...restored].reverse().find((item) => item.role === "assistant");
      if (lastAnswer) setAnswer(lastAnswer.content);
    } catch {
      window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    }
  }, []);

  const saveConversation = useCallback((messages: ConversationMessage[]) => {
    const recent = messages.slice(-10);
    conversationRef.current = recent;
    window.localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(recent));
  }, []);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
    window.speechSynthesis.cancel();
    audioRef.current?.pause();
    requestAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    // Wake the local model while Xenon's interface is opening.
    void fetch("/api/chat", { method: "PUT" });
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      setVoices(available);
      if (!selectedVoice && available.length) {
        const defaultVoice = available.find((voice) => /en/i.test(voice.lang) && /microsoft david|microsoft mark|google us english male|daniel|guy|george/i.test(voice.name))
          ?? available.find((voice) => /en/i.test(voice.lang))
          ?? available[0];
        setSelectedVoice(defaultVoice.voiceURI);
      }
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, [selectedVoice]);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
    window.speechSynthesis.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    const speechId = ++speechRef.current;
    setSpeaking(false);

    if (selectedVoice === "xenon-neural") {
      void (async () => {
        try {
          const response = await fetch("/api/voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          if (!response.ok) throw new Error("Neural voice unavailable");
          const url = URL.createObjectURL(await response.blob());
          if (speechRef.current !== speechId) {
            URL.revokeObjectURL(url);
            return;
          }
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onplay = () => setSpeaking(true);
          audio.onended = audio.onerror = () => {
            URL.revokeObjectURL(url);
            if (speechRef.current === speechId && audioRef.current === audio) {
              audioRef.current = null;
              setSpeaking(false);
            }
          };
          await audio.play();
        } catch {
          // Fall back to the selected system voice below if neural speech is unavailable.
          setSelectedVoice(voices.find((voice) => /en/i.test(voice.lang))?.voiceURI ?? "");
        }
      })();
      return;
    }

    // Chromium can restart an utterance if a replacement starts in the same
    // event turn as cancel(). A short handoff eliminates the repeated opening.
    speechTimerRef.current = setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((voice) => voice.voiceURI === selectedVoice)
        ?? voices.find((voice) => /en/i.test(voice.lang) && /microsoft david|microsoft mark|google us english male|daniel|guy|george/i.test(voice.name))
        ?? voices.find((voice) => /en/i.test(voice.lang));
      if (preferred) utterance.voice = preferred;
      // Deep enough to feel grounded, but not so low that some system voices distort.
      utterance.rate = 1;
      utterance.pitch = 0.9;
      utterance.volume = 1;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = utterance.onerror = () => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
          setSpeaking(false);
        }
      };
      window.speechSynthesis.speak(utterance);
    }, 120);
  }, [selectedVoice, voices]);

  const askXenon = useCallback(async (rawQuestion: string) => {
    const prompt = rawQuestion.trim();
    if (!prompt || thinking) return;
    const requestId = ++requestRef.current;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    ++speechRef.current;
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis.cancel();
    setQuestion(prompt);
    setThinking(true);
    setError(null);
    setAnswer("Processing your request...");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, history: conversationRef.current }),
        signal: controller.signal,
      });
      const data = (await response.json()) as { answer?: string; error?: string };
      if (requestRef.current !== requestId) return;
      if (!response.ok || !data.answer) throw new Error(data.error ?? "Xenon could not respond.");
      saveConversation([
        ...conversationRef.current,
        { role: "user", content: prompt },
        { role: "assistant", content: data.answer },
      ]);
      setAnswer(data.answer);
      speak(data.answer);
    } catch (err) {
      if (controller.signal.aborted || requestRef.current !== requestId) return;
      const message = err instanceof Error ? err.message : "Xenon could not respond.";
      setAnswer(message);
      setError("BRAIN CONNECTION REQUIRED");
    } finally {
      if (requestRef.current === requestId) setThinking(false);
    }
  }, [saveConversation, speak, thinking]);

  const handleRequest = useCallback((rawQuestion: string) => {
    const command = rawQuestion.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
    const searchMatch = rawQuestion.match(/\b(?:search(?:\s+for)?|find|play)\s+(.+)/i);
    const youtubeSearch = command.includes("youtube") && searchMatch?.[1]
      ? searchMatch[1].replace(/[?.!]+$/, "").trim()
      : null;
    const action = youtubeSearch ? "search_youtube"
      : /\b(open|launch|start)\b/.test(command)
      ? command.includes("youtube") ? "open_youtube"
        : command.includes("chrome") ? "open_chrome"
          : command.includes("google") ? "open_google"
            : command.includes("notepad") ? "open_notepad"
              : null
      : null;

    if (!action) {
      void askXenon(rawQuestion);
      return;
    }

    void (async () => {
      ++requestRef.current;
      requestAbortRef.current?.abort();
      ++speechRef.current;
      audioRef.current?.pause();
      window.speechSynthesis.cancel();
      setQuestion(rawQuestion);
      setThinking(true);
      setError(null);
      setAnswer("Executing device command...");
      try {
        const response = await fetch("/api/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, query: youtubeSearch }),
        });
        const data = (await response.json()) as { answer?: string; error?: string };
        if (!response.ok || !data.answer) throw new Error(data.error ?? "Command failed.");
        setAnswer(data.answer);
        speak(data.answer);
      } catch (err) {
        setAnswer(err instanceof Error ? err.message : "Command failed.");
        setError("DEVICE COMMAND FAILED");
      } finally {
        setThinking(false);
      }
    })();
  }, [askXenon, speak]);

  const toggleListening = useCallback(async () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setError("VOICE INPUT NEEDS CHROME OR EDGE");
      return;
    }

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setListening(false);
      setError("HOST THIS SITE WITH HTTPS OR LOCALHOST TO USE MICROPHONE INPUT");
      return;
    }

    // Request the microphone explicitly first. SpeechRecognition often reports
    // only a vague error when this permission has not been granted yet.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      stream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      setListening(false);
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "ALLOW MICROPHONE ACCESS TO TALK"
          : "MICROPHONE IS UNAVAILABLE",
      );
      return;
    }

    window.speechSynthesis.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.languages?.[0] ?? navigator.language ?? "en-US";
    recognition.onstart = () => {
      recognitionTranscriptRef.current = "";
      recognitionHandledRef.current = false;
      setError(null);
      setListening(true);
    };
    recognition.onresult = (event) => {
      // Browsers may emit several final fragments for one spoken sentence.
      // Save their complete transcript and act once, only after speech ends.
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += `${event.results[index][0].transcript} `;
      }
      recognitionTranscriptRef.current = transcript.trim();
      setQuestion(recognitionTranscriptRef.current);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      const messages: Record<string, string> = {
        "not-allowed": "ALLOW MICROPHONE ACCESS TO TALK",
        "service-not-allowed": "VOICE SERVICE IS BLOCKED BY THE BROWSER",
        "no-speech": "I DID NOT HEAR YOU — TRY AGAIN",
        network: "VOICE SERVICE NEEDS AN INTERNET CONNECTION",
      };
      setError(messages[event.error] ?? "MICROPHONE INPUT FAILED");
    };
    recognition.onend = () => {
      setListening(false);
      const transcript = recognitionTranscriptRef.current;
      if (transcript && !recognitionHandledRef.current) {
        recognitionHandledRef.current = true;
        handleRequest(transcript);
      }
    };
    recognitionRef.current = recognition;
    setError(null);
    try {
      recognition.start();
    } catch {
      setListening(false);
      setError("VOICE INPUT COULD NOT START");
    }
  }, [handleRequest, listening]);

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleRequest(question);
  };

  return (
    <>
      <video className="background-video" autoPlay loop muted playsInline>
        <source src="/black-hole-dark-space-moewalls-com.mp4" type="video/mp4" />
      </video>
      <div className="phone-orb" aria-hidden="true" />

      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      <div className="hud hud-title">
        XENON <span>VOICE INTELLIGENCE</span>
      </div>
      <div className="hud hud-quote">'Race towards singularity'</div>

      <section className="voice-console" aria-live="polite">
        <div className="voice-console__eyebrow">
          <span className={`signal ${listening || speaking ? "active" : ""}`} />
          {thinking ? "THINKING" : listening ? "LISTENING" : speaking ? "SPEAKING" : "READY"}
        </div>
        <p className="voice-console__answer">{answer}</p>
        <form onSubmit={submitQuestion} className="voice-console__form">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask Xenon anything..."
            aria-label="Question for Xenon"
            disabled={thinking}
          />
          <button type="submit" disabled={thinking || !question.trim()}>SEND</button>
          <button type="button" onClick={() => void toggleListening()} aria-pressed={listening} disabled={thinking}>
            {listening ? "STOP" : "TALK"}
          </button>
        </form>
        {voices.length > 0 && (
          <label className="voice-console__voice">
            <span>VOICE</span>
            <select value={selectedVoice} onChange={(event) => setSelectedVoice(event.target.value)} disabled={speaking}>
              <option value="xenon-neural">Xenon Deep Neural — English</option>
              {voices.map((voice) => (
                <option value={voice.voiceURI} key={`${voice.voiceURI}-${voice.name}`}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="voice-console__hint">Press TALK, ask naturally, and Xenon will answer aloud.</div>
      </section>

      <div className="hud hud-controls">
        {error && <div className="hud-error">{error}</div>}
      </div>
    </>
  );
}
