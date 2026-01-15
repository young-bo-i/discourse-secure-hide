# frozen_string_literal: true

module DiscourseSecureHide
  class RawFilter
    SECURE_HIDE_REGEX = %r{\[secure_hide([^\]]*)\](.*?)\[/secure_hide\]}im

    def self.redact(raw)
      return raw if raw.blank?

      placeholder = I18n.t("secure_hide.raw.hidden")

      raw.gsub(SECURE_HIDE_REGEX) do
        attrs = Regexp.last_match(1).to_s
        "[secure_hide#{attrs}]#{placeholder}[/secure_hide]"
      end
    end
  end
end
