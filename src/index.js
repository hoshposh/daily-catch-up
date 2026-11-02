import { Notice, Plugin } from "obsidian";
import {
  getDailyNoteSettings,
  getAllDailyNotes,
  getDailyNote,
} from "obsidian-daily-notes-interface";
import UndoModal from "./ui/UndoModal";
import RolloverSettingTab from "./ui/RolloverSettingTab";
import { getSections, splitLines } from "./get-todos";
import { insertSections } from "./insert-sections";
import {
  dedupeAgainstExisting,
  dropEmptyTodos,
  verifyTodosPresent,
} from "./insert-todos";
import {
  applySourceAction,
  effectiveDoneStatusMarkers,
  migrateSourceActionSettings,
  normalizeMarker,
  resolveSourceAction,
} from "./source-action";

const MAX_TIME_SINCE_CREATION = 5000; // 5 seconds

// Templater reads a new note after ~300ms and writes the rendered result back,
// which can overwrite what we just inserted. Slow templates take longer, so
// this is how long we wait before trusting that the insertion survived.
const TEMPLATER_SETTLE_MS = 3000;

export default class RolloverTodosPlugin extends Plugin {
  async loadSettings() {
    const DEFAULT_SETTINGS = {
      templateHeading: "none",
      // what to do with rolled todos on the previous day's note:
      // "none" | "delete" | "mark" (replaces the old deleteOnComplete toggle)
      onRolloverSourceAction: "none",
      rolloverSourceMarker: ">",
      removeEmptyTodos: false,
      rolloverChildren: false,
      rolloverOnFileCreate: true,
      doneStatusMarkers: "xX-",
      leadingNewLine: true,
      skipExistingTodos: false,
      ignoreBlockquotes: false,
      skipCompletedChildren: false,
    };
    const stored = (await this.loadData()) || {};
    this.settings = migrateSourceActionSettings(
      Object.assign({}, DEFAULT_SETTINGS, stored),
      stored
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  isDailyNotesEnabled() {
    const dailyNotesPlugin = this.app.internalPlugins.plugins["daily-notes"];
    const dailyNotesEnabled = dailyNotesPlugin && dailyNotesPlugin.enabled;

    const periodicNotesPlugin = this.app.plugins.getPlugin("periodic-notes");
    const periodicNotesEnabled =
      periodicNotesPlugin && periodicNotesPlugin.settings?.daily?.enabled;

    return dailyNotesEnabled || periodicNotesEnabled;
  }

  getLastDailyNote() {
    const { moment } = window;
    const dailyNoteSettings = getDailyNoteSettings();
    if (!dailyNoteSettings) return null;
    let { folder, format } = dailyNoteSettings;

    folder = this.getCleanFolder(folder);
    folder = folder.length === 0 ? folder : folder + "/";

    const dailyNoteRegexMatch = new RegExp("^" + folder + "(.*).md$");
    const todayMoment = moment();

    // get all notes in directory that aren't null
    const dailyNoteFiles = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(folder))
      .filter((file) =>
        moment(
          file.path.replace(dailyNoteRegexMatch, "$1"),
          format,
          true
        ).isValid()
      )
      .filter((file) => file.basename)
      .filter((file) =>
        this.getFileMoment(file, folder, format).isSameOrBefore(
          todayMoment,
          "day"
        )
      );

    // sort by date
    const sorted = dailyNoteFiles.sort(
      (a, b) =>
        this.getFileMoment(b, folder, format).valueOf() -
        this.getFileMoment(a, folder, format).valueOf()
    );
    return sorted[1];
  }

  getFileMoment(file, folder, format) {
    let path = file.path;

    if (path.startsWith(folder)) {
      // Remove length of folder from start of path
      path = path.substring(folder.length);
    }

    if (path.endsWith(`.${file.extension}`)) {
      // Remove length of file extension from end of path
      path = path.substring(0, path.length - file.extension.length - 1);
    }

    return moment(path, format);
  }

  isTemplaterEnabled() {
    return !!this.app.plugins?.getPlugin("templater-obsidian");
  }

  async waitForSettle(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getCleanFolder(folder) {
    // Check if user defined folder with root `/` e.g. `/dailies`
    if (folder.startsWith("/")) {
      folder = folder.substring(1);
    }

    // Check if user defined folder with trailing `/` e.g. `dailies/`
    if (folder.endsWith("/")) {
      folder = folder.substring(0, folder.length - 1);
    }

    return folder;
  }

  async rollover(file = undefined) {
    /*** First we check if the file created is actually a valid daily note ***/
    // the library returns undefined when it cannot read the configuration
    const dailyNoteSettings = getDailyNoteSettings();
    if (!dailyNoteSettings) {
      // Automatic runs fire for every created file, so only warn in the console;
      // tell the user when they ran the command themselves.
      console.warn(
        "rollover-daily-todos: could not read the daily notes settings"
      );
      if (file == undefined) {
        new Notice(
          "Rollover couldn't read your daily note settings. Check that Daily Notes (or Periodic Notes) is enabled and configured.",
          10000
        );
      }
      return;
    }
    let { folder, format } = dailyNoteSettings;
    let ignoreCreationTime = false;

    // Rollover can be called, but we need to get the daily file
    if (file == undefined) {
      const allDailyNotes = getAllDailyNotes();
      file = getDailyNote(window.moment(), allDailyNotes);
      ignoreCreationTime = true;
    }
    if (!file) return;

    folder = this.getCleanFolder(folder);

    // is a daily note
    if (!file.path.startsWith(folder)) return;

    // is today's daily note
    const today = new Date();
    const todayFormatted = window.moment(today).format(format);
    const filePathConstructed = `${folder}${
      folder == "" ? "" : "/"
    }${todayFormatted}.${file.extension}`;
    if (filePathConstructed !== file.path) return;

    // was just created
    if (
      today.getTime() - file.stat.ctime > MAX_TIME_SINCE_CREATION &&
      !ignoreCreationTime
    )
      return;

    /*** Next, if it is a valid daily note, but we don't have daily notes enabled, we must alert the user ***/
    if (!this.isDailyNotesEnabled()) {
      new Notice(
        "RolloverTodosPlugin unable to rollover unfinished todos: Please enable Daily Notes, or Periodic Notes (with daily notes enabled).",
        10000
      );
    } else {
      const { templateHeading, removeEmptyTodos, leadingNewLine, skipExistingTodos } =
        this.settings;
      const sourceAction = resolveSourceAction(this.settings);

      // check if there is a daily note from yesterday
      const lastDailyNote = this.getLastDailyNote();
      if (!lastDailyNote) return;

      // get unfinished todos from yesterday grouped by their parent heading
      const lastDailyNoteContent = await this.app.vault.read(lastDailyNote);
      const lastDailyNoteLines = splitLines(lastDailyNoteContent);

      const sections_yesterday = getSections({
        lines: lastDailyNoteLines,
        withChildren: this.settings.rolloverChildren,
        doneStatusMarkers: effectiveDoneStatusMarkers(this.settings),
        ignoreBlockquotes: this.settings.ignoreBlockquotes,
        skipCompletedChildren: this.settings.skipCompletedChildren,
      });

      const todos_yesterday = sections_yesterday.flatMap((s) => s.incompleteTodos);
      // positions of every todo line found, including empty ones that may not
      // be rolled over
      const foundLineIndices = sections_yesterday.flatMap(
        (s) => s.incompleteLineIndices
      );
      // Completed children left behind by skipCompletedChildren; removed with
      // their rolled parent when deleting, so they are not orphaned
      const skippedLineIndices = new Set(
        sections_yesterday.flatMap((s) => s.skippedLineIndices ?? [])
      );

      console.log(
        `rollover-daily-todos: ${todos_yesterday.length} todos found in ${lastDailyNote.basename}.md`
      );

      if (todos_yesterday.length == 0) {
        return;
      }

      // setup undo history
      let undoHistoryInstance = {
        previousDay: {
          file: undefined,
          oldContent: "",
        },
        today: {
          file: undefined,
          oldContent: "",
        },
      };

      // Potentially filter empty todos from sections
      let todosAdded = 0;
      let emptiesToNotAddToTomorrow = 0;

      let sections_today = sections_yesterday;
      if (removeEmptyTodos) {
        const result = dropEmptyTodos(sections_yesterday);
        sections_today = result.sections;
        emptiesToNotAddToTomorrow = result.removed;
        todosAdded = result.kept;
      } else {
        todosAdded = todos_yesterday.length;
      }

      // get today's content and modify it
      let templateHeadingNotFoundMessage = "";

      let todosAlreadyPresent = 0;
      const duplicateTodos = [];
      let insertedTodos = [];

      if (sections_today.length > 0) {
        let dailyNoteContent = await this.app.vault.read(file);
        const originalDailyNoteContent = dailyNoteContent;

        // Optionally leave out todos that today's note already has (compared
        // against the note as it was before any insertion). They still count
        // as handled for the previous day's note below.
        let sections_to_insert = sections_today;
        if (skipExistingTodos) {
          sections_to_insert = sections_today
            .map((section) => {
              const { todos, skipped, duplicates } = dedupeAgainstExisting(
                section.incompleteTodos,
                originalDailyNoteContent,
                this.settings.rolloverChildren,
                effectiveDoneStatusMarkers(this.settings)
              );
              todosAlreadyPresent += skipped;
              duplicateTodos.push(...duplicates);
              // the line positions no longer match the filtered todos
              const { incompleteLineIndices, ...rest } = section;
              return { ...rest, incompleteTodos: todos };
            })
            .filter((section) => section.incompleteTodos.length > 0);
          todosAdded -= todosAlreadyPresent;
        }
        if (sections_to_insert.length > 0) {
          const inserted = insertSections({
            content: dailyNoteContent,
            sections: sections_to_insert,
            templateHeading,
            leadingNewLine,
          });
          dailyNoteContent = inserted.content;
          if (inserted.templateHeadingNotFound) {
            templateHeadingNotFoundMessage = `Rollover couldn't find '${templateHeading}' in today's daily note. Rolling todos to end of file.`;
          }

          await this.app.vault.modify(file, dailyNoteContent);

          insertedTodos = sections_to_insert.flatMap(
            (section) => section.incompleteTodos
          );

          // With Templater, the note we read was still the unrendered template,
          // so undoing today's note would replace Templater's output with it.
          // Only the previous day's note is undoable in that case.
          if (!this.isTemplaterEnabled()) {
            undoHistoryInstance.today = {
              file: file,
              oldContent: originalDailyNoteContent,
            };
          }
        }

        // Before touching the previous day's note, make sure another plugin
        // did not overwrite what we just inserted. If it did, the todos would
        // otherwise be lost from both notes. Todos skipped because today's note
        // already had them must still be there too.
        if (
          sourceAction !== "none" &&
          this.isTemplaterEnabled() &&
          (insertedTodos.length > 0 || duplicateTodos.length > 0)
        ) {
          await this.waitForSettle(TEMPLATER_SETTLE_MS);
          const settledContent = await this.app.vault.read(file);
          if (
            !verifyTodosPresent(
              settledContent,
              insertedTodos,
              originalDailyNoteContent,
              duplicateTodos
            )
          ) {
            // No undo is recorded: it would restore today's note to its
            // state before Templater rendered it. An earlier rollover must not
            // stay undoable as if it were the latest one.
            this.undoHistory = [];
            new Notice(
              "Rollover left the previous day's note unchanged: today's note was modified by another plugin (likely Templater) after the todos were added, and they may be missing. Run 'Rollover Todos Now' to try again.",
              15000
            );
            return;
          }
        }
      }

      // apply the configured action ("delete" | "mark") to yesterday's note
      if (sourceAction !== "none") {
        // Read, check and write in one atomic step: the line positions refer
        // to the content we parsed, and the note may have been edited since
        // (by the user, a sync client or another plugin, e.g. during the
        // Templater wait). Only change it when it is still exactly that.
        let editedMeanwhile = false;
        let changed = false;
        await this.app.vault.process(lastDailyNote, (currentContent) => {
          if (currentContent !== lastDailyNoteContent) {
            editedMeanwhile = true;
            return currentContent;
          }
          const result = applySourceAction({
            content: currentContent,
            action: sourceAction,
            rolledLineIndices: sections_today.flatMap(
              (s) => s.incompleteLineIndices
            ),
            // delete also removes empty todos that were not rolled over
            deletedLineIndices: foundLineIndices,
            skippedLineIndices: [...skippedLineIndices],
            marker: normalizeMarker(this.settings.rolloverSourceMarker),
            doneStatusMarkers: this.settings.doneStatusMarkers,
            ignoreBlockquotes: this.settings.ignoreBlockquotes,
          });
          changed = result.changed;
          return result.content;
        });
        if (editedMeanwhile) {
          new Notice(
            "Rollover left the previous day's note unchanged: it was edited while the rollover was running.",
            10000
          );
        } else if (changed) {
          undoHistoryInstance.previousDay = {
            file: lastDailyNote,
            oldContent: `${lastDailyNoteContent}`,
          };
        }
      }

      // Let user know rollover has been successful with X todos
      const todosAddedString =
        todosAdded == 0
          ? ""
          : `- ${todosAdded} todo${todosAdded > 1 ? "s" : ""} rolled over.`;
      const emptiesToNotAddToTomorrowString =
        emptiesToNotAddToTomorrow == 0
          ? ""
          : sourceAction === "delete"
          ? `- ${emptiesToNotAddToTomorrow} empty todo${
              emptiesToNotAddToTomorrow > 1 ? "s" : ""
            } removed.`
          : "";
      const alreadyPresentString =
        todosAlreadyPresent == 0
          ? ""
          : `- ${todosAlreadyPresent} line${
              todosAlreadyPresent > 1 ? "s" : ""
            } skipped (already in today's note).`;
      const part1 =
        templateHeadingNotFoundMessage.length > 0
          ? `${templateHeadingNotFoundMessage}`
          : "";
      const part2 = `${todosAddedString}${
        todosAddedString.length > 0 ? " " : ""
      }`;
      const part3 = `${emptiesToNotAddToTomorrowString}${
        emptiesToNotAddToTomorrowString.length > 0 ? " " : ""
      }`;

      const part4 = alreadyPresentString;

      let allParts = [part1, part2, part3, part4];
      let nonBlankLines = [];
      allParts.forEach((part) => {
        if (part.length > 0) {
          nonBlankLines.push(part);
        }
      });

      const message = nonBlankLines.join("\n");
      if (message.length > 0) {
        new Notice(message, 4000 + message.length * 3);
      }
      // nothing was modified that undo can restore; an earlier rollover must
      // not stay undoable as if it were the latest one
      if (
        undoHistoryInstance.today.file == undefined &&
        undoHistoryInstance.previousDay.file == undefined
      ) {
        this.undoHistory = [];
        return;
      }
      this.undoHistoryTime = new Date();
      this.undoHistory = [undoHistoryInstance];
    }
  }

  async onload() {
    await this.loadSettings();
    this.undoHistory = [];
    this.undoHistoryTime = new Date();

    this.addSettingTab(new RolloverSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("create", async (file) => {
        // Check if automatic daily note creation is enabled
        if (!this.settings.rolloverOnFileCreate) return;
        this.rollover(file);
      })
    );

    this.addCommand({
      id: "obsidian-rollover-daily-todos-rollover",
      name: "Rollover Todos Now",
      callback: () => {
        this.rollover();
      },
    });

    this.addCommand({
      id: "obsidian-rollover-daily-todos-undo",
      name: "Undo last rollover",
      checkCallback: (checking) => {
        // no history, don't allow undo
        if (this.undoHistory.length > 0) {
          const now = window.moment();
          const lastUse = window.moment(this.undoHistoryTime);
          const diff = now.diff(lastUse, "seconds");
          // 2+ mins since use: don't allow undo
          if (diff > 2 * 60) {
            return false;
          }
          if (!checking) {
            new UndoModal(this).open();
          }
          return true;
        }
        return false;
      },
    });
  }
}
