import { Modal, Setting } from "obsidian";
import {
  headingLabel,
  isStale,
  itemLabel,
  summarizeBringBack,
  summarizeDecisions,
} from "../rollover-items";
import { fromNote, stripFromField } from "../rolled-count";
import { ruleLabel } from "../rules";

const OUTCOME_LABELS = {
  roll: "Roll",
  backlog: "Backlog",
  cancel: "Cancel",
  leave: "Leave",
};

// Bring back from backlog: Roll brings a todo back, Leave keeps it in the
// backlog, and Backlog is never offered
const BRING_BACK_LABELS = {
  roll: "Bring back",
  leave: "Stay",
  cancel: "Cancel",
};

// Lets the user pick an outcome for each item before a rollover. Only the UI
// lives here; labels, staleness and the summary come from rollover-items.
export default class ReviewModal extends Modal {
  constructor(
    app,
    {
      sources,
      decisions,
      staleSettings,
      backlogEnabled,
      cancelEnabled,
      // "rollover" or "bringBack" (the backlog's own dialog)
      mode = "rollover",
    }
  ) {
    super(app);
    this.bringBack = mode === "bringBack";
    this.missingOutcome = this.bringBack ? "leave" : "roll";
    this.labels = this.bringBack ? BRING_BACK_LABELS : OUTCOME_LABELS;
    // [{ name, sections, items }]: each item's sectionIndex is within its
    // own source's sections
    this.sources = sources;
    this.items = sources.flatMap((source) => source.items);
    // a copy: the caller's defaults stay as they were if the user cancels
    this.decisions = { ...decisions };
    this.staleSettings = staleSettings;
    this.outcomes = Object.keys(this.labels).filter(
      (outcome) =>
        (outcome !== "backlog" || backlogEnabled) &&
        (outcome !== "cancel" || cancelEnabled)
    );
    this.dropdowns = new Map(); // item id -> DropdownComponent
    // item id -> the "→ heading" badge of an item a rule moves, shown while
    // the item rolls
    this.moveBadges = new Map();
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
      this.updateMoveBadge(item.id);
    }
    this.updateSummary();
  }

  updateMoveBadge(itemId) {
    const badge = this.moveBadges.get(itemId);
    if (badge) {
      badge.toggle((this.decisions[itemId] ?? this.missingOutcome) === "roll");
    }
  }

  updateSummary() {
    if (this.summaryEl) {
      // only the shown items: the map also holds the decisions of items the
      // dialog was not given (an older note's hidden ones)
      const shown = Object.fromEntries(
        this.items.map((item) => [item.id, this.decisions[item.id]])
      );
      this.summaryEl.setText(
        this.bringBack ? summarizeBringBack(shown) : summarizeDecisions(shown)
      );
    }
  }

  addShortcuts(setting, items) {
    setting
      .addButton((button) =>
        button
          .setButtonText(this.bringBack ? "All back" : "All roll")
          .onClick(() => this.setOutcome(items, "roll"))
      )
      .addButton((button) =>
        button
          .setButtonText(this.bringBack ? "All stay" : "All leave")
          .onClick(() => this.setOutcome(items, "leave"))
      );
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    // a source whose todos were all dropped (empty todos) has nothing to show
    const sources = this.sources.filter((source) => source.items.length > 0);
    const several = sources.length > 1;
    const names = sources.map((source) => source.name).join(", ");
    titleEl.setText(
      this.bringBack
        ? `Bring back from ${names}`
        : several
        ? "Roll over todos"
        : `Roll over from ${names}`
    );
    contentEl.addClass("rollover-review");

    this.addShortcuts(new Setting(contentEl).setName("All todos"), this.items);

    // one source after the other, each with its sections in note order;
    // with several, each starts with a row of its own
    for (const source of sources) {
      if (several) {
        const row = new Setting(contentEl)
          .setName(`From ${source.name}`)
          .setHeading();
        row.settingEl.addClass("rollover-review-source");
        this.addShortcuts(row, source.items);
      }
      this.renderSource(contentEl, source);
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

  // a source's sections in note order, each with its own items
  renderSource(contentEl, { sections, items }) {
    const sectionIndices = [...new Set(items.map((item) => item.sectionIndex))];
    for (const sectionIndex of sectionIndices) {
      const sectionItems = items.filter(
        (item) => item.sectionIndex === sectionIndex
      );
      const heading = new Setting(contentEl)
        .setName(headingLabel(sections[sectionIndex].headingPath))
        .setHeading();
      this.addShortcuts(heading, sectionItems);

      for (const item of sectionItems) {
        const head = item.lines[0];
        const row = new Setting(contentEl).setName(
          this.bringBack
            ? itemLabel({
                ...item,
                lines: [stripFromField(head), ...item.lines.slice(1)],
              })
            : itemLabel(item)
        );
        // where a backlog todo was parked from
        const from = this.bringBack ? fromNote(head) : null;
        if (from !== null) {
          row.nameEl.createSpan({
            cls: "rollover-from-badge",
            text: `from ${from}`,
          });
        }
        if (!this.bringBack && isStale(item, this.staleSettings)) {
          row.nameEl.createSpan({
            cls: "rollover-stale-badge",
            text: `rolled ${item.count}×`,
          });
        }
        // the rule that chose the default stays named after an override
        if (item.rule?.outcomeRule) {
          row.nameEl.createSpan({
            cls: "rollover-rule-badge",
            text: ruleLabel(item.rule.outcomeRule),
          });
        }
        if (item.rule?.moveTo) {
          this.moveBadges.set(
            item.id,
            row.nameEl.createSpan({
              cls: "rollover-rule-badge",
              text: `→ ${item.rule.moveTo}`,
            })
          );
          this.updateMoveBadge(item.id);
        }
        row.addDropdown((dropdown) => {
          for (const outcome of this.outcomes) {
            dropdown.addOption(outcome, this.labels[outcome]);
          }
          dropdown
            // as applySources() reads a missing decision: a backlog item
            // stays
            .setValue(this.decisions[item.id] ?? this.missingOutcome)
            .onChange((value) => {
              this.decisions[item.id] = value;
              this.updateMoveBadge(item.id);
              this.updateSummary();
            });
          this.dropdowns.set(item.id, dropdown);
        });
      }
    }
  }

  onClose() {
    this.contentEl.empty();
    this.dropdowns.clear();
    this.moveBadges.clear();
    this.summaryEl = null;
    this.finish(null);
  }
}
