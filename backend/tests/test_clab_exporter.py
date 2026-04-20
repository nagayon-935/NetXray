import yaml

from translator.iac.clab_exporter import (
    build_clab_yaml,
    export_to_clab,
    validate_ir_for_clone,
)


def _ir(raw_frr: str = "", raw_arista: str = "") -> dict:
    return {
        "ir_version": "0.2.0",
        "metadata": {"name": "t1"},
        "topology": {
            "nodes": [
                {
                    "id": "r1",
                    "type": "router",
                    "vendor": "frr",
                    "hostname": "r1",
                    "interfaces": {},
                    "raw_config": raw_frr,
                },
                {
                    "id": "r2",
                    "type": "router",
                    "vendor": "arista",
                    "hostname": "r2",
                    "interfaces": {},
                    "raw_config": raw_arista,
                },
            ],
            "links": [
                {
                    "id": "l1",
                    "source": {"node": "r1", "interface": "eth1"},
                    "target": {"node": "r2", "interface": "Ethernet1"},
                    "state": "up",
                }
            ],
        },
    }


FRR_CONF = (
    "hostname R1\n"
    "router bgp 65001\n"
    " neighbor 10.0.12.2 remote-as 65002\n"
    "!\n"
    "router ospf\n"
    " network 10.0.0.0/8 area 0\n"
    "!\n"
)

ARISTA_CONF = (
    "hostname R2\n"
    "router bgp 65002\n"
    "   neighbor 10.0.12.1 remote-as 65001\n"
    "!\n"
)


def test_build_clab_yaml_structure():
    text = build_clab_yaml(_ir(FRR_CONF, ARISTA_CONF))
    doc = yaml.safe_load(text)
    assert doc["name"] == "t1"
    assert set(doc["topology"]["nodes"]) == {"r1", "r2"}
    assert doc["topology"]["nodes"]["r1"]["kind"] == "linux"
    assert doc["topology"]["nodes"]["r2"]["kind"] == "ceos"
    assert len(doc["topology"]["links"]) == 1


def test_export_to_clab_writes_configs(tmp_path):
    yaml_path = export_to_clab(_ir(FRR_CONF, ARISTA_CONF), tmp_path)
    assert yaml_path.exists()
    doc = yaml.safe_load(yaml_path.read_text())

    r1 = doc["topology"]["nodes"]["r1"]
    assert "binds" in r1
    assert any("frr.conf:/etc/frr/frr.conf" in b for b in r1["binds"])
    assert any("daemons:/etc/frr/daemons" in b for b in r1["binds"])

    r2 = doc["topology"]["nodes"]["r2"]
    assert "binds" in r2
    assert any("startup-config:/mnt/flash/startup-config" in b for b in r2["binds"])

    frr_conf_path = tmp_path / "configs" / "r1" / "frr.conf"
    assert frr_conf_path.exists()
    assert "router bgp 65001" in frr_conf_path.read_text()

    daemons_path = tmp_path / "configs" / "r1" / "daemons"
    daemons_text = daemons_path.read_text()
    assert "bgpd=yes" in daemons_text
    assert "ospfd=yes" in daemons_text
    assert "zebra=yes" in daemons_text

    arista_conf_path = tmp_path / "configs" / "r2" / "startup-config"
    assert "router bgp 65002" in arista_conf_path.read_text()


def test_frr_daemons_only_enables_configured_protocols(tmp_path):
    ir = _ir("hostname R1\nrouter bgp 65001\n!\n", "")
    export_to_clab(ir, tmp_path)
    daemons_text = (tmp_path / "configs" / "r1" / "daemons").read_text()
    assert "bgpd=yes" in daemons_text
    assert "ospfd=no" in daemons_text


def test_export_skips_binds_when_no_raw_config(tmp_path):
    ir = _ir("", "")
    yaml_path = export_to_clab(ir, tmp_path)
    doc = yaml.safe_load(yaml_path.read_text())
    assert "binds" not in doc["topology"]["nodes"]["r1"]
    assert "binds" not in doc["topology"]["nodes"]["r2"]


def test_validate_ir_for_clone_empty():
    errors = validate_ir_for_clone({"topology": {"nodes": [], "links": []}})
    assert errors and "no nodes" in errors[0]


def test_validate_ir_for_clone_unsupported():
    ir = {"topology": {"nodes": [{"id": "x", "vendor": "cisco_xr"}], "links": []}}
    errors = validate_ir_for_clone(ir)
    assert errors
    assert "cisco_xr" in errors[0]
