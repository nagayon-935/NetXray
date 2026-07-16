from plugins.base_config_generator import BaseConfigGenerator
from plugins.plugin_base import VendorPlugin

from .driver import GenericDriver
from .parser import GenericParser

plugin = VendorPlugin(
    vendor_name="generic",
    driver_class=GenericDriver,
    parser_class=GenericParser,
    config_generator_class=BaseConfigGenerator,
)
