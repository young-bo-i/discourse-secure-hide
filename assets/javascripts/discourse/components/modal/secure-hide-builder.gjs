import Component from "@glimmer/component";
import { hash } from "@ember/helper";
import { action } from "@ember/object";
import DModal from "discourse/components/d-modal";
import Form from "discourse/components/form";
import { i18n } from "discourse-i18n";

export default class SecureHideBuilderModal extends Component {
  @action
  validate(data, { addError, removeError }) {
    removeError("secure_hide_actions");

    if (!data.like && !data.reply) {
      addError("secure_hide_actions", {
        title: i18n("secure_hide.composer.errors.actions_required_title"),
        message: i18n("secure_hide.composer.errors.actions_required"),
      });
    }
  }

  @action
  onSubmit(data) {
    const actions = [];
    if (data.like) {
      actions.push("like");
    }
    if (data.reply) {
      actions.push("reply");
    }

    const mode = data.mode === "all" ? "all" : "any";
    const toolbarEvent = this.args.model.toolbarEvent;

    if (toolbarEvent?.commands?.toggleSecureHide) {
      toolbarEvent.commands.toggleSecureHide({ mode, actions });
    } else {
      const prefix = `[secure_hide mode=${mode} actions=${actions.join(",")}]\n`;
      const suffix = `\n[/secure_hide]`;

      toolbarEvent.applySurround(prefix, suffix, "secure_hide_text", {
        multiline: false,
        useBlockMode: true,
      });
    }

    this.args.closeModal?.();
  }

  <template>
    <DModal
      @closeModal={{@closeModal}}
      @title={{i18n "secure_hide.composer.title"}}
      class="secure-hide-builder-modal"
    >
      <Form
        @data={{hash mode="any" like=false reply=true}}
        @onSubmit={{this.onSubmit}}
        @validate={{this.validate}}
        as |form|
      >
        <form.Field
          @name="mode"
          @title={{i18n "secure_hide.composer.mode.title"}}
          @format="full"
          @validation="required"
          as |field|
        >
          <field.RadioGroup as |radioGroup|>
            <radioGroup.Radio @value="any">
              {{i18n "secure_hide.composer.mode.any"}}
            </radioGroup.Radio>
            <radioGroup.Radio @value="all">
              {{i18n "secure_hide.composer.mode.all"}}
            </radioGroup.Radio>
          </field.RadioGroup>
        </form.Field>

        <form.CheckboxGroup
          @title={{i18n "secure_hide.composer.actions.title"}}
          as |checkboxGroup|
        >
          <checkboxGroup.Field
            @name="like"
            @title={{i18n "secure_hide.requirements.action.like"}}
            as |field|
          >
            <field.Checkbox />
          </checkboxGroup.Field>

          <checkboxGroup.Field
            @name="reply"
            @title={{i18n "secure_hide.requirements.action.reply"}}
            as |field|
          >
            <field.Checkbox />
          </checkboxGroup.Field>
        </form.CheckboxGroup>

        <form.Actions>
          <form.Submit
            @label="secure_hide.composer.insert"
            class="btn-primary"
          />
        </form.Actions>
      </Form>
    </DModal>
  </template>
}
