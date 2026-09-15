import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ACTIONS = {
  open_youtube: { label: "Opening YouTube in Chrome.", target: "youtube" },
  search_youtube: { label: "Searching YouTube.", target: "youtube_search" },
  open_chrome: { label: "Opening Chrome.", target: "chrome" },
  open_google: { label: "Opening Google in Chrome.", target: "google" },
  open_notepad: { label: "Opening Notepad.", target: "notepad" },
} as const;

type ActionName = keyof typeof ACTIONS;
let lastAction: { key: string; at: number } | null = null;

function chromePath() {
  const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
    .filter((root): root is string => Boolean(root));
  return roots
    .map((root) => path.join(root, "Google", "Chrome", "Application", "chrome.exe"))
    .find(existsSync);
}

export async function POST(request: Request) {
  let action: unknown;
  let query: unknown;
  try { ({ action, query } = await request.json()); } catch {
    return NextResponse.json({ error: "Invalid device command." }, { status: 400 });
  }
  if (typeof action !== "string" || !(action in ACTIONS)) {
    return NextResponse.json({ error: "That device command is not allowed." }, { status: 400 });
  }
  const command = ACTIONS[action as ActionName];
  const actionName = action as ActionName;
  const cleanQuery = typeof query === "string" ? query.trim().slice(0, 160) : "";
  if (actionName === "search_youtube" && !cleanQuery) {
    return NextResponse.json({ error: "Tell me what to search on YouTube." }, { status: 400 });
  }
  const actionKey = `${actionName}:${cleanQuery.toLowerCase()}`;
  if (lastAction?.key === actionKey && Date.now() - lastAction.at < 8_000) {
    return NextResponse.json({ answer: "That command is already running." });
  }
  try {
    const chrome = chromePath();
    if (!chrome && command.target !== "notepad") throw new Error("Chrome not found");
    const args = command.target === "youtube" ? ["--new-window", "https://www.youtube.com/"]
      : command.target === "youtube_search" ? ["--new-window", `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`]
      : command.target === "google" ? ["--new-window", "https://www.google.com/"]
        : command.target === "chrome" ? ["--new-window"] : [];
    const child = spawn(command.target === "notepad" ? "notepad.exe" : chrome!, args, {
      detached: true, windowsHide: true, stdio: "ignore",
    });
    child.unref();
    lastAction = { key: actionKey, at: Date.now() };
    return NextResponse.json({ answer: actionName === "search_youtube" ? `Searching YouTube for ${cleanQuery}.` : command.label });
  } catch {
    return NextResponse.json({ error: "I could not open that app." }, { status: 500 });
  }
}
