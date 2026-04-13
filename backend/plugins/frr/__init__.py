from plugins.plugin_base import VendorPlugin
from .driver import FrrDriver
from .parser import FrrParser
from .config_generator import FrrConfigGenerator

class FrrPlugin(VendorPlugin):
    vendor_name = "frr"
    driver = FrrDriver()
    parser = FrrParser()
    config_generator = FrrConfigGenerator()
