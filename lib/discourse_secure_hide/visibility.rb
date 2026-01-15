# frozen_string_literal: true

module DiscourseSecureHide
  class Visibility
    def self.unlocks_available?
      return false if !defined?(DiscourseSecureHide::Unlock)

      DiscourseSecureHide::Unlock.table_exists?
    rescue ActiveRecord::NoDatabaseError, ActiveRecord::StatementInvalid, PG::ConnectionBad
      false
    end

    def self.reason_for(guardian:, post:)
      return if post.blank?

      return "staff" if guardian.is_staff?

      user = guardian.user
      return if user.blank?
      return "author" if post.user_id == user.id

      data = post.custom_fields[DiscourseSecureHide::POST_CUSTOM_FIELD]
      return if data.blank?

      if unlocks_available? &&
           DiscourseSecureHide::Unlock.where(user_id: user.id, post_id: post.id).exists?
        return "unlocked"
      end

      evaluation = evaluation_for(post: post, user: user, data: data)
      return if evaluation.blank?
      return if !evaluation[:allowed]

      unlocked_via = evaluation[:unlocked_via]

      if unlocks_available?
        DiscourseSecureHide::Unlock.find_or_create_by(
          user_id: user.id,
          post_id: post.id,
        ) do |unlock|
          unlock.unlocked_at = Time.zone.now
          unlock.unlocked_via = unlocked_via
        end
      end

      "unlocked"
    end

    def self.status_for(guardian:, post:)
      return if post.blank?

      data = post.custom_fields[DiscourseSecureHide::POST_CUSTOM_FIELD]
      return if data.blank?

      config = config_for(data)
      return if config.blank?

      if guardian.is_staff?
        return(
          {
            mode: config[:mode],
            actions: config[:actions],
            satisfied_actions: config[:actions],
            allowed: true,
            visible_reason: "staff",
          }
        )
      end

      user = guardian.user
      return if user.blank?

      if post.user_id == user.id
        return(
          {
            mode: config[:mode],
            actions: config[:actions],
            satisfied_actions: config[:actions],
            allowed: true,
            visible_reason: "author",
          }
        )
      end

      if unlocks_available? &&
           DiscourseSecureHide::Unlock.where(user_id: user.id, post_id: post.id).exists?
        return(
          {
            mode: config[:mode],
            actions: config[:actions],
            satisfied_actions: config[:actions],
            allowed: true,
            visible_reason: "unlocked",
          }
        )
      end

      evaluation = evaluation_for(post: post, user: user, data: data)
      return if evaluation.blank?

      if evaluation[:allowed] && unlocks_available?
        DiscourseSecureHide::Unlock.find_or_create_by(
          user_id: user.id,
          post_id: post.id,
        ) do |unlock|
          unlock.unlocked_at = Time.zone.now
          unlock.unlocked_via = evaluation[:unlocked_via]
        end
      end

      {
        mode: evaluation[:mode],
        actions: evaluation[:actions],
        satisfied_actions: evaluation[:satisfied_actions],
        allowed: evaluation[:allowed],
        visible_reason: evaluation[:allowed] ? "unlocked" : nil,
      }
    end

    def self.satisfies_action?(post, user, action)
      case action
      when "like"
        PostAction.where(
          post_id: post.id,
          user_id: user.id,
          post_action_type_id: PostActionType.types[:like],
        ).exists?
      when "reply"
        Post
          .where(
            topic_id: post.topic_id,
            user_id: user.id,
            post_type: Post.types[:regular],
            deleted_at: nil,
          )
          .where.not(id: post.id)
          .exists?
      else
        false
      end
    end

    def self.config_for(data)
      actions =
        Array(data["actions"])
          .map(&:to_s)
          .select { |action| DiscourseSecureHide::ALLOWED_ACTIONS.include?(action) }
      return if actions.blank?

      mode = data["mode"].to_s
      mode = "any" if DiscourseSecureHide::ALLOWED_MODES.exclude?(mode)

      { mode: mode, actions: actions }
    end

    def self.evaluation_for(post:, user:, data:)
      config = config_for(data)
      return if config.blank?

      satisfied_by_action =
        config[:actions].to_h { |action| [action, satisfies_action?(post, user, action)] }

      allowed =
        config[:mode] == "all" ? satisfied_by_action.values.all? : satisfied_by_action.values.any?

      unlocked_via =
        if config[:mode] == "all"
          "all"
        else
          satisfied_by_action.find { |_, satisfied| satisfied }&.first || "any"
        end

      {
        mode: config[:mode],
        actions: config[:actions],
        satisfied_actions: satisfied_by_action.select { |_, satisfied| satisfied }.keys,
        allowed: allowed,
        unlocked_via: unlocked_via,
      }
    end

    private_class_method :satisfies_action?
    private_class_method :config_for
    private_class_method :evaluation_for
  end
end
