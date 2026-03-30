from transformers import pipeline
import os

# -----------------------------
# Setup
# -----------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "models", "distilbert_hc3_final")

print("USING MODEL LOADER:", os.path.abspath(__file__))

classifier = pipeline(
    "text-classification",
    model=MODEL_PATH,
    tokenizer=MODEL_PATH
)

# -----------------------------
# Predict function (LONG TEXT SAFE)
# -----------------------------
def predict_text(text, chunk_word_size=350):
    if not text or not text.strip():
        raise ValueError("Empty text provided.")

    text = text.strip()
    words = text.split()

    chunks = [
        " ".join(words[i:i + chunk_word_size])
        for i in range(0, len(words), chunk_word_size)
    ]

    chunk_results = []

    for idx, chunk in enumerate(chunks, start=1):
        result = classifier(
            chunk,
            truncation=True,
            max_length=512
        )[0]

        raw_label = result["label"].lower()
        raw_score = float(result["score"])
        ai_score = raw_score if raw_label == "ai" else 1 - raw_score

        chunk_results.append({
            "chunk_id": idx,
            "label": raw_label,
            "raw_score": raw_score,
            "ai_score": ai_score,
            "preview": chunk[:300]
        })

    overall_ai_score = sum(c["ai_score"] for c in chunk_results) / len(chunk_results)
    high_risk_chunks = [c for c in chunk_results if c["ai_score"] >= 0.75]

    if overall_ai_score >= 0.5:
        final_label = "ai"
    elif len(high_risk_chunks) >= 2:
        final_label = "mixed"
    else:
        final_label = "human"

    suspicious_sections = [
        {
            "chunk_id": c["chunk_id"],
            "score": round(c["ai_score"] * 100, 2),
            "preview": c["preview"]
        }
        for c in chunk_results
        if c["ai_score"] >= 0.6
    ]

    return {
        "label": final_label,
        "ai_score": overall_ai_score,
        "chunk_results": chunk_results,
        "suspicious_sections": suspicious_sections,
        "total_words_assessed": len(words),
        "total_chunks_assessed": len(chunks),
        "chunk_word_size": chunk_word_size
    }