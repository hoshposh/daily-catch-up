import { Modal, Setting } from "obsidian";
import {
  EFFECT_LABELS,
  EFFECTS,
  MATCH_LABELS,
  MATCH_TYPES,
  ruleDraft,
  ruleProblem,
} from "../rules";

const VALUE_PLACEHOLDERS = {
  tag: "#someday",
  heading: "Meetings",
  regex: "^idea:",
};

// Edits one rule. Only the UI lives here; validation comes from rules.js.
export default class RuleModal extends Modal {
  constructor(app, { rule, title = "Edit rule" }) {
    super(app);
    // a copy: the caller's rule stays as it was if the user cancels. A
    // hand-edited rule is coerced, so the fields show what Save stores.
    this.draft = ruleDraft(rule);
    this.title = title;
    this.resolve = null;
    this.settled = false;
  }

  /**
   * Opens the dialog. Resolves with the edited rule on Save, or with null when
   * it is closed any other way.
   *
   * @returns {Promise<object | null>}
   */
  openAndWait() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  finish(result) {
    if (this.settled) return;
    this.settled = true;
    if (this.resolve) this.resolve(result);
  }

  // Shows the rule's problem, if any, and only allows Save without one
  validate() {
    const problem = ruleProblem(this.draft);
    this.problemEl.setText(problem);
    this.problemEl.toggle(problem !== "");
    this.saveButton.setDisabled(problem !== "");
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.title);
    contentEl.addClass("rollover-rule-modal");

    let valueText;
    new Setting(contentEl).setName("Match").addDropdown((dropdown) =>
      dropdown
        .addOptions(
          Object.fromEntries(MATCH_TYPES.map((m) => [m, MATCH_LABELS[m]]))
        )
        .setValue(this.draft.match)
        .onChange((value) => {
          this.draft.match = value;
          valueText.setPlaceholder(VALUE_PLACEHOLDERS[value]);
          this.validate();
        })
    );

    new Setting(contentEl)
      .setName("Value")
      .setDesc("The tag, heading text or pattern to match.")
      .addText((text) => {
        valueText = text;
        text
          .setPlaceholder(VALUE_PLACEHOLDERS[this.draft.match] ?? "")
          .setValue(this.draft.value)
          .onChange((value) => {
            this.draft.value = value;
            this.validate();
          });
      });

    let targetSetting;
    const showTarget = () =>
      targetSetting.settingEl.toggle(this.draft.effect === "move");

    new Setting(contentEl).setName("Effect").addDropdown((dropdown) =>
      dropdown
        .addOptions(
          Object.fromEntries(EFFECTS.map((e) => [e, EFFECT_LABELS[e]]))
        )
        .setValue(this.draft.effect)
        .onChange((value) => {
          this.draft.effect = value;
          showTarget();
          this.validate();
        })
    );
    targetSetting = new Setting(contentEl)
      .setName("Target heading")
      .setDesc("Heading in today's note, e.g. '## Inbox'.")
      .addText((text) =>
        text
          .setPlaceholder("## Inbox")
          .setValue(this.draft.target ?? "")
          .onChange((value) => {
            this.draft.target = value;
            this.validate();
          })
      );

    showTarget();

    this.problemEl = contentEl.createDiv({ cls: "rollover-rule-problem" });

    new Setting(contentEl)
      .addButton((button) => {
        this.saveButton = button;
        button
          .setButtonText("Save")
          .setCta()
          .onClick(() => {
            if (ruleProblem(this.draft) !== "") return;
            this.finish({ ...this.draft });
            this.close();
          });
      })
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close())
      );

    this.validate();
  }

  onClose() {
    this.contentEl.empty();
    this.finish(null);
  }
}
