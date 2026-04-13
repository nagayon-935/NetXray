import httpx
import logging
from typing import Any, Dict, List
from api.config import settings

logger = logging.getLogger(__name__)

async def get_llm_diagnosis(ir: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not settings.llm_api_key:
        return []

    # This is a placeholder for LLM integration (Anthropic/OpenAI)
    # In a real implementation, we would format the IR as text and send it with a prompt.
    prompt = f"""
    Analyze the following network topology IR (JSON) for potential configuration errors, 
    best practice violations, or security risks. Return a JSON list of issues with:
    category, severity, message, node_ids.
    
    IR: {ir}
    """
    
    # Mock LLM response for demo
    return [
        {
            "category": "AI Insight",
            "severity": "info",
            "message": "AI analysis suggests reviewing the BGP peering strategy for better redundancy.",
            "node_ids": []
        }
    ]
