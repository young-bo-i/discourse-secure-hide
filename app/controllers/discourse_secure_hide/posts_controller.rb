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

      status = DiscourseSecureHide::Visibility.status_for(guardian: guardian, post: post)
      raise Discourse::NotFound if status.blank?

      if !status[:allowed]
        render json: {
                 error: I18n.t("secure_hide.errors.not_unlocked"),
                 post_id: post.id,
                 mode: status[:mode],
                 actions: status[:actions],
                 satisfied_actions: status[:satisfied_actions],
               },
               status: :forbidden
        return
      end

      blocks =
        Array(data["blocks"]).map.with_index do |block, index|
          { index: index, html: block["html"].to_s }
        end

      render json: {
               post_id: post.id,
               mode: status[:mode],
               actions: status[:actions],
               satisfied_actions: status[:satisfied_actions],
               visible_reason: status[:visible_reason],
               blocks: blocks,
             }
    end
  end
end
