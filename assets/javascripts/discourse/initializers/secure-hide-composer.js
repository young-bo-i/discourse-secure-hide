import { withPluginApi } from "discourse/lib/plugin-api";
import SecureHideBuilderModal from "../components/modal/secure-hide-builder";

function initializeSecureHideComposer(api) {
  api.addComposerToolbarPopupMenuOption({
    icon: "lock",
    label: "secure_hide.composer.toolbar_label",
    action: (toolbarEvent) => {
      api.container.lookup("service:modal").show(SecureHideBuilderModal, {
        model: { toolbarEvent },
      });
    },
    condition: () => {
      const siteSettings = api.container.lookup("service:site-settings");
      return siteSettings.secure_hide_enabled && !!api.getCurrentUser();
    },
  });
}

export default {
  name: "secure-hide-composer",
  initialize() {
    withPluginApi(initializeSecureHideComposer);
  },
};
