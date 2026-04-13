from .driver import FrrDriver
from .parser import FrrParser
from .config_generator import FrrConfigGenerator
from plugins.plugin_base import VendorPlugin

plugin = VendorPlugin()
plugin.vendor_name = "frr"
plugin.driver_class = FrrDriver
plugin.parser_class = FrrParser
plugin.config_generator_class = FrrConfigGenerator
