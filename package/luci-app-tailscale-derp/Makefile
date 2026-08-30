include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-tailscale-derp
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

LUCI_TITLE:=LuCI Support for Tailscale DERP Relay
LUCI_DEPENDS:=+luci-base +tailscale-derp +curl
LUCI_PKGARCH:=all

PKG_LICENSE:=MIT
PKG_MAINTAINER:=DERP Relay Contributors

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
