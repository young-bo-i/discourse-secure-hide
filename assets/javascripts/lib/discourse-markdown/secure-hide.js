export function setup(helper) {
  helper.allowList([
    "div.secure-hide",
    "div.secure-hide[data-secure-hide-actions]",
    "div.secure-hide[data-secure-hide-mode]",
    "div.secure-hide-placeholder",
    "div.secure-hide-placeholder[data-secure-hide-actions]",
    "div.secure-hide-placeholder[data-secure-hide-block-index]",
    "div.secure-hide-placeholder[data-secure-hide-mode]",
    "div.secure-hide-placeholder[data-secure-hide-post-id]",
  ]);

  helper.registerOptions((opts, siteSettings) => {
    opts.features["secure-hide"] = !!siteSettings.secure_hide_enabled;
  });

  helper.registerPlugin((md) => {
    md.block.bbcode.ruler.push("secure_hide", {
      tag: "secure_hide",
      wrap(token, info) {
        token.tag = "div";
        token.attrJoin("class", "secure-hide");

        const actions = info.attrs?.actions || info.attrs?._default;
        const mode = info.attrs?.mode;

        if (actions) {
          token.attrSet("data-secure-hide-actions", actions);
        }

        if (mode) {
          token.attrSet("data-secure-hide-mode", mode);
        }

        return true;
      },
    });
  });
}
