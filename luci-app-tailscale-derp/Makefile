include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Support for Tailscale DERP Relay
LUCI_DEPENDS:=+luci-base +go-tailscale-derp
LUCI_PKGARCH:=all

PKG_LICENSE:=MIT
PKG_MAINTAINER:=DERP Relay Contributors

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
