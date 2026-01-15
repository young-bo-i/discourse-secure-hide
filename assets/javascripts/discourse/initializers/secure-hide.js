import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import getURL from "discourse/lib/get-url";
import { withPluginApi } from "discourse/lib/plugin-api";
import Composer from "discourse/models/composer";
import { i18n } from "discourse-i18n";

const pendingReplyUnlockPostIds = new Set();
const pendingReplyUnlockTopicIdsByPostId = new Map();

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
  const wrapper = document.createElement("div");
  wrapper.className = "secure-hide-content";

  if (reason && reason !== "unlocked") {
    const banner = document.createElement("div");
    banner.className = "secure-hide-content__notice";
    banner.textContent = i18n(`secure_hide.visible_reason.${reason}`);
    wrapper.append(banner);
  }

  const fragment = document
    .createRange()
    .createContextualFragment(
      `<div class="secure-hide-content__body">${html}</div>`
    );
  wrapper.append(fragment);

  placeholder.replaceWith(wrapper);
}

async function fetchHiddenBlocks(postId) {
  return ajax(`/secure-hide/posts/${postId}`);
}

async function unlockPostBlocks(postElement, postId) {
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
      for (const placeholder of placeholders) {
        const notice = placeholder.querySelector(
          ".secure-hide-placeholder__notice"
        );
        if (notice) {
          notice.textContent = i18n("secure_hide.placeholder.still_locked");
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
  });

  api.decorateCookedElement(
    (element, helper) => {
      const placeholders = element.querySelectorAll(".secure-hide-placeholder");
      if (!placeholders.length) {
        return;
      }

      const currentUser = api.getCurrentUser();
      const postId = helper?.model?.id;
      const postUserId = helper?.model?.user_id;
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

          await unlockPostBlocks(element, resolvedPostId);
        };

        if (shouldAutoFetch) {
          const placeholderPostId = placeholder.dataset.secureHidePostId;
          if (!placeholderPostId || placeholderPostId === postId?.toString()) {
            tryUnlock();
          }
          return;
        }

        const unlockButton = addButton(actionsRow, {
          label: i18n("secure_hide.button.unlock"),
          onClick: tryUnlock,
        });

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
            const resolvedPostId =
              placeholder.dataset.secureHidePostId || postId?.toString();
            const resolvedTopicId = helper?.model?.topic_id;

            if (resolvedPostId) {
              pendingReplyUnlockPostIds.add(resolvedPostId.toString());
              if (resolvedTopicId) {
                pendingReplyUnlockTopicIdsByPostId.set(
                  resolvedPostId.toString(),
                  resolvedTopicId
                );
              }
            }

            composer.open({
              action: Composer.REPLY,
              post: helper.model,
            });
          };

          const replyButton = addSecondaryButton(actionsRow, {
            label: i18n("secure_hide.button.reply"),
            onClick: onReplyClick,
          });

          cleanupHandlers.push(() =>
            replyButton.removeEventListener("click", onReplyClick)
          );
        }

        cleanupHandlers.push(() =>
          unlockButton.removeEventListener("click", tryUnlock)
        );
      });

      return () => cleanupHandlers.forEach((fn) => fn());
    },
    { onlyStream: true }
  );
}

export default {
  name: "secure-hide",
  initialize() {
    withPluginApi(initializeSecureHide);
  },
};
