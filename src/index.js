import { normalizePath, Notice, Plugin, TFile } from "obsidian";
import {
  getDailyNoteSettings,
  getAllDailyNotes,
  getDailyNote,
} from "obsidian-daily-notes-interface";
import UndoModal from "./ui/UndoModal";
import ReviewModal from "./ui/ReviewModal";
import RolloverSettingTab from "./ui/RolloverSettingTab";
import { getSections, splitLines } from "./get-todos";
import { verifyTodosPresent } from "./insert-todos";
import {
  applySourceAction,
  effectiveDoneStatusMarkers,
  isCancelAvailable,
  markCancelled,
  migrateSourceActionSettings,
  normalizeMarker,
  resolveSourceAction,
} from "./source-action";
import { needsReview } from "./rollover-items";
import {
  applySources,
  insertSources,
  planSources,
  rolloverNotice,
} from "./rollover-sources";
import { appendToBacklog } from "./backlog";
import { EXAMPLE_RULES, isIgnoredByRules, sanitizeRules } from "./rules";

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
      // with "mark": keep only the marked todo and remove what moved under it
      moveNestedItemsOnMark: false,
      removeEmptyTodos: false,
      rolloverChildren: false,
      rolloverOnFileCreate: true,
      doneStatusMarkers: "xX-",
      leadingNewLine: true,
      skipExistingTodos: false,
      ignoreBlockquotes: false,
      skipCompletedChildren: false,
      trackRolloverCount: false,
      staleAfterRollovers: 5,
      staleBehavior: "keep",
      reviewOnAutoRollover: "off",
      backlogNotePath: "",
      backlogHeading: "",
      cancelMarker: "-",
      // seeded only when stored settings have no rules key, all switched off
      rules: EXAMPLE_RULES.map((rule) => ({ ...rule })),
    };
    const stored = (await this.loadData()) || {};
    this.settings = migrateSourceActionSettings(
      Object.assign({}, DEFAULT_SETTINGS, stored),
      stored
    );
    this.settings.rules = sanitizeRules(this.settings.rules);
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

    return window.moment(path, format);
  }

  isTemplaterEnabled() {
    return !!this.app.plugins?.getPlugin("templater-obsidian");
  }

  async waitForSettle(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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

  // The backlog note's path as a vault path, with ".md" added when missing
  getBacklogPath() {
    const path = normalizePath(this.settings.backlogNotePath.trim());
    return path.toLowerCase().endsWith(".md") ? path : `${path}.md`;
  }

  // Appends the items to the backlog note, creating it (and its folder) when
  // missing. Returns what undo needs to put the note back.
  async writeBacklog(path, items, sourceNoteName) {
    const { backlogHeading, leadingNewLine } = this.settings;
    const build = (content) =>
      appendToBacklog({
        content,
        heading: backlogHeading,
        items,
        sourceNoteName,
        leadingNewLine,
      });
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing == null) {
      const slash = path.lastIndexOf("/");
      const folder = slash > 0 ? path.substring(0, slash) : "";
      if (
        folder !== "" &&
        this.app.vault.getAbstractFileByPath(folder) == null
      ) {
        await this.app.vault.createFolder(folder);
      }
      const created = await this.app.vault.create(path, build(""));
      return { file: created, oldContent: "", created: true };
    }
    if (!(existing instanceof TFile)) {
      throw new Error(`'${path}' is a folder`);
    }
    let oldContent = "";
    await this.app.vault.process(existing, (content) => {
      oldContent = content;
      return build(content);
    });
    return { file: existing, oldContent, created: false };
  }

  async rollover(file = undefined, { review = false } = {}) {
    // an automatic run is one for a file that was just created
    const isAutomaticRun = file != undefined;

    /*** First we check if the file created is actually a valid daily note ***/
    // the library returns undefined when it cannot read the configuration
    const dailyNoteSettings = getDailyNoteSettings();
    if (!dailyNoteSettings) {
      // Automatic runs fire for every created file, so only warn in the console;
      // tell the user when they ran the command themselves.
      console.warn(
        "Daily Catch-Up: could not read the daily notes settings"
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

    // One rollover at a time: a second one while the first waits for the
    // review dialog or Templater would read the same previous day's note and
    // roll its todos twice. An automatic run gives way silently.
    if (this.rolloverInProgress) {
      if (!isAutomaticRun) {
        new Notice("A rollover is already in progress.");
      }
      return;
    }
    this.rolloverInProgress = true;
    try {
      await this.rolloverDailyNote(file, { review, isAutomaticRun });
    } finally {
      this.rolloverInProgress = false;
    }
  }

  // The rollover into `file`, today's daily note, once rollover() checked it
  async rolloverDailyNote(file, { review, isAutomaticRun }) {
    /*** Next, if it is a valid daily note, but we don't have daily notes enabled, we must alert the user ***/
    if (!this.isDailyNotesEnabled()) {
      new Notice(
        "Couldn't roll over unfinished todos. Enable Daily Notes, or Periodic Notes with daily notes turned on.",
        10000
      );
    } else {
      const { templateHeading, removeEmptyTodos, leadingNewLine, skipExistingTodos } =
        this.settings;

      // check if there is a daily note from yesterday
      const lastDailyNote = this.getLastDailyNote();
      if (!lastDailyNote) return;

      // get unfinished todos from yesterday grouped by their parent heading
      const lastDailyNoteContent = await this.app.vault.read(lastDailyNote);
      const lastDailyNoteLines = splitLines(lastDailyNoteContent);
      const rules = this.settings.rules ?? [];

      const sections_yesterday = getSections({
        lines: lastDailyNoteLines,
        withChildren: this.settings.rolloverChildren,
        doneStatusMarkers: effectiveDoneStatusMarkers(this.settings),
        ignoreBlockquotes: this.settings.ignoreBlockquotes,
        skipCompletedChildren: this.settings.skipCompletedChildren,
        // "Not a todo" rules: such a line and what is nested under it stay put
        isIgnored: (line, headingPath) =>
          isIgnoredByRules(line, headingPath, rules),
      });

      // the notes todos are rolled over from, in order: for now only the
      // previous daily note, and only when it has unfinished todos
      const sources = [
        {
          key: "",
          kind: "previous",
          name: lastDailyNote.basename,
          file: lastDailyNote,
          content: lastDailyNoteContent,
          lines: lastDailyNoteLines,
          sections: sections_yesterday,
          sourceAction: resolveSourceAction(this.settings),
        },
      ].filter((source) =>
        source.sections.some((s) => s.incompleteTodos.length > 0)
      );

      if (sources.length == 0) {
        return;
      }

      // setup undo history
      let undoHistoryInstance = {
        // each source note the rollover changed: { file, oldContent }
        sources: [],
        today: {
          file: undefined,
          oldContent: "",
        },
        // created: the rollover made the note, so undo removes it
        backlog: {
          file: undefined,
          oldContent: "",
          created: false,
        },
      };

      const staleSettings = {
        trackRolloverCount: this.settings.trackRolloverCount,
        staleAfterRollovers: this.settings.staleAfterRollovers,
      };
      const backlogEnabled =
        (this.settings.backlogNotePath || "").trim() !== "";
      const cancelEnabled = isCancelAvailable(this.settings);

      // Review: drop empty todos when set, group the todos into items and
      // decide what happens to each (roll, backlog, cancel or leave). Without
      // the dialog each item gets what a matching rule says, and otherwise
      // rolls, except stale items when they are set to go to the backlog.
      const planned = planSources({
        sources,
        settings: {
          removeEmptyTodos,
          rolloverChildren: this.settings.rolloverChildren,
          ...staleSettings,
          staleBehavior: this.settings.staleBehavior,
          backlogEnabled,
          cancelEnabled,
          rules,
        },
      });
      const { plans, items } = planned;

      let backlogPath = null;
      if (backlogEnabled) {
        backlogPath = this.getBacklogPath();
        if (
          backlogPath === file.path ||
          sources.some((source) => backlogPath === source.file.path)
        ) {
          new Notice(
            "The backlog note can't be today's or the previous daily note. Change it in settings.",
            10000
          );
          return;
        }
      }

      let decisions = planned.decisions;
      const showReview =
        items.length > 0 &&
        (review ||
          (isAutomaticRun &&
            needsReview(
              this.settings.reviewOnAutoRollover,
              items,
              staleSettings
            )));
      if (showReview) {
        decisions = await new ReviewModal(this.app, {
          sources: sources.map((source, i) => ({
            name: source.name,
            sections: plans[i].sections,
            items: plans[i].items,
          })),
          decisions,
          staleSettings,
          backlogEnabled,
          cancelEnabled,
        }).openAndWait();
        if (decisions == null) {
          if (isAutomaticRun) {
            new Notice(
              "Rollover skipped. Run 'Review and roll over todos' when you're ready.",
              10000
            );
          }
          return;
        }
      }

      const applied = applySources({ plans, sources, decisions });
      const { perSource, outcomeCounts } = applied;
      // only Roll items go to today's note
      let todosAdded = perSource.reduce(
        (sum, decided) => sum + decided.rolledTodoCount,
        0
      );

      // get today's content and modify it (read only now, after any review)
      let templateHeadingNotFound = false;

      let todosAlreadyPresent = 0;
      let duplicateTodos = [];
      let insertedTodos = [];
      // per source: what insertSources() did with its todos, including the
      // lines of duplicates dropped by skip-existing (they did not move)
      let insertedPerSource = sources.map(() => ({
        todosAlreadyPresent: 0,
        duplicateTodos: [],
        retainedLineIndices: [],
        insertedTodos: [],
      }));

      if (perSource.some((decided) => decided.rolledSections.length > 0)) {
        // Read, plan and write today's note in one atomic step, so an edit
        // made in between (by the user, a sync client or another plugin) is
        // neither lost nor planned against stale content.
        let originalDailyNoteContent = "";
        let inserted;
        await this.app.vault.process(file, (content) => {
          originalDailyNoteContent = content;
          // Optionally leave out todos that today's note already has
          // (compared against the note as it was before that source's
          // insertion; they still count as handled for the source note
          // below), and count this rollover on each item that is actually
          // inserted. The sources go in one after the other.
          inserted = insertSources({
            content,
            entries: sources.map((source, i) => ({
              sections: perSource[i].rolledSections,
              lines: source.lines,
              noStaleLineIndices: perSource[i].noStaleLineIndices,
            })),
            settings: {
              skipExistingTodos,
              rolloverChildren: this.settings.rolloverChildren,
              trackRolloverCount: this.settings.trackRolloverCount,
              doneStatusMarkers: effectiveDoneStatusMarkers(this.settings),
              templateHeading,
              leadingNewLine,
            },
          });
          return inserted.content;
        });
        insertedPerSource = inserted.perSource;
        todosAlreadyPresent = insertedPerSource.reduce(
          (sum, part) => sum + part.todosAlreadyPresent,
          0
        );
        duplicateTodos = insertedPerSource.flatMap(
          (part) => part.duplicateTodos
        );
        insertedTodos = insertedPerSource.flatMap((part) => part.insertedTodos);
        todosAdded -= todosAlreadyPresent;
        if (insertedTodos.length > 0) {
          // insertSources() only reports the heading missing when it inserted
          templateHeadingNotFound = inserted.templateHeadingNotFound;

          // With Templater, the note we read was still the unrendered template,
          // so undoing today's note would replace Templater's output with it.
          // Only the source notes are undoable in that case.
          if (!this.isTemplaterEnabled()) {
            undoHistoryInstance.today = {
              file: file,
              oldContent: originalDailyNoteContent,
            };
          }
        }

        // Before touching the source notes, make sure another plugin did not
        // overwrite what we just inserted. If it did, the todos would
        // otherwise be lost from both notes. Todos skipped because today's note
        // already had them must still be there too.
        if (
          sources.some((source) => source.sourceAction !== "none") &&
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
              "Rollover left the previous day's note unchanged: today's note was modified by another plugin (likely Templater) after the todos were added, and they may be missing. Run 'Roll over todos now' to try again.",
              15000
            );
            return;
          }
        }
      }

      // Backlog items go to the backlog note: after today's note, before the
      // source notes, which are left alone if this fails
      if (applied.backlogItems.length > 0) {
        try {
          undoHistoryInstance.backlog = await this.writeBacklog(
            backlogPath,
            applied.backlogItems,
            sources[0].name
          );
        } catch (error) {
          console.error(
            "Daily Catch-Up: could not write the backlog note",
            error
          );
          const todaysPart =
            insertedTodos.length > 0
              ? ` ${todosAdded} todo${
                  todosAdded > 1 ? "s were" : " was"
                } rolled over to today's note.`
              : "";
          new Notice(
            `Rollover couldn't write the backlog note '${backlogPath}' (${
              error?.message ?? error
            }), so the previous day's note was left unchanged.${todaysPart}`,
            15000
          );
          this.recordUndo(undoHistoryInstance);
          return;
        }
      }

      // Cancel marks and the configured action ("delete" | "mark") on each
      // source note, in order
      let cancelledCount = 0;
      for (const [i, source] of sources.entries()) {
        const decided = perSource[i];
        const { sourceAction } = source;
        const { cancelledLineIndices } = decided;
        if (sourceAction === "none" && cancelledLineIndices.length === 0) {
          continue;
        }
        // Read, check and write in one atomic step: the line positions refer
        // to the content we parsed, and the note may have been edited since
        // (by the user, a sync client or another plugin, e.g. during the
        // Templater wait). Only change it when it is still exactly that.
        let editedMeanwhile = false;
        let changed = false;
        await this.app.vault.process(source.file, (currentContent) => {
          if (currentContent !== source.content) {
            editedMeanwhile = true;
            return currentContent;
          }
          // Cancel only rewrites checkboxes, so the positions stay valid for
          // the source action below
          let content = markCancelled({
            content: currentContent,
            lineIndices: cancelledLineIndices,
            marker: normalizeMarker(this.settings.cancelMarker, "-"),
            doneStatusMarkers: effectiveDoneStatusMarkers(this.settings),
            ignoreBlockquotes: this.settings.ignoreBlockquotes,
          }).content;
          if (sourceAction === "none") {
            changed = content !== currentContent;
            return content;
          }
          const result = applySourceAction({
            content,
            action: sourceAction,
            // Roll and Backlog items moved; Cancel and Leave items did not
            rolledLineIndices: decided.movedLineIndices,
            // delete also removes empty todos that were not rolled over, but
            // never Cancel or Leave items
            deletedLineIndices: decided.deleteLineIndices,
            skippedLineIndices: decided.skippedLineIndices,
            marker: normalizeMarker(this.settings.rolloverSourceMarker),
            doneStatusMarkers: this.settings.doneStatusMarkers,
            ignoreBlockquotes: this.settings.ignoreBlockquotes,
            // nested items only moved when children were rolled over
            moveNested:
              this.settings.moveNestedItemsOnMark &&
              this.settings.rolloverChildren,
            retainLineIndices: insertedPerSource[i].retainedLineIndices,
          });
          changed = result.content !== currentContent;
          return result.content;
        });
        if (editedMeanwhile) {
          new Notice(
            "Rollover left the previous day's note unchanged: it was edited while the rollover was running.",
            10000
          );
        } else {
          // the cancel marks were applied
          cancelledCount += decided.outcomeCounts.cancel;
          if (changed) {
            undoHistoryInstance.sources.push({
              file: source.file,
              oldContent: `${source.content}`,
            });
          }
        }
      }

      // Let user know rollover has been successful with X todos
      const message = rolloverNotice({
        templateHeadingNotFound,
        templateHeading,
        todosAdded,
        todosAlreadyPresent,
        backlogCount: outcomeCounts.backlog,
        backlogPath,
        cancelledCount,
        sources: sources.map((source, i) => ({
          name: source.name,
          sourceAction: source.sourceAction,
          removedEmptyTodos: plans[i].removedEmptyTodos,
          leftCount: perSource[i].outcomeCounts.leave,
        })),
      });
      if (message.length > 0) {
        new Notice(message, 4000 + message.length * 3);
      }
      this.recordUndo(undoHistoryInstance);
    }
  }

  recordUndo(undoHistoryInstance) {
    const { today, sources, backlog } = undoHistoryInstance;
    // nothing was modified that undo can restore; an earlier rollover must
    // not stay undoable as if it were the latest one
    if (
      today.file == undefined &&
      !sources.some((source) => source.file != undefined) &&
      backlog.file == undefined
    ) {
      this.undoHistory = [];
      return;
    }
    this.undoHistoryTime = new Date();
    this.undoHistory = [undoHistoryInstance];
  }

  async onload() {
    await this.loadSettings();
    this.rolloverInProgress = false;
    this.undoHistory = [];
    this.undoHistoryTime = new Date();

    this.addSettingTab(new RolloverSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        // Check if automatic daily note creation is enabled
        if (!this.settings.rolloverOnFileCreate) return;
        void this.rollover(file);
      })
    );

    this.addCommand({
      id: "rollover",
      name: "Roll over todos now",
      callback: () => {
        void this.rollover();
      },
    });

    this.addCommand({
      id: "review-and-rollover",
      name: "Review and roll over todos…",
      callback: () => {
        void this.rollover(undefined, { review: true });
      },
    });

    this.addCommand({
      id: "undo-rollover",
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
