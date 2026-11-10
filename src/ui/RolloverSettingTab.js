import { Setting, PluginSettingTab } from "obsidian";
import { resolveSourceAction } from "../source-action";
import { extractHeadings, headingOptions } from "../template-headings";
import {
  DEPENDENT_SETTINGS,
  cancelMarkerNote,
  dependentSettingStates,
} from "../settings-dependencies";
import {
  SETTING_DESCRIPTIONS,
  SETTING_GROUPS,
  SETTING_LABELS,
  helpSegments,
} from "../settings-text";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";

const GROUP = Object.fromEntries(SETTING_GROUPS.map((g) => [g.id, g]));

export default class RolloverSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    // key -> { setting, component } for each of DEPENDENT_SETTINGS
    this.dependents = {};
    this.cancelMarkerSetting = null;
  }

  // Never throws: a broken template path or an unreadable daily-notes config
  // must not leave the whole settings page blank. Returns [] instead, and the
  // heading setting falls back to a text field.
  async getTemplateHeadings() {
    try {
      // the library returns undefined when it cannot read the configuration
      const { template } = getDailyNoteSettings() ?? {};
      if (!template) return [];

      let file = this.app.vault.getAbstractFileByPath(template);

      if (file === null) {
        file = this.app.vault.getAbstractFileByPath(template + ".md");
      }

      if (file === null) {
        // file not available, no template-heading can be returned
        return [];
      }

      return extractHeadings(await this.app.vault.read(file));
    } catch (err) {
      console.warn(
        "Daily Catch-Up: failed to read template headings",
        err
      );
      return [];
    }
  }

  // Saves, then updates the dependent rows in place, so the page never
  // re-renders or jumps when a parent setting changes
  save() {
    this.plugin.saveSettings();
    this.refreshDependents();
  }

  // A group heading with a `?` button that toggles its help panel, which sits
  // directly under the heading and pushes the settings down. Starts closed.
  addGroup(group) {
    const el = this.containerEl;
    const heading = new Setting(el).setName(group.title).setHeading();

    const button = heading.controlEl.createEl("button", {
      text: "?",
      cls: ["clickable-icon", "rollover-help-button"],
      attr: {
        type: "button",
        "aria-label": `Help: ${group.title}`,
        "aria-expanded": "false",
      },
    });

    const panel = el.createDiv({
      cls: "rollover-settings-help",
      attr: { hidden: "" },
    });
    for (const paragraph of group.help) {
      const p = panel.createEl("p");
      for (const { text, bold } of helpSegments(paragraph)) {
        if (bold) p.createEl("strong", { text });
        else p.appendText(text);
      }
    }

    button.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      button.setAttr("aria-expanded", String(open));
      button.toggleClass("is-active", open);
    });
  }

  // A setting row with its label and short description. Dependent settings
  // are indented under their parent.
  addSetting(key, descKey = key) {
    const setting = new Setting(this.containerEl)
      .setName(SETTING_LABELS[key])
      .setDesc(SETTING_DESCRIPTIONS[descKey]);
    if (DEPENDENT_SETTINGS.includes(key)) {
      setting.settingEl.addClass("rollover-setting-dependent");
    }
    return setting;
  }

  track(key, setting, component) {
    if (DEPENDENT_SETTINGS.includes(key)) {
      this.dependents[key] = { setting, component };
    }
    return component;
  }

  addToggle(key, getValue) {
    const setting = this.addSetting(key);
    setting.addToggle((toggle) =>
      this.track(key, setting, toggle)
        .setValue(getValue())
        .onChange((value) => {
          this.plugin.settings[key] = value;
          this.save();
        })
    );
    return setting;
  }

  addDropdown(key, options, value) {
    const setting = this.addSetting(key);
    setting.addDropdown((dropdown) =>
      this.track(key, setting, dropdown)
        .addOptions(options)
        .setValue(value)
        .onChange((v) => {
          this.plugin.settings[key] = v;
          this.save();
        })
    );
    return setting;
  }

  // `parse` turns the typed text into the stored value, or undefined to
  // ignore it (the value is then not saved)
  addText(key, { placeholder, value, parse = (v) => v }) {
    const setting = this.addSetting(key);
    setting.addText((text) => {
      this.track(key, setting, text);
      if (placeholder !== undefined) text.setPlaceholder(placeholder);
      return text.setValue(value).onChange((v) => {
        const parsed = parse(v);
        if (parsed === undefined) return;
        this.plugin.settings[key] = parsed;
        this.save();
      });
    });
    return setting;
  }

  async display() {
    const templateHeadings = await this.getTemplateHeadings();
    const settings = this.plugin.settings;

    this.containerEl.empty();
    this.dependents = {};

    // When it runs
    this.addGroup(GROUP.when);
    this.addToggle(
      "rolloverOnFileCreate",
      // Default to true if the setting is not set
      () =>
        settings.rolloverOnFileCreate === undefined ||
        settings.rolloverOnFileCreate === null
          ? true
          : settings.rolloverOnFileCreate
    );
    this.addDropdown(
      "reviewOnAutoRollover",
      {
        off: "Never",
        stale: "Only when a todo is stale",
        always: "Always",
      },
      settings.reviewOnAutoRollover || "off"
    );

    // Which todos roll over
    this.addGroup(GROUP.which);
    this.addText("doneStatusMarkers", {
      value: settings.doneStatusMarkers || "xX-",
    });
    this.addToggle(
      "rolloverChildren",
      () => settings.rolloverChildren || false
    );
    this.addToggle(
      "skipCompletedChildren",
      () => settings.skipCompletedChildren || false
    );
    this.addToggle(
      "removeEmptyTodos",
      () => settings.removeEmptyTodos || false
    );
    this.addToggle(
      "ignoreBlockquotes",
      () => settings.ignoreBlockquotes || false
    );
    this.addToggle(
      "skipExistingTodos",
      () => settings.skipExistingTodos || false
    );

    // Where they go in today's note
    this.addGroup(GROUP.where);
    if (templateHeadings.length > 0) {
      this.addDropdown(
        "templateHeading",
        headingOptions(templateHeadings, settings.templateHeading),
        settings.templateHeading
      );
    } else {
      this.addText("templateHeading", {
        placeholder: "## Tasks",
        value: settings.templateHeading || "none",
        parse: (v) => v.trim() || "none",
      }).setDesc(SETTING_DESCRIPTIONS.templateHeadingText);
    }
    this.addToggle("leadingNewLine", () =>
      settings.leadingNewLine === undefined || settings.leadingNewLine === null
        ? true
        : settings.leadingNewLine
    );

    // What happens to the previous day's note
    this.addGroup(GROUP.previous);
    this.addDropdown(
      "onRolloverSourceAction",
      {
        none: "Leave them alone",
        mark: "Mark them",
        delete: "Delete them",
      },
      resolveSourceAction(settings)
    );
    this.addText("rolloverSourceMarker", {
      placeholder: ">",
      value: settings.rolloverSourceMarker || ">",
    });
    this.addToggle(
      "moveNestedItemsOnMark",
      () => settings.moveNestedItemsOnMark || false
    );

    // Review and backlog
    this.addGroup(GROUP.review);
    this.cancelMarkerSetting = this.addText("cancelMarker", {
      placeholder: "-",
      value: settings.cancelMarker ?? "-",
    });
    this.addText("backlogNotePath", {
      placeholder: "Backlog.md",
      value: settings.backlogNotePath || "",
      parse: (v) => v.trim(),
    });
    this.addText("backlogHeading", {
      placeholder: "## Someday",
      value: settings.backlogHeading || "",
      parse: (v) => v.trim(),
    });

    // Aging
    this.addGroup(GROUP.aging);
    this.addToggle(
      "trackRolloverCount",
      () => settings.trackRolloverCount || false
    );
    this.addText("staleAfterRollovers", {
      placeholder: "5",
      value: String(settings.staleAfterRollovers ?? 5),
      parse: (v) => {
        const n = parseInt(v, 10);
        return Number.isNaN(n) || n < 0 ? undefined : n;
      },
    });
    this.addDropdown(
      "staleBehavior",
      {
        keep: "Keep rolling it",
        backlog: "Move it to the backlog",
      },
      settings.staleBehavior || "keep"
    );

    this.refreshDependents();
  }

  // Greys out the dependent settings that don't apply, with the reason in
  // place of their description. Their values are kept.
  refreshDependents() {
    const settings = this.plugin.settings;
    const states = dependentSettingStates(settings);

    for (const key of DEPENDENT_SETTINGS) {
      const entry = this.dependents[key];
      if (!entry) continue;
      const { enabled, reason } = states[key];
      entry.setting.setDisabled(!enabled);
      entry.component.setDisabled(!enabled);
      entry.setting.setDesc(enabled ? SETTING_DESCRIPTIONS[key] : reason);
    }

    if (this.cancelMarkerSetting) {
      const note = cancelMarkerNote(settings);
      this.cancelMarkerSetting.setDesc(
        SETTING_DESCRIPTIONS.cancelMarker + (note ? " " + note : "")
      );
    }
  }
}
