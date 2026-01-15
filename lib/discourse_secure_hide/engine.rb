# frozen_string_literal: true

module DiscourseSecureHide
  class Engine < ::Rails::Engine
    engine_name PLUGIN_NAME
    isolate_namespace DiscourseSecureHide
  end
end
