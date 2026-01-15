export function setup(helper) {
  helper.allowList([
    "div.secure-hide",
    "div.secure-hide[data-secure-hide-actions]",
    "div.secure-hide[data-secure-hide-mode]",
    "span.secure-hide",
    "span.secure-hide[data-secure-hide-actions]",
    "span.secure-hide[data-secure-hide-mode]",
    "div.secure-hide-placeholder",
    "div.secure-hide-placeholder[data-secure-hide-actions]",
    "div.secure-hide-placeholder[data-secure-hide-block-index]",
    "div.secure-hide-placeholder[data-secure-hide-mode]",
    "div.secure-hide-placeholder[data-secure-hide-post-id]",
    "span.secure-hide-placeholder",
    "span.secure-hide-placeholder[data-secure-hide-actions]",
    "span.secure-hide-placeholder[data-secure-hide-block-index]",
    "span.secure-hide-placeholder[data-secure-hide-mode]",
    "span.secure-hide-placeholder[data-secure-hide-post-id]",
  ]);

  helper.registerOptions((opts, siteSettings) => {
    opts.features["secure-hide"] = !!siteSettings.secure_hide_enabled;
  });

  helper.registerPlugin((md) => {
    md.inline.bbcode.ruler.push("secure_hide", {
      tag: "secure_hide",
      wrap(startToken, endToken, tagInfo) {
        startToken.type = `bbcode_${tagInfo.tag}_open`;
        startToken.tag = "span";
        startToken.nesting = 1;
        startToken.markup = startToken.content;
        startToken.content = "";
        startToken.attrs = [["class", "secure-hide"]];

        const actions = tagInfo.attrs?.actions || tagInfo.attrs?._default;
        const mode = tagInfo.attrs?.mode;

        if (actions) {
          startToken.attrSet("data-secure-hide-actions", actions);
        }

        if (mode) {
          startToken.attrSet("data-secure-hide-mode", mode);
        }

        endToken.type = `bbcode_${tagInfo.tag}_close`;
        endToken.tag = "span";
        endToken.nesting = -1;
        endToken.markup = startToken.markup;
        endToken.content = "";

        return true;
      },
    });

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
