import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from collector.clab import ClabNode, inspect_lab

FIXTURES = Path(__file__).parent / "fixtures"


def test_inspect_lab_parses_nodes():
    mock_result = MagicMock()
    mock_result.stdout = (FIXTURES / "clab_inspect.json").read_text()

    with patch("collector.clab.subprocess.run", return_value=mock_result):
        nodes = inspect_lab()

    assert len(nodes) == 2
    frr_node = next(n for n in nodes if "router1" in n.name)
    assert frr_node.vendor == "frr"
    assert frr_node.mgmt_ip == "172.20.0.2"
    assert frr_node.state == "running"

    arista_node = next(n for n in nodes if "router2" in n.name)
    assert arista_node.vendor == "arista"
    assert arista_node.mgmt_ip == "172.20.0.3"


def test_inspect_lab_strips_prefix_len():
    data = {"containers": [{"name": "r1", "image": "frrouting/frr", "kind": "linux", "state": "running", "ipv4_address": "10.0.0.1/24"}]}
    mock_result = MagicMock()
    mock_result.stdout = json.dumps(data)

    with patch("collector.clab.subprocess.run", return_value=mock_result):
        nodes = inspect_lab()

    assert nodes[0].mgmt_ip == "10.0.0.1"
