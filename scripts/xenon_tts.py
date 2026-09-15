"""Stream an original deep English Xenon voice as MP3 to stdout."""

import asyncio
import sys

import edge_tts


async def main() -> None:
    text = sys.argv[1].strip()
    if not text:
        return

    # This is a general neural English voice styled for Xenon, not a clone.
    voice = "en-US-GuyNeural"
    communicate = edge_tts.Communicate(text, voice, rate="-8%", pitch="-12Hz")
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])
            sys.stdout.buffer.flush()


asyncio.run(main())
