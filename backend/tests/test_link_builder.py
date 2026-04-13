from translator.link_builder import build_links
from translator.parser_base import InterfaceData


def test_p2p_link_detection():
    node_ifaces = {
        "r1": [InterfaceData(name="eth0", ip="10.0.12.1/30", state="up")],
        "r2": [InterfaceData(name="eth0", ip="10.0.12.2/30", state="up")],
    }
    links = build_links(node_ifaces)
    assert len(links) == 1
    link = links[0]
    endpoints = {(link.source.node, link.source.interface), (link.target.node, link.target.interface)}
    assert ("r1", "eth0") in endpoints
    assert ("r2", "eth0") in endpoints


def test_no_link_for_loopback():
    node_ifaces = {
        "r1": [InterfaceData(name="lo", ip="1.1.1.1/32", state="up")],
        "r2": [InterfaceData(name="lo", ip="2.2.2.2/32", state="up")],
    }
    links = build_links(node_ifaces)
    assert len(links) == 0


def test_slash31_link():
    node_ifaces = {
        "r1": [InterfaceData(name="eth0", ip="10.0.0.0/31", state="up")],
        "r2": [InterfaceData(name="eth0", ip="10.0.0.1/31", state="up")],
    }
    links = build_links(node_ifaces)
    assert len(links) == 1


def test_large_subnet_ignored():
    """A /24 subnet with 2 nodes should not be treated as a P2P link."""
    node_ifaces = {
        "r1": [InterfaceData(name="eth0", ip="192.168.1.1/24", state="up")],
        "r2": [InterfaceData(name="eth0", ip="192.168.1.2/24", state="up")],
    }
    links = build_links(node_ifaces)
    assert len(links) == 0


def test_no_duplicate_links():
    node_ifaces = {
        "r1": [InterfaceData(name="eth0", ip="10.0.12.1/30", state="up")],
        "r2": [InterfaceData(name="eth0", ip="10.0.12.2/30", state="up")],
    }
    links = build_links(node_ifaces)
    assert len(links) == 1  # no duplicates
