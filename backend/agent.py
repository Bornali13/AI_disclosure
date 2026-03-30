from backend.openai_helper import generate_explanation

def decision_agent(label, ai_score):
    """
    ai_score = AI likelihood (0 to 1)
    """

    if ai_score >= 0.75:
        return "High risk – strong AI likelihood"
    elif ai_score >= 0.40:
        return "Moderate risk – review recommended"
    elif ai_score >= 0.15:
        return "Low risk – mostly human, minor AI signals"
    else:
        return "Very low risk – likely human"


def explain_result(text: str, label: str, score: float) -> str:
    try:
        return generate_explanation(text, label, score)
    except Exception as e:
        print("OpenAI explanation error:", e)

        if label == "ai":
            return "The text appears highly uniform and polished, which may indicate AI-generated writing."
        return "The text shows more natural variation and personal phrasing, which may indicate human writing."
    
def recommendation_agent(label, score):
    if label == "ai" and score > 0.75:
        return "Flag for manual review"
    elif label == "ai":
        return "Check against draft"
    else:
        return "No action required"