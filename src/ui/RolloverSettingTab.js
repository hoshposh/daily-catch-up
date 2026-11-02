import { Setting, PluginSettingTab } from "obsidian";
import { resolveSourceAction } from "../source-action";
import { extractHeadings, headingOptions } from "../template-headings";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";

export default class RolloverSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
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
        "rollover-daily-todos: failed to read template headings",
        err
      );
      return [];
    }
  }

  async display() {
    const templateHeadings = await this.getTemplateHeadings();

    this.containerEl.empty();

    if (templateHeadings.length > 0) {
      new Setting(this.containerEl)
        .setName("Template heading")
        .setDesc("Which heading from your template should the todos go under")
        .addDropdown((dropdown) =>
          dropdown
            .addOptions(
              headingOptions(
                templateHeadings,
                this.plugin?.settings.templateHeading
              )
            )
            .setValue(this.plugin?.settings.templateHeading)
            .onChange((value) => {
              this.plugin.settings.templateHeading = value;
              this.plugin.saveSettings();
            })
        );
    } else {
      new Setting(this.containerEl)
        .setName("Template heading")
        .setDesc(
          `No headings could be read from your daily note template (it may be missing, unreadable or have no headings). Type the exact heading that today's note will contain, starting with '#' characters, e.g. '## Tasks'. Use 'none' to add todos to the end of the note.`
        )
        .addText((text) =>
          text
            .setPlaceholder("## Tasks")
            .setValue(this.plugin?.settings.templateHeading || "none")
            .onChange((value) => {
              this.plugin.settings.templateHeading = value.trim() || "none";
              this.plugin.saveSettings();
            })
        );
    }

    new Setting(this.containerEl)
      .setName("After rollover, on the previous day's note")
      .setDesc(
        `What to do with the todos that were rolled over, once today's note has a copy of them. "Leave them alone" duplicates them and is the safest. "Mark them" changes their checkbox to the character below (e.g. [>] for "forwarded"); completed items and plain text are not touched. "Delete them" removes them and is destructive. Undo restores either change.`
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            none: "Leave them alone",
            mark: "Mark them",
            delete: "Delete them",
          })
          .setValue(resolveSourceAction(this.plugin.settings))
          .onChange((value) => {
            this.plugin.settings.onRolloverSourceAction = value;
            this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Marker character")
      .setDesc(
        `The checkbox character used by "Mark them". Must be a single character; anything else falls back to ">". While marking is selected, this character also counts as a done marker, so marked todos are not rolled over again.`
      )
      .addText((text) =>
        text
          .setPlaceholder(">")
          .setValue(this.plugin.settings.rolloverSourceMarker || ">")
          .onChange((value) => {
            this.plugin.settings.rolloverSourceMarker = value;
            this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Skip todos already in today's note")
      .setDesc(
        `Don't roll over a todo if today's note already has the same line (ignoring surrounding whitespace), e.g. a recurring task from your daily template. Its nested items are skipped with it. The skipped todos are still marked or deleted on the previous day's note, according to the setting above.`
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.skipExistingTodos || false)
          .onChange((value) => {
            this.plugin.settings.skipExistingTodos = value;
            this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Remove empty todos in rollover")
      .setDesc(
        `If you have empty todos, they will not be rolled over to the next day.`
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.removeEmptyTodos || false)
          .onChange((value) => {
            this.plugin.settings.removeEmptyTodos = value;
            this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Roll over children of todos")
      .setDesc(
        `By default, only the actual todos are rolled over. If you add nested Markdown-elements beneath your todos, these are not rolled over but stay in place, possibly altering the logic of your previous note. This setting allows for also migrating the nested elements.`
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.rolloverChildren || false)
          .onChange((value) => {
            this.plugin.settings.rolloverChildren = value;
            this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Skip completed children")
      .setDesc(
        `Only applies when "Roll over children of todos" is on. Completed nested todos, and everything nested under them, are not rolled over. If the previous day's note is set to "Delete them", they are removed from the previous note together with their parent.`
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.skipCompletedChildren || false)
          .onChange((value) => {
            this.plugin.settings.skipCompletedChildren = value;
            this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Ignore todos in callouts and blockquotes")
      .setDesc(
        `When on, todos inside Markdown blockquotes (lines starting with '>') are not rolled over. Useful for habit lists kept inside callouts like '> [!tip]'.`
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.ignoreBlockquotes || false)
          .onChange((value) => {
            this.plugin.settings.ignoreBlockquotes = value;
            this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Automatic rollover on daily note open")
      .setDesc(
        `If enabled, the plugin will automatically rollover todos when you open a daily note.`
      )
      .addToggle((toggle) =>
        toggle
          // Default to true if the setting is not set
          .setValue(
            this.plugin.settings.rolloverOnFileCreate === undefined ||
              this.plugin.settings.rolloverOnFileCreate === null
              ? true
              : this.plugin.settings.rolloverOnFileCreate
          )
          .onChange((value) => {
            console.log(value);
            this.plugin.settings.rolloverOnFileCreate = value;
            this.plugin.saveSettings();
            this.plugin.loadData().then((value) => console.log(value));
          })
      );

    new Setting(this.containerEl)
      .setName("Done status markers")
      .setDesc(
        `Characters that represent done status in checkboxes. Default is "xX-". Add any characters that should be considered as marking a task complete.`
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.doneStatusMarkers || "xX-")
          .onChange((value) => {
            this.plugin.settings.doneStatusMarkers = value;
            this.plugin.saveSettings();
          })
      );
    new Setting(this.containerEl)
      .setName("Add extra blank line between Heading and Todos")
      .setDesc(`Whether to add a blank line between a heading and the rolled over todos placed directly under it, and before a heading that the rollover adds. Todos added to a list that is already under a heading continue that list, without a blank line.`)
      .addToggle((toggle) => 
        toggle
          .setValue(
            this.plugin.settings
              .leadingNewLine === undefined || 
              this.plugin.settings.leadingNewLine === null 
              ? true 
              : this.plugin.settings.leadingNewLine
          )
          .onChange((value) => {
            this.plugin.settings.leadingNewLine = value;
            this.plugin.saveSettings();
          })
      );
  }
}
