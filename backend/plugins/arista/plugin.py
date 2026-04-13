from .driver import AristaDriver
from .parser import AristaParser
from .config_generator import AristaConfigGenerator
from plugins.plugin_base import VendorPlugin

plugin = VendorPlugin()
plugin.vendor_name = "arista"
plugin.driver_class = AristaDriver
plugin.parser_class = AristaParser
plugin.config_generator_class = AristaConfigGenerator
