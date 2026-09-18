"""One-time Kosher AI logo generator: a Kashmiri man in a pheran holding a kangri."""
import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
import os  # noqa: E402

from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration  # noqa: E402

PROMPT = (
    "Flat vector app logo illustration: a friendly smiling Kashmiri man wearing a traditional "
    "Kashmiri pheran, a long loose terracotta-brown woollen robe, holding a kangri — a Kashmiri "
    "handheld woven earthen fire pot with glowing embers — in one hand. He also waves with his "
    "other hand. Circular warm cream background (#FDFBF7). Terracotta and saffron color palette "
    "(#C85A32, #A64420, #EBE3D5). Minimal editorial illustration style, clean bold shapes, soft "
    "shading, centered composition. Below the figure the text 'Kosher AI' in an elegant serif "
    "font, dark brown (#2C2623). Square 1:1."
)


async def main() -> None:
    key = os.environ["EMERGENT_LLM_KEY"]
    gen = OpenAIImageGeneration(api_key=key)
    images = await gen.generate_images(PROMPT, model="gpt-image-1", number_of_images=1, quality="high")
    if not images:
        raise RuntimeError("no image returned")
    out = Path("/app/frontend/assets/images/logo.png")
    out.write_bytes(images[0])
    print(f"logo written: {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))