import { withPluginApi } from "discourse/lib/plugin-api";
import SecureHideBuilderModal from "../components/modal/secure-hide-builder";
import richEditorExtension from "../lib/rich-editor-extension";

function initializeSecureHideComposer(api) {
  const siteSettings = api.container.lookup("service:site-settings");
  if (!siteSettings.secure_hide_enabled) {
    return;
  }

  api.registerRichEditorExtension(richEditorExtension);

  api.addComposerToolbarPopupMenuOption({
    icon: "lock",
    label: "secure_hide.composer.toolbar_label",
    action: (toolbarEvent) => {
      api.container.lookup("service:modal").show(SecureHideBuilderModal, {
        model: { toolbarEvent },
      });
    },
    active: ({ state }) => state?.inSecureHide,
    showActiveIcon: true,
    condition: () => {
      return !!api.getCurrentUser();
    },
  });
}

export default {
  name: "secure-hide-composer",
  initialize() {
    withPluginApi(initializeSecureHideComposer);
  },
};
