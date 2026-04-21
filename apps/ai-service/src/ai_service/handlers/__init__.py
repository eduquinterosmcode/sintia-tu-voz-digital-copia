from ai_service.handlers.registry import HandlerRegistry, registry, register_handler

# Import all handler modules here to trigger @register_handler decorators at startup.
# Add a new line here each time a new agent handler is implemented.
import ai_service.agents.auditor.handler   # noqa: F401  audit_analysis
import ai_service.agents.meeting.handler   # noqa: F401  analyze_meeting
import ai_service.handlers.transcribe      # noqa: F401  transcribe_audio

__all__ = ["HandlerRegistry", "registry", "register_handler"]
