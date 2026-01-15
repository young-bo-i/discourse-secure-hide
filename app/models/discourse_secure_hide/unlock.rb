# frozen_string_literal: true

module DiscourseSecureHide
  class Unlock < ::ActiveRecord::Base
    self.table_name = "secure_hide_unlocks"
  end
end
