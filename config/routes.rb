# frozen_string_literal: true

DiscourseSecureHide::Engine.routes.draw { get "/posts/:post_id" => "posts#show" }
