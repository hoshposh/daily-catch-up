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
  effectiveDoneStatusMarkers,
  isCancelAvailable,
  migrateSourceActionSettings,
  resolveSourceAction,
} from "./source-action";
import { needsReview } from "./rollover-items";
import {
  applySources,
  backlogFailedNotice,
  INBOX_GUARD_NOTICE,
  inboxPathConflicts,
  inboxSource,
  insertSources,
  planSources,
  rolloverNotice,
  sourceUnchangedNotice,
  sourceWriteFailedNotice,
  templaterNotice,
  writeSource,
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
      // the inbox note whose open todos every rollover pulls in ("" = off);
      // what to do with them afterwards ("delete" | "mark", never "none");
      // and the heading in today's note to put them under ("" = with the rest)
      inboxNotePath: "",
      inboxSourceAction: "delete",
      inboxHeading: "",
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

  // A note path setting as a vault path, with ".md" added when missing
  getNotePath(setting) {
    const path = normalizePath(setting.trim());
    return path.toLowerCase().endsWith(".md") ? path : `${path}.md`;
  }

  // The backlog note's path as a vault path, with ".md" added when missing
  getBacklogPath() {
    return this.getNotePath(this.settings.backlogNotePath);
  }

  // The inbox note's path as a vault path, or null when no inbox is set
  getInboxPath() {
    const setting = this.settings.inboxNotePath ?? "";
    return setting.trim() === "" ? null : this.getNotePath(setting);
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

      // check if there is a daily note from yesterday; without one, only an
      // inbox note can still give todos
      const lastDailyNote = this.getLastDailyNote();
      const inboxPath = this.getInboxPath();
      if (!lastDailyNote && inboxPath == null) return;

      const rules = this.settings.rules ?? [];
      const backlogEnabled =
        (this.settings.backlogNotePath || "").trim() !== "";
      // unfinished todos grouped by their parent heading, with the same
      // options for every source note
      const parse = (lines) =>
        getSections({
          lines,
          withChildren: this.settings.rolloverChildren,
          doneStatusMarkers: effectiveDoneStatusMarkers(this.settings),
          ignoreBlockquotes: this.settings.ignoreBlockquotes,
          skipCompletedChildren: this.settings.skipCompletedChildren,
          // "Not a todo" rules: such a line and what is nested under it stay
          // put
          isIgnored: (line, headingPath) =>
            isIgnoredByRules(line, headingPath, rules),
        });

      // the notes todos are rolled over from, in order: the previous daily
      // note, then the inbox note
      const candidates = [];
      if (lastDailyNote) {
        const lastDailyNoteContent = await this.app.vault.read(lastDailyNote);
        const lastDailyNoteLines = splitLines(lastDailyNoteContent);
        candidates.push({
          key: "",
          kind: "previous",
          name: lastDailyNote.basename,
          file: lastDailyNote,
          content: lastDailyNoteContent,
          lines: lastDailyNoteLines,
          sections: parse(lastDailyNoteLines),
          sourceAction: resolveSourceAction(this.settings),
        });
      }
      if (inboxPath != null) {
        // before the backlog guard below, so an inbox that is also the
        // backlog note gets this notice
        if (
          inboxPathConflicts({
            inboxPath,
            todayPath: file.path,
            previousPath: lastDailyNote?.path,
            backlogPath: backlogEnabled ? this.getBacklogPath() : null,
          })
        ) {
          new Notice(INBOX_GUARD_NOTICE, 10000);
          return;
        }
        // a missing inbox is skipped silently: it may not exist until the
        // first capture
        const inboxFile = this.app.vault.getAbstractFileByPath(inboxPath);
        if (inboxFile instanceof TFile) {
          const content = await this.app.vault.read(inboxFile);
          const lines = splitLines(content);
          candidates.push(
            inboxSource({
              file: inboxFile,
              content,
              lines,
              sections: parse(lines),
              settings: this.settings,
            })
          );
        }
      }
      // only notes with unfinished todos
      const sources = candidates.filter((source) =>
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
        // Compare with the previous daily note itself, not with the sources:
        // a previous note without open todos is not a source, but it must
        // still never become the backlog (the inbox can run a rollover
        // without it)
        if (
          backlogPath === file.path ||
          (lastDailyNote != null && backlogPath === lastDailyNote.path)
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
            new Notice(templaterNotice(sources), 15000);
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
          new Notice(
            backlogFailedNotice({
              backlogPath,
              error,
              todosAdded: insertedTodos.length > 0 ? todosAdded : 0,
              sources,
            }),
            15000
          );
          this.recordUndo(undoHistoryInstance);
          return;
        }
      }

      // Cancel marks and the configured action ("delete" | "mark") on each
      // source note, in order. Whatever throws, today's note, the backlog
      // note and the source notes already written stay undoable.
      let cancelledCount = 0;
      try {
        for (const [i, source] of sources.entries()) {
          const decided = perSource[i];
          if (
            source.sourceAction === "none" &&
            decided.cancelledLineIndices.length === 0
          ) {
            continue;
          }
          // Read, check and write in one atomic step: the line positions
          // refer to the content we parsed, and the note may have been edited
          // since (by the user, a sync client or another plugin, e.g. during
          // the Templater wait). Only change it when it is still exactly that.
          let editedMeanwhile = false;
          let changed = false;
          try {
            await this.app.vault.process(source.file, (currentContent) => {
              if (currentContent !== source.content) {
                editedMeanwhile = true;
                return currentContent;
              }
              const result = writeSource({
                content: currentContent,
                source,
                decided,
                retainedLineIndices: insertedPerSource[i].retainedLineIndices,
                settings: this.settings,
              });
              changed = result.changed;
              return result.content;
            });
          } catch (error) {
            // this note stays as it was; the next one is still written
            console.error(
              "Daily Catch-Up: could not write the source note",
              source.file.path,
              error
            );
            new Notice(sourceWriteFailedNotice(source, error), 15000);
            continue;
          }
          if (editedMeanwhile) {
            new Notice(sourceUnchangedNotice(source), 10000);
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
            kind: source.kind,
            name: source.name,
            sourceAction: source.sourceAction,
            removedEmptyTodos: plans[i].removedEmptyTodos,
            leftCount: perSource[i].outcomeCounts.leave,
            // the todos of this source actually inserted into today's note
            rolledCount: insertedPerSource[i].insertedTodos.length,
          })),
        });
        if (message.length > 0) {
          new Notice(message, 4000 + message.length * 3);
        }
      } finally {
        this.recordUndo(undoHistoryInstance);
      }
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
