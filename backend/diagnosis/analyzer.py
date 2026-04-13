from typing import Any, Dict, List
from .rules import RULE_CHECKS
from .llm_client import get_llm_diagnosis

class DiagnosisEngine:
    async def analyze(self, ir: Dict[str, Any]) -> List[Dict[str, Any]]:
        issues = []
        
        # 1. Run rule-based checks
        for check_func in RULE_CHECKS:
            rule_issues = check_func(ir)
            issues.extend([issue.to_dict() for issue in rule_issues])
            
        # 2. Run LLM check if enabled
        llm_issues = await get_llm_diagnosis(ir)
        issues.extend(llm_issues)
        
        return issues
