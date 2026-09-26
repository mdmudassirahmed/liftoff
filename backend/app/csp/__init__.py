"""
CSP Plugin Registry - singleton that routes IaC generation to the correct cloud provider.
"""
from __future__ import annotations
from typing import Dict, Optional
from app.csp.base import AbstractCSPPlugin


class _CSPRegistry:
    """Singleton CSP plugin registry."""

    def __init__(self):
        self._plugins: Dict[str, AbstractCSPPlugin] = {}

    def register(self, plugin: AbstractCSPPlugin) -> None:
        self._plugins[plugin.csp_name] = plugin

    def get(self, csp: str) -> Optional[AbstractCSPPlugin]:
        return self._plugins.get(csp.lower())

    def get_or_raise(self, csp: str) -> AbstractCSPPlugin:
        plugin = self.get(csp)
        if plugin is None:
            available = list(self._plugins.keys())
            raise ValueError(
                f"Unsupported CSP '{csp}'. Available: {available}"
            )
        return plugin

    def available_csps(self) -> list[str]:
        return list(self._plugins.keys())


# Singleton instance
CSPRegistry = _CSPRegistry()


def _bootstrap() -> None:
    """Register built-in CSP plugins at import time."""
    from app.csp.azure.plugin import AzureCSPPlugin
    from app.csp.aws.plugin import AWSCSPPlugin

    CSPRegistry.register(AzureCSPPlugin())
    CSPRegistry.register(AWSCSPPlugin())


_bootstrap()

__all__ = ["CSPRegistry"]
