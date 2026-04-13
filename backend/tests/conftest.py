import json
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(filename: str) -> str:
    return (FIXTURES_DIR / filename).read_text()


def load_fixture_json(filename: str) -> dict:
    return json.loads(load_fixture(filename))


@pytest.fixture
def frr_outputs() -> dict[str, str]:
    return {
        "show interface json": load_fixture("frr_show_interface.json"),
        "show ip route json": load_fixture("frr_show_ip_route.json"),
        "show running-config": load_fixture("frr_running_config.txt"),
    }


@pytest.fixture
def arista_outputs() -> dict[str, str]:
    return {
        "show interfaces": load_fixture("arista_show_interfaces.json"),
        "show ip route": load_fixture("arista_show_ip_route.json"),
        "show ip access-lists": load_fixture("arista_show_ip_access_lists.json"),
    }
