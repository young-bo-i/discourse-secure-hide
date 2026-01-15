# frozen_string_literal: true

describe DiscourseSecureHide::PostsController do
  fab!(:author, :user)
  fab!(:viewer, :user)
  fab!(:admin)

  before do
    SiteSetting.secure_hide_enabled = true
    Jobs.run_immediately!
  end

  def create_post_with_hidden(raw:)
    PostCreator.create!(
      author,
      topic_id: Fabricate(:topic).id,
      raw: raw,
      skip_validations: true,
    ).tap(&:reload)
  end

  it "does not include hidden content in cooked" do
    post = create_post_with_hidden(raw: <<~MD)
          hello

          [secure_hide mode=any actions=like,reply]
          secret
          [/secure_hide]
        MD

    expect(post.cooked).not_to include("secret")
    expect(post.cooked).to include("secure-hide-placeholder")
    expect(post.custom_fields[DiscourseSecureHide::POST_CUSTOM_FIELD]).to be_present
  end

  it "rejects requests when the viewer has not unlocked" do
    post = create_post_with_hidden(raw: <<~MD)
          [secure_hide mode=any actions=like,reply]secret[/secure_hide]
        MD

    sign_in(viewer)
    get "/secure-hide/posts/#{post.id}.json"
    expect(response.status).to eq(403)
    expect(response.body).not_to include("secret")
  end

  it "returns hidden blocks when the viewer liked the post" do
    post = create_post_with_hidden(raw: <<~MD)
          [secure_hide mode=any actions=like,reply]secret[/secure_hide]
        MD

    PostActionCreator.like(viewer, post)

    sign_in(viewer)
    get "/secure-hide/posts/#{post.id}.json"
    expect(response.status).to eq(200)
    expect(response.parsed_body["blocks"].first["html"]).to include("secret")
    expect(
      DiscourseSecureHide::Unlock.find_by(user_id: viewer.id, post_id: post.id)&.unlocked_via,
    ).to eq("like")

    PostAction.where(
      post_id: post.id,
      user_id: viewer.id,
      post_action_type_id: PostActionType.types[:like],
    ).delete_all

    get "/secure-hide/posts/#{post.id}.json"
    expect(response.status).to eq(200)
    expect(response.parsed_body["blocks"].first["html"]).to include("secret")
  end

  it "returns hidden blocks when the viewer replied in the topic" do
    post = create_post_with_hidden(raw: <<~MD)
          [secure_hide mode=any actions=like,reply]secret[/secure_hide]
        MD

    PostCreator.create!(viewer, topic_id: post.topic_id, raw: "a reply", skip_validations: true)

    sign_in(viewer)
    get "/secure-hide/posts/#{post.id}.json"
    expect(response.status).to eq(200)
    expect(response.parsed_body["blocks"].first["html"]).to include("secret")
  end

  it "requires all actions when mode is all" do
    post = create_post_with_hidden(raw: <<~MD)
          [secure_hide mode=all actions=like,reply]secret[/secure_hide]
        MD

    sign_in(viewer)
    get "/secure-hide/posts/#{post.id}.json"
    expect(response.status).to eq(403)

    PostActionCreator.like(viewer, post)
    get "/secure-hide/posts/#{post.id}.json"
    expect(response.status).to eq(403)

    PostCreator.create!(viewer, topic_id: post.topic_id, raw: "a reply", skip_validations: true)
    get "/secure-hide/posts/#{post.id}.json"
    expect(response.status).to eq(200)
    expect(response.parsed_body["blocks"].first["html"]).to include("secret")
  end

  it "always allows the post author" do
    post = create_post_with_hidden(raw: <<~MD)
          [secure_hide mode=all actions=like,reply]secret[/secure_hide]
        MD

    sign_in(author)
    get "/secure-hide/posts/#{post.id}.json"
    expect(response.status).to eq(200)
    expect(response.parsed_body["visible_reason"]).to eq("author")
  end

  it "always allows staff" do
    post = create_post_with_hidden(raw: <<~MD)
          [secure_hide mode=all actions=like,reply]secret[/secure_hide]
        MD

    sign_in(admin)
    get "/secure-hide/posts/#{post.id}.json"
    expect(response.status).to eq(200)
    expect(response.parsed_body["visible_reason"]).to eq("staff")
  end

  it "redacts hidden content from the raw endpoint until unlocked" do
    post = create_post_with_hidden(raw: <<~MD)
          [secure_hide mode=any actions=like,reply]secret[/secure_hide]
        MD

    get "/posts/#{post.id}/raw"
    expect(response.status).to eq(200)
    expect(response.body).not_to include("secret")

    sign_in(viewer)
    get "/posts/#{post.id}/raw"
    expect(response.status).to eq(200)
    expect(response.body).not_to include("secret")

    PostActionCreator.like(viewer, post)
    get "/posts/#{post.id}/raw"
    expect(response.status).to eq(200)
    expect(response.body).to include("secret")
  end
end
