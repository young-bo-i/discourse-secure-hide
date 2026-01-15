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

      actions =
        Array(data["actions"])
          .map(&:to_s)
          .select { |action| DiscourseSecureHide::ALLOWED_ACTIONS.include?(action) }
      return if actions.blank?

      mode = data["mode"].to_s
      mode = "any" if DiscourseSecureHide::ALLOWED_MODES.exclude?(mode)

      satisfied_by_action =
        actions.to_h { |action| [action, satisfies_action?(post, user, action)] }
      allowed = mode == "all" ? satisfied_by_action.values.all? : satisfied_by_action.values.any?
      return if !allowed

      unlocked_via =
        if mode == "all"
          "all"
        else
          satisfied_by_action.find { |_, satisfied| satisfied }&.first || "any"
        end

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

    private_class_method :satisfies_action?
  end
end
