import { next } from "@ember/runloop";
import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import getURL from "discourse/lib/get-url";
import { iconElement } from "discourse/lib/icon-library";
import { withPluginApi } from "discourse/lib/plugin-api";
import { i18n } from "discourse-i18n";

const pendingReplyUnlockPostIds = new Set();
const pendingReplyUnlockTopicIdsByPostId = new Map();
const checkedPostIds = new Set();

function buildRequirementsList({ actions }) {
  const list = document.createElement("ul");
  list.className = "secure-hide-placeholder__requirements";

  for (const action of actions) {
    const item = document.createElement("li");
    item.dataset.secureHideAction = action;
    item.textContent = i18n(`secure_hide.requirements.action.${action}`);
    list.append(item);
  }

  return list;
}

function setPlaceholderContents(placeholder, { mode, actions, loggedIn }) {
  placeholder.textContent = "";

  const notice = document.createElement("div");
  notice.className = "secure-hide-placeholder__notice";

  if (!loggedIn) {
    notice.textContent = i18n("secure_hide.placeholder.login_required");
  } else {
    notice.textContent =
      mode === "all"
        ? i18n("secure_hide.placeholder.all_required")
        : i18n("secure_hide.placeholder.any_required");
  }

  placeholder.append(notice);
  const requirements = buildRequirementsList({ actions });
  placeholder.append(requirements);

  const actionsRow = document.createElement("div");
  actionsRow.className = "secure-hide-placeholder__actions";
  placeholder.append(actionsRow);

  return { actionsRow, requirements };
}

function addLoginLink(actionsRow) {
  const link = document.createElement("a");
  link.className = "btn btn-primary";
  link.href = getURL("/login");
  link.textContent = i18n("secure_hide.button.login");
  actionsRow.append(link);
}

function addActionButton(actionsRow, { label, icon, classes, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn btn-flat btn-icon-text secure-hide-action-button ${
    classes || ""
  }`.trim();

  if (icon) {
    button.append(
      iconElement(icon, { class: "secure-hide-action-button__icon" })
    );
  }

  const text = document.createElement("span");
  text.className = "d-button-label secure-hide-action-button__label";
  text.textContent = label;
  button.append(text);

  button.addEventListener("click", onClick);
  actionsRow.append(button);
  return button;
}

function updateRequirementState(requirements, satisfiedActions = new Set()) {
  const items = requirements.querySelectorAll("li[data-secure-hide-action]");
  items.forEach((item) => {
    const action = item.dataset.secureHideAction;
    const satisfied = satisfiedActions.has(action);
    item.classList.toggle("is-satisfied", satisfied);
  });
}

function replaceWithUnlockedContent(placeholder, { html, reason }) {
  const isInline = placeholder.tagName === "SPAN";
  const wrapper = document.createElement(isInline ? "span" : "div");
  wrapper.className = "secure-hide-content";

  const privileged = reason && reason !== "unlocked";
  if (privileged) {
    wrapper.classList.add("secure-hide-content--privileged");
  }

  if (privileged) {
    const banner = document.createElement(isInline ? "span" : "div");
    banner.className = "secure-hide-content__notice";
    banner.textContent = i18n(`secure_hide.visible_reason.${reason}`);
    wrapper.append(banner);
  }

  const bodyTag = isInline ? "span" : "div";
  const fragment = document
    .createRange()
    .createContextualFragment(
      `<${bodyTag} class="secure-hide-content__body">${html}</${bodyTag}>`
    );
  wrapper.append(fragment);

  placeholder.replaceWith(wrapper);
}

async function fetchHiddenBlocks(postId) {
  return ajax(`/secure-hide/posts/${postId}`);
}

async function unlockPostBlocks(
  postElement,
  postId,
  { showLockedNotice } = {}
) {
  const placeholders = postElement.querySelectorAll(
    `.secure-hide-placeholder[data-secure-hide-post-id="${postId}"]`
  );

  if (!placeholders.length) {
    return;
  }

  for (const placeholder of placeholders) {
    placeholder.classList.add("is-loading");
  }

  try {
    const response = await fetchHiddenBlocks(postId);

    for (const block of response.blocks || []) {
      const match = postElement.querySelector(
        `.secure-hide-placeholder[data-secure-hide-post-id="${postId}"][data-secure-hide-block-index="${block.index}"]`
      );

      if (match) {
        replaceWithUnlockedContent(match, {
          html: block.html,
          reason: response.visible_reason,
        });
      }
    }

    return true;
  } catch (error) {
    if (error?.jqXHR?.status === 403) {
      const responseJson = error?.jqXHR?.responseJSON;
      const satisfied = new Set(responseJson?.satisfied_actions || []);

      for (const placeholder of placeholders) {
        const requirements = placeholder.querySelector(
          ".secure-hide-placeholder__requirements"
        );
        if (requirements) {
          updateRequirementState(requirements, satisfied);
        }
      }

      if (showLockedNotice) {
        for (const placeholder of placeholders) {
          const notice = placeholder.querySelector(
            ".secure-hide-placeholder__notice"
          );
          if (notice) {
            notice.textContent = i18n("secure_hide.placeholder.still_locked");
          }
        }
      }
      return false;
    }

    popupAjaxError(error);
    return false;
  } finally {
    for (const placeholder of placeholders) {
      placeholder.classList.remove("is-loading");
    }
  }
}

function initializeSecureHide(api) {
  const siteSettings = api.container.lookup("service:site-settings");
  if (!siteSettings.secure_hide_enabled) {
    return;
  }

  api.modifyClass("component:post-text-selection", (Superclass) => {
    return class extends Superclass {
      computeCurrentCooked() {
        const cooked = super.computeCurrentCooked();
        if (!cooked) {
          return cooked;
        }

        const selection = window.getSelection();
        if (!selection?.rangeCount) {
          return cooked;
        }

        const range = selection.getRangeAt(0);
        const startElement =
          range.startContainer?.nodeType === Node.ELEMENT_NODE
            ? range.startContainer
            : range.startContainer?.parentElement;
        const endElement =
          range.endContainer?.nodeType === Node.ELEMENT_NODE
            ? range.endContainer
            : range.endContainer?.parentElement;

        const selector = ".secure-hide-content, .secure-hide-placeholder";
        if (
          startElement?.closest?.(selector) ||
          endElement?.closest?.(selector)
        ) {
          return;
        }

        return cooked;
      }
    };
  });

  api.onAppEvent("page:like-toggled", (post, likeAction) => {
    if (!likeAction?.acted) {
      return;
    }

    const postElement = document.querySelector(
      `article#post_${post.id}, .topic-post[data-post-id="${post.id}"]`
    );
    if (!postElement) {
      return;
    }

    const placeholders = postElement.querySelectorAll(
      `.secure-hide-placeholder[data-secure-hide-post-id="${post.id}"]`
    );
    if (!placeholders.length) {
      return;
    }

    const hasLikeRequirement = [...placeholders].some((placeholder) =>
      (placeholder.dataset.secureHideActions || "").includes("like")
    );
    if (!hasLikeRequirement) {
      return;
    }

    unlockPostBlocks(postElement, post.id.toString(), {
      showLockedNotice: true,
    });
  });

  api.onAppEvent("post:created", (createdPost) => {
    next(() => {
      const ids = [...pendingReplyUnlockPostIds];
      pendingReplyUnlockPostIds.clear();

      for (const postId of ids) {
        const topicId = pendingReplyUnlockTopicIdsByPostId.get(postId);
        pendingReplyUnlockTopicIdsByPostId.delete(postId);
        if (
          topicId &&
          createdPost?.topic_id &&
          topicId !== createdPost.topic_id
        ) {
          continue;
        }

        const postElement = document.querySelector(
          `article#post_${postId}, .topic-post[data-post-id="${postId}"]`
        );
        if (!postElement) {
          continue;
        }

        unlockPostBlocks(postElement, postId.toString(), {
          showLockedNotice: true,
        });
      }

      if (!createdPost?.topic_id) {
        return;
      }

      const placeholders = document.querySelectorAll(
        ".secure-hide-placeholder"
      );
      if (!placeholders.length) {
        return;
      }

      const postIdsToTry = new Set();
      placeholders.forEach((placeholder) => {
        const actions = (placeholder.dataset.secureHideActions || "")
          .split(",")
          .map((action) => action.trim())
          .filter(Boolean);

        if (!actions.includes("reply")) {
          return;
        }

        const placeholderPostId = placeholder.dataset.secureHidePostId;
        if (placeholderPostId) {
          postIdsToTry.add(placeholderPostId);
        }
      });

      for (const postId of postIdsToTry) {
        const postElement = document.querySelector(
          `article#post_${postId}, .topic-post[data-post-id="${postId}"]`
        );
        if (!postElement) {
          continue;
        }

        unlockPostBlocks(postElement, postId.toString(), {
          showLockedNotice: true,
        });
      }
    });
  });

  api.decorateCookedElement(
    (element, helper) => {
      const placeholders = element.querySelectorAll(".secure-hide-placeholder");
      if (!placeholders.length) {
        return;
      }

      const currentUser = api.getCurrentUser();
      const model = helper?.getModel?.() || helper?.model;
      const postId = model?.id;
      const postUserId = model?.user_id;
      const composer = api.container.lookup("service:composer");

      const cleanupHandlers = [];

      placeholders.forEach((placeholder) => {
        if (placeholder.dataset.secureHideEnhanced === "true") {
          return;
        }

        placeholder.dataset.secureHideEnhanced = "true";

        const mode = placeholder.dataset.secureHideMode || "any";
        const actions = (placeholder.dataset.secureHideActions || "")
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);

        const { actionsRow } = setPlaceholderContents(placeholder, {
          mode,
          actions,
          loggedIn: !!currentUser,
        });

        if (!currentUser) {
          addLoginLink(actionsRow);
          return;
        }

        const shouldAutoFetch =
          currentUser.staff || (postUserId && currentUser.id === postUserId);

        const tryUnlock = async () => {
          const resolvedPostId =
            placeholder.dataset.secureHidePostId || postId?.toString();
          if (!resolvedPostId) {
            return;
          }

          await unlockPostBlocks(element, resolvedPostId, {
            showLockedNotice: true,
          });
        };

        if (shouldAutoFetch) {
          const placeholderPostId = placeholder.dataset.secureHidePostId;
          if (!placeholderPostId || placeholderPostId === postId?.toString()) {
            tryUnlock();
          }
          return;
        }

        const resolvedPostId =
          placeholder.dataset.secureHidePostId || postId?.toString();
        if (resolvedPostId && !checkedPostIds.has(resolvedPostId)) {
          checkedPostIds.add(resolvedPostId);
          unlockPostBlocks(element, resolvedPostId);
        }

        if (actions.includes("like")) {
          const onLikeClick = () => {
            const postRoot =
              placeholder.closest("article") ||
              placeholder.closest(".topic-post") ||
              document;
            const domLike = postRoot.querySelector("button.toggle-like");
            domLike?.click();
          };

          const likeButton = addActionButton(actionsRow, {
            icon: "d-unliked",
            label: i18n("secure_hide.button.like"),
            classes: "secure-hide-action-button--like",
            onClick: onLikeClick,
          });

          cleanupHandlers.push(() =>
            likeButton.removeEventListener("click", onLikeClick)
          );
        }

        if (actions.includes("reply") && composer) {
          const onReplyClick = () => {
            const replyUnlockPostId =
              placeholder.dataset.secureHidePostId || postId?.toString();
            const resolvedTopicId =
              model?.topic_id ?? model?.topicId ?? model?.get?.("topic_id");

            if (replyUnlockPostId) {
              pendingReplyUnlockPostIds.add(replyUnlockPostId.toString());
              if (resolvedTopicId) {
                pendingReplyUnlockTopicIdsByPostId.set(
                  replyUnlockPostId.toString(),
                  resolvedTopicId
                );
              }
            }

            const postRoot =
              placeholder.closest("article") ||
              placeholder.closest(".topic-post") ||
              document;
            const replyButton = postRoot.querySelector(
              "button.post-action-menu__reply.reply"
            );
            if (replyButton) {
              replyButton.click();
              return;
            }

            const topic = api.container.lookup("controller:topic")?.model;
            if (topic && composer.focusComposer) {
              const postNumber =
                model?.get?.("post_number") ?? model?.post_number;
              composer.focusComposer({
                topic,
                openOpts: postNumber === 1 ? {} : { post: model },
              });
              return;
            }

            if (composer.focusComposer) {
              composer.focusComposer({ fallbackToNewTopic: true });
            }
          };

          const onPlaceholderClick = (event) => {
            if (event.defaultPrevented) {
              return;
            }

            const interactiveElement =
              event.target instanceof Element
                ? event.target.closest("a, button, input, textarea, select")
                : null;
            if (interactiveElement) {
              return;
            }

            onReplyClick();
          };

          const replyButton = addActionButton(actionsRow, {
            icon: "reply",
            label: i18n("secure_hide.button.reply"),
            classes: "create secure-hide-action-button--reply",
            onClick: onReplyClick,
          });

          placeholder.classList.add("is-clickable");
          placeholder.addEventListener("click", onPlaceholderClick);

          cleanupHandlers.push(() =>
            replyButton.removeEventListener("click", onReplyClick)
          );
          cleanupHandlers.push(() =>
            placeholder.removeEventListener("click", onPlaceholderClick)
          );
        }
      });

      return () => cleanupHandlers.forEach((fn) => fn());
    },
    { id: "secure-hide" }
  );
}

export default {
  name: "secure-hide",
  initialize() {
    withPluginApi(initializeSecureHide);
  },
};
