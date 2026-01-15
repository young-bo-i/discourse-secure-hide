# frozen_string_literal: true

class CreateSecureHideUnlocks < ActiveRecord::Migration[8.0]
  def change
    create_table :secure_hide_unlocks do |t|
      t.bigint :user_id, null: false
      t.bigint :post_id, null: false
      t.datetime :unlocked_at, null: false
      t.string :unlocked_via, null: false

      t.index %i[user_id post_id], unique: true
      t.index :post_id

      t.timestamps
    end
  end
end
