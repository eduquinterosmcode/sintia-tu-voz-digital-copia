from ai_service.handlers.registry import HandlerRegistry, registry, register_handler

# Import all handler modules here to trigger @register_handler decorators at startup.
# Add a new line here each time a new agent handler is implemented.
import ai_service.agents.auditor.handler  # noqa: F401  audit_analysis

__all__ = ["HandlerRegistry", "registry", "register_handler"]
