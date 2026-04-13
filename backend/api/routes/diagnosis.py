from fastapi import APIRouter
from typing import Any, Dict
from diagnosis.analyzer import DiagnosisEngine

router = APIRouter(prefix="/diagnose", tags=["diagnosis"])
engine = DiagnosisEngine()

@router.post("")
async def diagnose_ir(ir: Dict[str, Any]):
    """
    Analyze the IR for potential issues using rule-based and LLM-based checks.
    """
    issues = await engine.analyze(ir)
    return {"issues": issues}
