from plugins.plugin_base import VendorPlugin

from .config_generator import FrrConfigGenerator
from .driver import FrrDriver
from .parser import FrrParser

plugin = VendorPlugin(
    vendor_name="frr",
    driver_class=FrrDriver,
    parser_class=FrrParser,
    config_generator_class=FrrConfigGenerator,
)
