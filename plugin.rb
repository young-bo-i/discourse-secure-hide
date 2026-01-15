# frozen_string_literal: true

# name: discourse-secure-hide
# about: Hide portions of a post until the viewer unlocks them via configured actions.
# version: 0.1
# authors: enterscholar
# url: https://github.com/discourse/discourse/tree/main/plugins/discourse-secure-hide

enabled_site_setting :secure_hide_enabled

register_asset "stylesheets/common/secure-hide.scss"

module ::DiscourseSecureHide
  PLUGIN_NAME = "discourse-secure-hide"

  POST_CUSTOM_FIELD = "secure_hide_data"
  ALLOWED_ACTIONS = %w[like reply].freeze
  ALLOWED_MODES = %w[any all].freeze
end

require_relative "lib/discourse_secure_hide/engine"

after_initialize do
  require_relative "lib/discourse_secure_hide/extractor"
  require_relative "lib/discourse_secure_hide/raw_filter"
  require_relative "lib/discourse_secure_hide/visibility"

  register_post_custom_field_type(DiscourseSecureHide::POST_CUSTOM_FIELD, :json)

  require_relative "app/models/discourse_secure_hide/unlock"
  require_relative "app/controllers/discourse_secure_hide/posts_controller"

  Discourse::Application.routes.append { mount ::DiscourseSecureHide::Engine, at: "/secure-hide" }

  on(:before_post_process_cooked) do |doc, post|
    next unless SiteSetting.secure_hide_enabled
    next if post.blank?

    DiscourseSecureHide::Extractor.extract!(doc, post)
  end

  on(:reduce_excerpt) do |doc, opts|
    post = opts.is_a?(Hash) ? opts[:post] : nil
    doc
      .css("div.secure-hide-placeholder")
      .each do |el|
        link = Nokogiri::XML::Node.new("a", doc.document || doc)
        link["href"] = post&.url.presence || Discourse.base_url
        link.content = I18n.t("secure_hide.excerpt.hidden")
        el.replace(link)
      end
  end

  module ::DiscourseSecureHide::PostSerializerExtension
    def raw
      original = super
      return original if !SiteSetting.secure_hide_enabled
      return original if original.blank?
      return original if object.custom_fields[DiscourseSecureHide::POST_CUSTOM_FIELD].blank?

      reason = DiscourseSecureHide::Visibility.reason_for(guardian: scope, post: object)
      return original if reason.present?

      DiscourseSecureHide::RawFilter.redact(original)
    end
  end

  ::PostSerializer.prepend(::DiscourseSecureHide::PostSerializerExtension)

  module ::DiscourseSecureHide::PostsControllerExtension
    def markdown_num
      if params[:revision].present?
        post_revision = find_post_revision_from_topic_id

        post = post_revision.post
        raw = post_revision.modifications[:raw].last.to_s

        if SiteSetting.secure_hide_enabled &&
             post&.custom_fields&.[](DiscourseSecureHide::POST_CUSTOM_FIELD).present?
          reason = DiscourseSecureHide::Visibility.reason_for(guardian: guardian, post: post)
          raw = DiscourseSecureHide::RawFilter.redact(raw) if reason.blank?
        end

        render plain: raw
        return
      end

      return super if params[:post_number].present?

      opts = params.slice(:page)
      opts[:limit] = self.class::MARKDOWN_TOPIC_PAGE_SIZE
      topic_view = TopicView.new(params[:topic_id], current_user, opts)
      content =
        topic_view.posts.map do |topic_post|
          post_raw = topic_post.raw

          if SiteSetting.secure_hide_enabled &&
               topic_post.custom_fields[DiscourseSecureHide::POST_CUSTOM_FIELD].present?
            reason =
              DiscourseSecureHide::Visibility.reason_for(guardian: guardian, post: topic_post)
            post_raw = DiscourseSecureHide::RawFilter.redact(post_raw) if reason.blank?
          end

          <<~MD
            #{topic_post.user.username} | #{topic_post.updated_at} | ##{topic_post.post_number}

            #{post_raw}

            -------------------------

          MD
        end

      render plain: content.join
    end

    protected

    def markdown(post)
      if post && guardian.can_see?(post)
        raw = post.raw

        if SiteSetting.secure_hide_enabled &&
             post.custom_fields[DiscourseSecureHide::POST_CUSTOM_FIELD].present?
          reason = DiscourseSecureHide::Visibility.reason_for(guardian: guardian, post: post)
          raw = DiscourseSecureHide::RawFilter.redact(raw) if reason.blank?
        end

        render plain: raw
      else
        raise Discourse::NotFound
      end
    end
  end

  ::PostsController.prepend(::DiscourseSecureHide::PostsControllerExtension)
end
