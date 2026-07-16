from plugins.plugin_base import VendorPlugin

from .config_generator import AristaConfigGenerator
from .driver import AristaDriver
from .parser import AristaParser

plugin = VendorPlugin(
    vendor_name="arista",
    driver_class=AristaDriver,
    parser_class=AristaParser,
    config_generator_class=AristaConfigGenerator,
)
