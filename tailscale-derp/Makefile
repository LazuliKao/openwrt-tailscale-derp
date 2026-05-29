include $(TOPDIR)/rules.mk

PKG_NAME:=tailscale-derp
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/lk/openwrt-tailscale-derp.git
PKG_SOURCE_VERSION:=HEAD

PKG_MAINTAINER:=DERP Relay Contributors
PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE

PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16

GO_PKG:=github.com/lk/openwrt-tailscale-derp
GO_PKG_LDFLAGS_X:=main.version=$(PKG_VERSION)

# The upstream DERP dependency must stay pinned in src/go.mod.
# Do not switch tailscale.com imports to @latest or any floating branch.

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/tailscale-derp
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Tailscale DERP Relay (Go daemon)
  SUBMENU:=VPN
  URL:=https://github.com/lk/openwrt-tailscale-derp
  DEPENDS:=$(GO_ARCH_DEPENDS) +ca-bundle
endef

define Package/tailscale-derp/conffiles
/etc/config/tailscale-derp
endef

define Package/tailscale-derp/install
	$(call GoPackage/Package/Install/Bin,$(PKG_INSTALL_DIR))

	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/usr/bin/tailscale-derp $(1)/usr/bin/

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/tailscale-derp.config $(1)/etc/config/tailscale-derp

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/tailscale-derp.init $(1)/etc/init.d/tailscale-derp
endef

$(eval $(call GoBinPackage,tailscale-derp))
$(eval $(call BuildPackage,tailscale-derp))
