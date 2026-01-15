# frozen_string_literal: true

module DiscourseSecureHide
  class PostsController < ::ApplicationController
    requires_plugin PLUGIN_NAME
    before_action :ensure_logged_in

    def show
      post = Post.find_by(id: params[:post_id])
      raise Discourse::NotFound if post.blank?
      raise Discourse::InvalidAccess unless guardian.can_see_post?(post)

      data = post.custom_fields[DiscourseSecureHide::POST_CUSTOM_FIELD]
      raise Discourse::NotFound if data.blank?

      actions = Array(data["actions"]).map(&:to_s)
      mode = data["mode"].to_s

      reason = DiscourseSecureHide::Visibility.reason_for(guardian: guardian, post: post)
      if reason.blank?
        render_json_error(I18n.t("secure_hide.errors.not_unlocked"), status: 403)
        return
      end

      blocks =
        Array(data["blocks"]).map.with_index do |block, index|
          { index: index, html: block["html"].to_s }
        end

      render json: {
               post_id: post.id,
               mode: mode,
               actions: actions,
               visible_reason: reason,
               blocks: blocks,
             }
    end
  end
end
