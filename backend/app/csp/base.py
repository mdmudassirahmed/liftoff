"""Abstract base class for CSP plugins."""
from abc import ABC, abstractmethod
from typing import Any, Dict


class AbstractCSPPlugin(ABC):
    """
    Abstract base for cloud-provider plugins.
    Each CSP (azure, aws) provides exactly one concrete implementation.
    """

    @property
    @abstractmethod
    def csp_name(self) -> str:
        """Identifier for this CSP: 'azure' | 'aws'."""
        ...

    @property
    @abstractmethod
    def default_iac_format(self) -> str:
        """Default IaC format for this CSP: 'bicep' | 'cloudformation'."""
        ...

    @abstractmethod
    async def generate_iac(
        self,
        architecture: Dict[str, Any],
        fmt: str,
        modular: bool = False,
    ) -> Dict[str, Any]:
        """
        Generate IaC from diagram architecture JSON.
        Returns dict with keys: template (str), format (str), agent_name (str).
        For modular=True: returns dict with keys: files (list), format, agent_name, structure_summary.
        Raises on unrecoverable errors; callers must handle.
        """
        ...

    @abstractmethod
    def get_supported_formats(self) -> list[str]:
        """Return list of supported IaC format strings."""
        ...

    def supports_format(self, fmt: str) -> bool:
        return fmt.lower() in (f.lower() for f in self.get_supported_formats())
