import { next } from "@ember/runloop";
import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import getURL from "discourse/lib/get-url";
import { withPluginApi } from "discourse/lib/plugin-api";
import Composer from "discourse/models/composer";
import { i18n } from "discourse-i18n";

const pendingReplyUnlockPostIds = new Set();
const pendingReplyUnlockTopicIdsByPostId = new Map();
const checkedPostIds = new Set();

function buildRequirementsList({ actions }) {
  const list = document.createElement("ul");
  list.className = "secure-hide-placeholder__requirements";

  for (const action of actions) {
    const item = document.createElement("li");
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
  placeholder.append(buildRequirementsList({ actions }));

  const actionsRow = document.createElement("div");
  actionsRow.className = "secure-hide-placeholder__actions";
  placeholder.append(actionsRow);

  return actionsRow;
}

function addLoginLink(actionsRow) {
  const link = document.createElement("a");
  link.className = "btn btn-primary";
  link.href = getURL("/login");
  link.textContent = i18n("secure_hide.button.login");
  actionsRow.append(link);
}

function addButton(actionsRow, { label, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary";
  button.textContent = label;
  button.addEventListener("click", onClick);
  actionsRow.append(button);
  return button;
}

function addSecondaryButton(actionsRow, { label, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-default";
  button.textContent = label;
  button.addEventListener("click", onClick);
  actionsRow.append(button);
  return button;
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
  } catch (error) {
    if (error?.jqXHR?.status === 403) {
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
      return;
    }

    popupAjaxError(error);
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

    unlockPostBlocks(postElement, post.id.toString());
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

        unlockPostBlocks(postElement, postId.toString());
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

        unlockPostBlocks(postElement, postId.toString());
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

        const actionsRow = setPlaceholderContents(placeholder, {
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
            tryUnlock();
          };

          const likeButton = addSecondaryButton(actionsRow, {
            label: i18n("secure_hide.button.like"),
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
            const replyButton = postRoot.querySelector("button.reply");
            if (replyButton) {
              replyButton.click();
              return;
            }

            if (!model) {
              return;
            }

            const composerOpts = { action: Composer.REPLY };
            const postNumber = model.get?.("post_number") ?? model.post_number;
            if (postNumber === 1) {
              composerOpts.topic = model.get?.("topic") ?? model.topic;
            } else {
              composerOpts.post = model;
            }

            composer.open(composerOpts);
          };

          const onPlaceholderClick = (event) => {
            if (event.defaultPrevented) {
              return;
            }

            const interactiveElement = event.target.closest(
              "a, button, input, textarea, select"
            );
            if (interactiveElement) {
              return;
            }

            onReplyClick();
          };

          const replyButton = addButton(actionsRow, {
            label: i18n("secure_hide.button.reply"),
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
