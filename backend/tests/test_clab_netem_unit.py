"""Tests for collector/clab_netem.py."""
from unittest.mock import MagicMock, patch

import pytest

from collector.clab_netem import ImpairmentSpec, clear_all, clear_impairment, get_impairment, list_impairments, set_impairment


@pytest.fixture(autouse=True)
def clean_active():
    import collector.clab_netem as netem
    netem._ACTIVE.clear()
    yield
    netem._ACTIVE.clear()


@patch("collector.clab_netem.subprocess.run")
def test_set_impairment_success(mock_run):
    mock_run.return_value = MagicMock(returncode=0, stderr="")
    spec = ImpairmentSpec(node="r1", interface="eth1", delay_ms=10, jitter_ms=2, loss_pct=0.1)
    set_impairment(spec)

    cmd = mock_run.call_args[0][0]
    assert "tools" in cmd
    assert "netem" in cmd
    assert "set" in cmd
    assert "-n" in cmd
    assert "r1" in cmd
    assert "--delay" in cmd
    assert "10ms" in cmd

    assert get_impairment("r1", "eth1") == spec


@patch("collector.clab_netem.subprocess.run")
def test_set_impairment_all_fields(mock_run):
    mock_run.return_value = MagicMock(returncode=0, stderr="")
    spec = ImpairmentSpec(
        node="r1",
        interface="eth1",
        delay_ms=10,
        jitter_ms=2,
        loss_pct=1.5,
        rate_kbit=1000,
        corruption_pct=0.01,
    )
    set_impairment(spec)
    cmd = mock_run.call_args[0][0]
    assert "--rate" in cmd
    assert "--corruption" in cmd


@patch("collector.clab_netem.subprocess.run")
def test_set_impairment_failure(mock_run):
    mock_run.return_value = MagicMock(returncode=1, stderr="netem error")
    spec = ImpairmentSpec(node="r1", interface="eth1", delay_ms=10)
    with pytest.raises(RuntimeError, match="netem error"):
        set_impairment(spec)
    assert get_impairment("r1", "eth1") is None


@patch("collector.clab_netem.subprocess.run")
def test_clear_impairment_success(mock_run):
    mock_run.return_value = MagicMock(returncode=0, stderr="")
    set_impairment(ImpairmentSpec(node="r1", interface="eth1", delay_ms=10))
    clear_impairment("r1", "eth1")
    assert get_impairment("r1", "eth1") is None

    cmd = mock_run.call_args[0][0]
    assert "reset" in cmd
    assert "-n" in cmd
    assert "r1" in cmd


@patch("collector.clab_netem.subprocess.run")
def test_clear_impairment_failure(mock_run):
    mock_run.return_value = MagicMock(returncode=1, stderr="reset error")
    with pytest.raises(RuntimeError, match="reset error"):
        clear_impairment("r1", "eth1")


@patch("collector.clab_netem.subprocess.run")
def test_list_impairments(mock_run):
    mock_run.return_value = MagicMock(returncode=0, stderr="")
    set_impairment(ImpairmentSpec(node="r1", interface="eth1", delay_ms=10))
    set_impairment(ImpairmentSpec(node="r2", interface="eth2", loss_pct=1.0))

    impairments = list_impairments()
    assert len(impairments) == 2
    assert any(i["node"] == "r1" for i in impairments)


@patch("collector.clab_netem.subprocess.run")
def test_clear_all(mock_run):
    mock_run.return_value = MagicMock(returncode=0, stderr="")
    set_impairment(ImpairmentSpec(node="r1", interface="eth1", delay_ms=10))
    set_impairment(ImpairmentSpec(node="r2", interface="eth2", loss_pct=1.0))

    clear_all()
    assert list_impairments() == []


@patch("collector.clab_netem.subprocess.run")
def test_clear_all_ignores_errors(mock_run):
    # First call (set) succeeds; subsequent calls (clear) fail
    mock_run.return_value = MagicMock(returncode=0, stderr="")
    set_impairment(ImpairmentSpec(node="r1", interface="eth1", delay_ms=10))

    mock_run.return_value = MagicMock(returncode=1, stderr="fail")
    # Should not raise; clear_all swallows per-entry errors
    clear_all()
