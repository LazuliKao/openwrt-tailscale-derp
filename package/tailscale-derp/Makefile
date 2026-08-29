include $(TOPDIR)/rules.mk

PKG_NAME:=tailscale-derp
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_SOURCE_DATE:=2026-08-26
PKG_SOURCE_VERSION:=039b2723783da19146396507ad3f380e789c6b75
PKG_BUILD_DIR:=$(BUILD_DIR)/tailscale-derp-$(PKG_SOURCE_VERSION)
PKG_SOURCE:=$(PKG_NAME)-$(PKG_SOURCE_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/LazuliKao/tailscale-derp/tar.gz/$(PKG_SOURCE_VERSION)?
PKG_HASH:=8af2887db2099536bae39a0d86c5aec6ce1d9ffc94e97e84c9fd9fe9932004cf

PKG_MAINTAINER:=DERP Relay Contributors
PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE

PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16

GO_PKG:=github.com/LazuliKao/tailscale-derp
GO_PKG_LDFLAGS_X:=main.version=$(PKG_VERSION)

# The upstream DERP dependency must stay pinned in src/go.mod.
# Do not switch tailscale.com imports to @latest or any floating branch.

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk
# Override GOTOOLCHAIN: SDK ships Go 1.23.x but tailscale.com requires Go 1.24+
# Shell last-wins semantics: "auto" appended after "local" wins in the recipe
GO_PKG_BUILD_VARS += GOTOOLCHAIN=auto

define Package/tailscale-derp
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Tailscale DERP Relay (Go daemon)
  SUBMENU:=VPN
  URL:=https://github.com/LazuliKao/tailscale-derp
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
