# frozen_string_literal: true

module DiscourseSecureHide
  class Extractor
    PLACEHOLDER_CSS_CLASS = "secure-hide-placeholder"
    SOURCE_CSS_CLASS = "secure-hide"

    def self.extract!(doc, post)
      nodes = doc.css(".#{SOURCE_CSS_CLASS}")

      if nodes.blank?
        if post.custom_fields[DiscourseSecureHide::POST_CUSTOM_FIELD].present?
          post.custom_fields.delete(DiscourseSecureHide::POST_CUSTOM_FIELD)
          post.save_custom_fields
        end
        return
      end

      config = extract_config(nodes.first)
      blocks = []

      nodes.each_with_index do |node, index|
        blocks << { "html" => node.inner_html }

        placeholder = Nokogiri::XML::Node.new(node.name, doc)
        placeholder["class"] = PLACEHOLDER_CSS_CLASS
        placeholder["data-secure-hide-post-id"] = post.id.to_s
        placeholder["data-secure-hide-block-index"] = index.to_s
        placeholder["data-secure-hide-mode"] = config["mode"]
        placeholder["data-secure-hide-actions"] = config["actions"].join(",")
        placeholder.content = I18n.t("secure_hide.placeholder.fallback")

        node.replace(placeholder)
      end

      post.custom_fields[DiscourseSecureHide::POST_CUSTOM_FIELD] = {
        "version" => 1,
        "mode" => config["mode"],
        "actions" => config["actions"],
        "blocks" => blocks,
      }
      post.save_custom_fields
    end

    def self.extract_config(node)
      mode = node["data-secure-hide-mode"].to_s.downcase
      mode = "any" if !DiscourseSecureHide::ALLOWED_MODES.include?(mode)

      actions =
        node["data-secure-hide-actions"]
          .to_s
          .split(",")
          .map { |a| a.strip.downcase }
          .select { |a| DiscourseSecureHide::ALLOWED_ACTIONS.include?(a) }
          .uniq

      actions = DiscourseSecureHide::ALLOWED_ACTIONS if actions.blank?

      { "mode" => mode, "actions" => actions }
    end

    private_class_method :extract_config
  end
end
