from plugins.plugin_base import VendorPlugin

class JuniperJunosPlugin(VendorPlugin):
    vendor_name = "juniper_junos"
    driver = None
    parser = None
    config_generator = None
