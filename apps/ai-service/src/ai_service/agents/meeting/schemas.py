"""
Pydantic schemas for the meeting analysis agents.

SpecialistOutput  — what each specialist agent produces.
CoordinatorOutput — the final consolidated analysis (written to meeting_analyses).
SectorConfig      — loaded from agent_profiles rows; drives which agents are built.
"""
from dataclasses import dataclass, field as dc_field

from pydantic import BaseModel, Field


# ── Shared evidence type ──────────────────────────────────────────────────────

class Evidence(BaseModel):
    quote: str = Field(description="Exact or near-exact quote from the transcript.")
    speaker: str = Field(description="Speaker label or name.")
    t_start_sec: float = Field(default=0.0)
    t_end_sec: float = Field(default=0.0)


# ── Specialist output ─────────────────────────────────────────────────────────

class Finding(BaseModel):
    title: str
    detail: str
    evidence: list[Evidence] = Field(default_factory=list)


class Risk(BaseModel):
    risk: str
    severity: str = Field(description="high | medium | low")
    evidence: list[Evidence] = Field(default_factory=list)


class SpecialistOutput(BaseModel):
    specialist_name: str
    findings: list[Finding] = Field(default_factory=list)
    risks: list[Risk] = Field(default_factory=list)
    missing_info_questions: list[str] = Field(default_factory=list)


# ── Coordinator output ────────────────────────────────────────────────────────

class KeyPoint(BaseModel):
    point: str
    evidence: list[Evidence] = Field(default_factory=list)


class Decision(BaseModel):
    decision: str
    owner: str | None = None
    evidence: list[Evidence] = Field(default_factory=list)


class ActionItem(BaseModel):
    task: str
    owner: str | None = None
    due_date: str | None = None
    priority: str = Field(description="high | medium | low")
    evidence: list[Evidence] = Field(default_factory=list)


class RiskAlert(BaseModel):
    risk: str
    severity: str = Field(description="high | medium | low")
    mitigation: str
    evidence: list[Evidence] = Field(default_factory=list)


class SuggestedResponse(BaseModel):
    context: str
    message: str
    evidence: list[Evidence] = Field(default_factory=list)


class CoordinatorOutput(BaseModel):
    meeting_title: str
    sector: str
    summary: str = Field(description="2-4 sentence executive summary in Spanish (Chile).")
    key_points: list[KeyPoint] = Field(default_factory=list)
    decisions: list[Decision] = Field(default_factory=list)
    action_items: list[ActionItem] = Field(default_factory=list)
    risks_alerts: list[RiskAlert] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    suggested_responses: list[SuggestedResponse] = Field(default_factory=list)
    confidence_notes: list[str] = Field(default_factory=list)


# ── Sector configuration (loaded from DB) ────────────────────────────────────

@dataclass
class SpecialistConfig:
    name: str
    instructions: str


@dataclass
class SectorConfig:
    sector_key: str
    sector_name: str
    coordinator_instructions: str
    specialists: list[SpecialistConfig] = dc_field(default_factory=list)
