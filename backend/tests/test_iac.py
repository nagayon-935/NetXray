"""Tests for IaC parsers and exporters (Phase 10/11)."""
import pytest
import yaml
from httpx import AsyncClient, ASGITransport
from api.main import app

hcl2 = pytest.importorskip("hcl2")


# ─── Terraform parser ────────────────────────────────────────────────────────

TERRAFORM_HCL = """
resource "clab_node" "r1" {
  kind = "frr"
}
resource "clab_node" "r2" {
  kind = "ceos"
}
resource "clab_link" "l1" {
  endpoints = ["r1:eth0", "r2:eth1"]
}
"""

TERRAFORM_HCL_EMPTY = ""


class TestTerraformParser:
    @pytest.fixture
    def ir(self):
        from translator.iac.terraform_parser import parse_terraform_to_ir
        return parse_terraform_to_ir(TERRAFORM_HCL)

    def test_node_count(self, ir):
        assert len(ir["topology"]["nodes"]) == 2

    def test_vendor_mapping(self, ir):
        nodes = {n["id"]: n for n in ir["topology"]["nodes"]}
        assert nodes["r1"]["vendor"] == "frr"
        assert nodes["r2"]["vendor"] == "arista"

    def test_links_parsed(self, ir):
        links = ir["topology"]["links"]
        assert len(links) == 1
        link = links[0]
        assert link["source"]["node"] == "r1"
        assert link["source"]["interface"] == "eth0"
        assert link["target"]["node"] == "r2"
        assert link["target"]["interface"] == "eth1"

    def test_valid_ir_structure(self, ir):
        assert "ir_version" in ir
        assert "topology" in ir
        assert "topology_name" not in ir

    def test_empty_hcl_returns_empty_nodes_and_links(self):
        from translator.iac.terraform_parser import parse_terraform_to_ir
        ir = parse_terraform_to_ir(TERRAFORM_HCL_EMPTY)
        assert ir["topology"]["nodes"] == []
        assert ir["topology"]["links"] == []


# ─── Ansible parser ──────────────────────────────────────────────────────────

ANSIBLE_INVENTORY = """
all:
  hosts:
    r1:
      ansible_network_os: eos
      ansible_host: 192.168.1.1
    r2:
      ansible_network_os: frr
      ansible_host: 192.168.1.2
"""

ANSIBLE_INVENTORY_CHILDREN = """
all:
  children:
    routers:
      hosts:
        r3:
          ansible_network_os: eos
        r4:
          ansible_network_os: frr
"""


class TestAnsibleParser:
    def test_parses_hosts(self):
        from translator.iac.ansible_parser import parse_ansible_inventory
        ir = parse_ansible_inventory(ANSIBLE_INVENTORY)
        assert len(ir["topology"]["nodes"]) == 2

    def test_vendor_mapping(self):
        from translator.iac.ansible_parser import parse_ansible_inventory
        ir = parse_ansible_inventory(ANSIBLE_INVENTORY)
        nodes = {n["id"]: n for n in ir["topology"]["nodes"]}
        assert nodes["r1"]["vendor"] == "arista"
        assert nodes["r2"]["vendor"] == "frr"

    def test_nested_children_traversed(self):
        from translator.iac.ansible_parser import parse_ansible_inventory
        ir = parse_ansible_inventory(ANSIBLE_INVENTORY_CHILDREN)
        assert len(ir["topology"]["nodes"]) == 2
        node_ids = {n["id"] for n in ir["topology"]["nodes"]}
        assert "r3" in node_ids
        assert "r4" in node_ids

    def test_valid_ir_structure(self):
        from translator.iac.ansible_parser import parse_ansible_inventory
        ir = parse_ansible_inventory(ANSIBLE_INVENTORY)
        assert "ir_version" in ir
        assert "topology" in ir
        assert "topology_name" not in ir


# ─── Clab exporter ───────────────────────────────────────────────────────────

SAMPLE_IR = {
    "ir_version": "0.3.0",
    "metadata": {"name": "my-lab"},
    "topology": {
        "nodes": [
            {"id": "r1", "vendor": "arista"},
            {"id": "r2", "vendor": "frr"},
            {"id": "h1", "vendor": "generic"},
        ],
        "links": [
            {
                "id": "l1",
                "source": {"node": "r1", "interface": "eth0"},
                "target": {"node": "r2", "interface": "eth1"},
                "state": "up",
            }
        ],
    },
}


class TestClabExporter:
    @pytest.fixture
    def clab_data(self):
        from translator.iac.clab_exporter import export_to_clab
        return yaml.safe_load(export_to_clab(SAMPLE_IR))

    def test_node_kinds(self, clab_data):
        nodes = clab_data["topology"]["nodes"]
        assert nodes["r1"]["kind"] == "ceos"
        assert nodes["r2"]["kind"] == "frr"
        assert nodes["h1"]["kind"] == "linux"

    def test_link_endpoints(self, clab_data):
        links = clab_data["topology"]["links"]
        assert len(links) == 1
        endpoints = links[0]["endpoints"]
        assert "r1:eth0" in endpoints
        assert "r2:eth1" in endpoints

    def test_returns_valid_yaml_string(self):
        from translator.iac.clab_exporter import export_to_clab
        result = export_to_clab(SAMPLE_IR)
        assert isinstance(result, str)
        parsed = yaml.safe_load(result)
        assert isinstance(parsed, dict)

    def test_fallback_name_when_metadata_missing(self):
        from translator.iac.clab_exporter import export_to_clab
        ir_no_meta = {
            "ir_version": "0.3.0",
            "topology": {"nodes": [], "links": []},
        }
        result = yaml.safe_load(export_to_clab(ir_no_meta))
        assert result["name"] == "netxray-exported"

    def test_uses_metadata_name(self, clab_data):
        assert clab_data["name"] == "my-lab"


# ─── IaC API endpoints ───────────────────────────────────────────────────────

@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestIacApiEndpoints:
    async def test_import_terraform_returns_ir_with_nodes(self, client):
        resp = await client.post(
            "/api/iac/import",
            json={"type": "terraform", "content": TERRAFORM_HCL},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "ir" in data
        assert len(data["ir"]["topology"]["nodes"]) == 2

    async def test_import_ansible_returns_ir_with_nodes(self, client):
        resp = await client.post(
            "/api/iac/import",
            json={"type": "ansible", "content": ANSIBLE_INVENTORY},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "ir" in data
        assert len(data["ir"]["topology"]["nodes"]) == 2

    async def test_export_clab_returns_yaml(self, client):
        resp = await client.post(
            "/api/iac/export/clab",
            json={"ir": SAMPLE_IR},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "clab_yaml" in data
        parsed = yaml.safe_load(data["clab_yaml"])
        assert "topology" in parsed
