import { Modal, Setting } from "obsidian";
import {
  headingLabel,
  isStale,
  itemLabel,
  summarizeDecisions,
} from "../rollover-items";

const OUTCOME_LABELS = {
  roll: "Roll",
  backlog: "Backlog",
  cancel: "Cancel",
  leave: "Leave",
};

// Lets the user pick an outcome for each item before a rollover. Only the UI
// lives here; labels, staleness and the summary come from rollover-items.
export default class ReviewModal extends Modal {
  constructor(
    app,
    {
      sourceName,
      sections,
      items,
      decisions,
      staleSettings,
      backlogEnabled,
      cancelEnabled,
    }
  ) {
    super(app);
    this.sourceName = sourceName;
    this.sections = sections;
    this.items = items;
    // a copy: the caller's defaults stay as they were if the user cancels
    this.decisions = { ...decisions };
    this.staleSettings = staleSettings;
    this.outcomes = Object.keys(OUTCOME_LABELS).filter(
      (outcome) =>
        (outcome !== "backlog" || backlogEnabled) &&
        (outcome !== "cancel" || cancelEnabled)
    );
    this.dropdowns = new Map(); // item id -> DropdownComponent
    this.resolve = null;
    this.settled = false;
  }

  /**
   * Opens the dialog. Resolves with the decisions on Apply, or with null when
   * it is closed any other way (Cancel, Escape, clicking outside).
   *
   * @returns {Promise<Record<string, string> | null>}
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

  setOutcome(items, outcome) {
    for (const item of items) {
      this.decisions[item.id] = outcome;
      const dropdown = this.dropdowns.get(item.id);
      if (dropdown) dropdown.setValue(outcome);
    }
    this.updateSummary();
  }

  updateSummary() {
    if (this.summaryEl) {
      this.summaryEl.setText(summarizeDecisions(this.decisions));
    }
  }

  addShortcuts(setting, items) {
    setting
      .addButton((button) =>
        button
          .setButtonText("All roll")
          .onClick(() => this.setOutcome(items, "roll"))
      )
      .addButton((button) =>
        button
          .setButtonText("All leave")
          .onClick(() => this.setOutcome(items, "leave"))
      );
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText(`Roll over from ${this.sourceName}`);
    contentEl.addClass("rollover-review");

    this.addShortcuts(new Setting(contentEl).setName("All todos"), this.items);

    // sections in note order, each with its own items
    const sectionIndices = [
      ...new Set(this.items.map((item) => item.sectionIndex)),
    ];
    for (const sectionIndex of sectionIndices) {
      const sectionItems = this.items.filter(
        (item) => item.sectionIndex === sectionIndex
      );
      const heading = new Setting(contentEl)
        .setName(headingLabel(this.sections[sectionIndex].headingPath))
        .setHeading();
      this.addShortcuts(heading, sectionItems);

      for (const item of sectionItems) {
        const row = new Setting(contentEl).setName(itemLabel(item));
        if (isStale(item, this.staleSettings)) {
          row.nameEl.createSpan({
            cls: "rollover-stale-badge",
            text: `rolled ${item.count}×`,
          });
        }
        row.addDropdown((dropdown) => {
          for (const outcome of this.outcomes) {
            dropdown.addOption(outcome, OUTCOME_LABELS[outcome]);
          }
          dropdown
            .setValue(this.decisions[item.id] ?? "roll")
            .onChange((value) => {
              this.decisions[item.id] = value;
              this.updateSummary();
            });
          this.dropdowns.set(item.id, dropdown);
        });
      }
    }

    this.summaryEl = contentEl.createDiv({ cls: "rollover-review-summary" });
    this.updateSummary();

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("Apply")
          .setCta()
          .onClick(() => {
            this.finish({ ...this.decisions });
            this.close();
          })
      )
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close())
      );
  }

  onClose() {
    this.contentEl.empty();
    this.dropdowns.clear();
    this.summaryEl = null;
    this.finish(null);
  }
}
