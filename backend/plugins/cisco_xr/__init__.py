from plugins.plugin_base import VendorPlugin

class CiscoXrPlugin(VendorPlugin):
    vendor_name = "cisco_xr"
    driver = None
    parser = None
    config_generator = None
