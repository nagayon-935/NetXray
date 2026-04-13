from typing import Protocol


class VendorDriver(Protocol):
    @classmethod
    def vendor_name(cls) -> str: ...

    def collect(self, host: str, credentials: dict[str, str]) -> dict[str, str]:
        """Run commands against host, return {command_name -> raw_output}."""
        ...
