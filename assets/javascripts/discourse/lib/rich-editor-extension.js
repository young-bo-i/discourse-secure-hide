import { i18n } from "discourse-i18n";

const SECURE_HIDE_NODES = ["inline_secure_hide", "secure_hide"];
const ALLOWED_ACTIONS = ["like", "reply"];
const ALLOWED_MODES = ["any", "all"];

function normalizedAttrs(attrs) {
  const actions = Array.isArray(attrs?.actions) ? attrs.actions : [];
  const mode = ALLOWED_MODES.includes(attrs?.mode) ? attrs.mode : "any";

  const normalizedActions = actions
    .map((action) => action?.toString?.())
    .filter(Boolean)
    .filter((action) => ALLOWED_ACTIONS.includes(action))
    .filter((action, index, array) => array.indexOf(action) === index);

  return {
    mode,
    actions: normalizedActions.length ? normalizedActions : ["reply"],
  };
}

function parseTokenAttrs(token) {
  const mode = token.attrGet("data-secure-hide-mode") || "any";
  const actions = (token.attrGet("data-secure-hide-actions") || "")
    .split(",")
    .map((action) => action.trim())
    .filter(Boolean);

  return normalizedAttrs({ mode, actions });
}

function serializeBbcodeAttrs({ mode, actions }) {
  const parts = [];

  if (mode) {
    parts.push(`mode=${mode}`);
  }

  if (actions?.length) {
    parts.push(`actions=${actions.join(",")}`);
  }

  return parts.length ? ` ${parts.join(" ")}` : "";
}

/** @type {RichEditorExtension} */
const extension = {
  nodeSpec: {
    secure_hide: {
      attrs: { mode: { default: "any" }, actions: { default: ["reply"] } },
      group: "block",
      content: "block+",
      createGapCursor: true,
      parseDOM: [{ tag: "div.secure-hide" }],
      toDOM: (node) => [
        "div",
        {
          class: "secure-hide secure-hide-editor",
          "data-secure-hide-mode": node.attrs.mode,
          "data-secure-hide-actions": node.attrs.actions.join(","),
        },
        0,
      ],
    },
    inline_secure_hide: {
      attrs: { mode: { default: "any" }, actions: { default: ["reply"] } },
      group: "inline",
      inline: true,
      content: "inline*",
      parseDOM: [{ tag: "span.secure-hide" }],
      toDOM: (node) => [
        "span",
        {
          class: "secure-hide secure-hide-editor",
          "data-secure-hide-mode": node.attrs.mode,
          "data-secure-hide-actions": node.attrs.actions.join(","),
        },
        0,
      ],
    },
  },

  parse: {
    wrap_bbcode(state, token) {
      const klass = token.attrGet("class") || "";
      if (!/\bsecure-hide\b/.test(klass)) {
        return;
      }

      if (token.nesting === 1) {
        const attrs = parseTokenAttrs(token);
        const nodeType =
          token.tag === "span"
            ? state.schema.nodes.inline_secure_hide
            : state.schema.nodes.secure_hide;
        state.openNode(nodeType, attrs);
        return true;
      }

      if (
        token.nesting === -1 &&
        SECURE_HIDE_NODES.includes(state.top().type.name)
      ) {
        state.closeNode();
        return true;
      }
    },
  },

  serializeNode: () => ({
    secure_hide(state, node) {
      const attrs = normalizedAttrs(node.attrs);
      state.write(`[secure_hide${serializeBbcodeAttrs(attrs)}]\n`);
      state.renderContent(node);
      state.write(`\n[/secure_hide]\n\n`);
    },
    inline_secure_hide(state, node) {
      const attrs = normalizedAttrs(node.attrs);
      state.write(`[secure_hide${serializeBbcodeAttrs(attrs)}]`);
      state.renderInline(node);
      state.write("[/secure_hide]");
    },
  }),

  state: ({ utils, schema }, state) => ({
    inSecureHide: SECURE_HIDE_NODES.some((nodeType) =>
      utils.inNode(state, schema.nodes[nodeType])
    ),
  }),

  commands: ({ schema, utils, pmState: { TextSelection }, pmCommands }) => ({
    toggleSecureHide(attrs = {}) {
      return (state, dispatch, view) => {
        const { selection } = state;
        const { empty, $from, $to } = selection;

        const inSecureHide = SECURE_HIDE_NODES.some((nodeType) =>
          utils.inNode(state, schema.nodes[nodeType])
        );

        if (inSecureHide) {
          for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth);
            if (SECURE_HIDE_NODES.includes(node.type.name)) {
              const wrapperStart = $from.before(depth);
              const wrapperEnd = wrapperStart + node.nodeSize;
              const tr = state.tr.replaceWith(
                wrapperStart,
                wrapperEnd,
                node.content
              );
              dispatch?.(tr);
              return true;
            }
          }

          return false;
        }

        const normalized = normalizedAttrs(attrs);

        if (empty) {
          const textNode = schema.text(i18n("composer.secure_hide_text"));
          const isBlock = view?.endOfTextblock?.("backward");
          const nodeType = isBlock
            ? schema.nodes.secure_hide
            : schema.nodes.inline_secure_hide;

          const wrapperNode =
            nodeType === schema.nodes.secure_hide
              ? schema.nodes.secure_hide.createAndFill(
                  normalized,
                  schema.nodes.paragraph.createAndFill(null, textNode)
                )
              : schema.nodes.inline_secure_hide.createAndFill(
                  normalized,
                  textNode
                );

          const tr = state.tr.replaceSelectionWith(wrapperNode);
          tr.setSelection(
            TextSelection.create(
              tr.doc,
              $from.pos + 1,
              $from.pos + 1 + textNode.nodeSize
            )
          );

          dispatch?.(tr);
          return true;
        }

        const isBlockNodeSelection =
          $from.parent === $to.parent &&
          $from.parentOffset === 0 &&
          $to.parentOffset === $from.parent.content.size &&
          $from.parent.isBlock &&
          $from.depth > 0;

        if (isBlockNodeSelection) {
          return pmCommands.wrapIn(schema.nodes.secure_hide, normalized)(
            state,
            dispatch
          );
        }

        const slice = selection.content();
        const isInlineSelection = slice.openStart > 0 || slice.openEnd > 0;

        if (isInlineSelection) {
          const content = [];
          slice.content.forEach((node) =>
            node.isBlock
              ? node.content.forEach((child) => content.push(child))
              : content.push(node)
          );

          const wrapperNode = schema.nodes.inline_secure_hide.createAndFill(
            normalized,
            content
          );

          const tr = state.tr.replaceWith($from.pos, $to.pos, wrapperNode);
          tr.setSelection(
            TextSelection.create(
              tr.doc,
              $from.pos + 1,
              $from.pos + wrapperNode.nodeSize - 1
            )
          );

          dispatch?.(tr);
          return true;
        }

        return pmCommands.wrapIn(schema.nodes.secure_hide, normalized)(
          state,
          (tr) => {
            tr.setSelection(
              TextSelection.create(tr.doc, $from.pos + 2, $to.pos)
            );
            dispatch?.(tr);
          }
        );
      };
    },
  }),
};

export default extension;
