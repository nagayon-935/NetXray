from plugins.plugin_base import VendorPlugin
from .driver import AristaDriver
from .parser import AristaParser
from .config_generator import AristaConfigGenerator

class AristaPlugin(VendorPlugin):
    vendor_name = "arista"
    driver = AristaDriver()
    parser = AristaParser()
    config_generator = AristaConfigGenerator()
