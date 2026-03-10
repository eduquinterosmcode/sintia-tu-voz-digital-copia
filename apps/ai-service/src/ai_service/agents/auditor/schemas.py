"""
Pydantic schemas for the AnalysisAuditor agent.
These are the contracts between the agent's structured output and the DB.
"""
from enum import StrEnum

from pydantic import BaseModel, Field


class Severity(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Contradiction(BaseModel):
    claim_a: str = Field(description="First conflicting claim, verbatim or close paraphrase from the analysis.")
    claim_b: str = Field(description="Second claim that contradicts claim_a.")
    severity: Severity
    sources: list[str] = Field(
        description="Which analysis sections these claims come from, e.g. ['decisions', 'risks']."
    )
    explanation: str = Field(description="Brief explanation of why these two claims contradict each other.")


class UnsupportedClaim(BaseModel):
    claim: str = Field(description="The claim from the analysis that lacks transcript evidence.")
    section: str = Field(description="Analysis section where this claim appears, e.g. 'action_items'.")
    severity: Severity
    reason: str = Field(description="Why the claim cannot be verified in the transcript.")


class AuditReport(BaseModel):
    confidence_score: int = Field(
        ge=0,
        le=100,
        description=(
            "Overall confidence score for the analysis (0–100). "
            "100 = fully grounded, no contradictions. "
            "Deduct ~15 pts per high-severity issue, ~8 per medium, ~3 per low."
        ),
    )
    contradictions: list[Contradiction] = Field(default_factory=list)
    unsupported_claims: list[UnsupportedClaim] = Field(default_factory=list)
    summary: str = Field(
        description=(
            "2–4 sentence summary of the audit in Spanish (Chile). "
            "Highlight the most critical issues and the overall reliability of the analysis."
        )
    )
