"""
Handler registry — maps job_type strings to async handler functions.

Usage:
    from ai_service.handlers.registry import register_handler

    @register_handler("analyze_meeting")
    async def handle_analyze(job: JobRow) -> None:
        ...

The worker calls registry.dispatch(job) which looks up the handler and awaits it.
An unknown job_type raises KeyError, which the worker catches and marks as failed.
"""
import logging
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ai_service.jobs.models import JobRow

logger = logging.getLogger(__name__)

HandlerFn = Callable[["JobRow"], Awaitable[None]]


class HandlerRegistry:
    def __init__(self) -> None:
        self._handlers: dict[str, HandlerFn] = {}

    def register(self, job_type: str) -> Callable[[HandlerFn], HandlerFn]:
        """Decorator: @registry.register('my_job_type')"""
        def decorator(fn: HandlerFn) -> HandlerFn:
            if job_type in self._handlers:
                logger.warning("Overwriting handler for job_type='%s'", job_type)
            self._handlers[job_type] = fn
            logger.debug("Registered handler for job_type='%s'", job_type)
            return fn
        return decorator

    async def dispatch(self, job: "JobRow") -> None:
        handler = self._handlers.get(job.job_type)
        if handler is None:
            registered = list(self._handlers.keys())
            raise KeyError(
                f"No handler registered for job_type='{job.job_type}'. "
                f"Registered types: {registered}"
            )
        await handler(job)

    @property
    def registered_types(self) -> list[str]:
        return list(self._handlers.keys())


# Module-level singleton — import this in handler modules
registry = HandlerRegistry()

# Convenience shortcut
register_handler = registry.register
