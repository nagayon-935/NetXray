"""Tests for the unified dynamic vendor-plugin registry.

Adding a vendor package under ``plugins/`` (with a ``plugin.py`` exposing a
``plugin: VendorPlugin``) must be enough for collector / translator / iac
dispatch — no registry edits in the consumers.
"""
import dataclasses
import logging

import pytest

import plugins
from plugins.plugin_base import VendorPlugin


def test_discovers_builtin_vendor_plugins():
    discovered = plugins.discover_plugins()

    assert {"frr", "arista", "generic"} <= set(discovered)


def test_discovered_plugins_are_vendor_plugin_instances():
    discovered = plugins.discover_plugins()

    assert discovered
    for plugin in discovered.values():
        assert isinstance(plugin, VendorPlugin)


def test_get_plugin_returns_none_for_unknown_vendor():
    assert plugins.get_plugin("no-such-vendor") is None


def test_frr_plugin_wires_driver_parser_and_generator():
    from plugins.frr.config_generator import FrrConfigGenerator
    from plugins.frr.driver import FrrDriver
    from plugins.frr.parser import FrrParser

    plugin = plugins.get_plugin("frr")

    assert plugin is not None
    assert plugin.driver_class is FrrDriver
    assert plugin.parser_class is FrrParser
    assert plugin.config_generator_class is FrrConfigGenerator


def test_generic_plugin_falls_back_to_base_config_generator():
    from plugins.base_config_generator import BaseConfigGenerator

    plugin = plugins.get_plugin("generic")

    assert plugin is not None
    assert plugin.config_generator_class is BaseConfigGenerator


def test_vendor_plugin_is_immutable():
    plugin = plugins.get_plugin("frr")

    with pytest.raises(dataclasses.FrozenInstanceError):
        plugin.vendor_name = "mutated"


def test_driver_registry_is_derived_from_discovery():
    from collector.drivers import DRIVER_REGISTRY

    discovered = plugins.discover_plugins()

    assert set(DRIVER_REGISTRY) == set(discovered)
    for vendor, driver_cls in DRIVER_REGISTRY.items():
        assert driver_cls is discovered[vendor].driver_class


def test_parser_registry_is_derived_from_discovery():
    from translator.parsers import PARSER_REGISTRY

    discovered = plugins.discover_plugins()

    assert set(PARSER_REGISTRY) == set(discovered)
    for vendor, parser_cls in PARSER_REGISTRY.items():
        assert parser_cls is discovered[vendor].parser_class


def test_discover_plugins_returns_defensive_copy():
    first = plugins.discover_plugins()
    first["injected"] = object()

    assert "injected" not in plugins.discover_plugins()


def test_broken_plugin_package_is_skipped_with_warning(monkeypatch, caplog):
    import pkgutil

    real_iter_modules = pkgutil.iter_modules

    def fake_iter_modules(paths):
        yield from real_iter_modules(paths)
        yield (None, "brokenvendor", True)

    monkeypatch.setattr(plugins.pkgutil, "iter_modules", fake_iter_modules)

    with caplog.at_level(logging.WARNING, logger="plugins"):
        discovered = plugins.discover_plugins(refresh=True)

    assert "frr" in discovered
    assert "brokenvendor" not in discovered
    assert any("brokenvendor" in rec.message for rec in caplog.records)

    # Repopulate the cache without the fake module for later tests.
    monkeypatch.undo()
    plugins.discover_plugins(refresh=True)
