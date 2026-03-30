import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

api_key = os.getenv("OPENAI_API_KEY")

if not api_key:
    raise ValueError("OPENAI_API_KEY not found in .env file")

client = OpenAI(api_key=api_key)


def generate_explanation(text: str, label: str, confidence: float) -> str:
    predicted_as = "AI-generated" if label == "ai" else "human-written"

    prompt = f"""
You are assisting an academic AI-detection system.

A classifier analyzed the following text.

Text:
{text}

Prediction: {predicted_as}
Confidence: {confidence:.2f}

Write a short explanation for a teacher.
Focus on:
- tone
- sentence structure
- uniformity
- wording patterns

Rules:
- Keep it under 80 words
- Do not claim certainty
- Use cautious language
"""

    response = client.responses.create(
        model="gpt-4.1-mini",
        input=prompt
    )

    return response.output_text.strip()