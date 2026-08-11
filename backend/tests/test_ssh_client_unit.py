"""Tests for collector/ssh_client.py."""
from unittest.mock import MagicMock, patch

import pytest

from collector.ssh_client import execute_commands


def test_execute_commands_success():
    mock_conn = MagicMock()
    mock_conn.send_command.side_effect = ["out1", "out2"]

    with patch("collector.ssh_client.ConnectHandler") as mock_handler:
        mock_handler.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_handler.return_value.__exit__ = MagicMock(return_value=False)

        results = execute_commands("host", 22, "user", "pass", "linux", ["cmd1", "cmd2"])

    assert results == {"cmd1": "out1", "cmd2": "out2"}


def test_execute_commands_retries_then_succeeds():
    from netmiko import NetMikoTimeoutException

    mock_conn = MagicMock()
    mock_conn.send_command.return_value = "out1"

    with patch("collector.ssh_client.ConnectHandler") as mock_handler:
        # First two attempts fail, third succeeds
        mock_handler.side_effect = [
            NetMikoTimeoutException("timeout"),
            NetMikoTimeoutException("timeout"),
            MagicMock(__enter__=MagicMock(return_value=mock_conn), __exit__=MagicMock(return_value=False)),
        ]

        with patch("collector.ssh_client.time.sleep"):
            results = execute_commands("host", 22, "user", "pass", "linux", ["cmd1"])

    assert results == {"cmd1": "out1"}
    assert mock_handler.call_count == 3


def test_execute_commands_fails_after_retries():
    from netmiko import NetMikoAuthenticationException

    with patch("collector.ssh_client.ConnectHandler") as mock_handler:
        mock_handler.side_effect = NetMikoAuthenticationException("auth failed")

        with patch("collector.ssh_client.time.sleep"):
            with pytest.raises(RuntimeError, match="failed after"):
                execute_commands("host", 22, "user", "pass", "linux", ["cmd1"])

    assert mock_handler.call_count == 3


def test_execute_commands_other_exception_retries():
    with patch("collector.ssh_client.ConnectHandler") as mock_handler:
        mock_handler.side_effect = RuntimeError("unexpected")

        with patch("collector.ssh_client.time.sleep"):
            with pytest.raises(RuntimeError, match="failed after"):
                execute_commands("host", 22, "user", "pass", "linux", ["cmd1"])

    assert mock_handler.call_count == 3
