"""
Shared runtime context passed to all agents and tools during a meeting analysis run.

The context holds the transcript segments so tools can search them without
receiving the full transcript in every prompt — same pattern as AuditorContext.
"""
from dataclasses import dataclass, field


@dataclass
class MeetingContext:
    segments: list[dict] = field(default_factory=list)
    meeting_title: str = ""
    sector_name: str = ""
