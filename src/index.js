import { normalizePath, Notice, Plugin, TFile } from "obsidian";
import {
  getDailyNoteSettings,
  isDailyNotesEnabled,
  notesInWindow,
  previousDailyNote,
  todayNotePath,
} from "./daily-notes";
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
  BACKLOG_GUARD_NOTICE,
  backlogFailedNotice,
  backlogPathConflict,
  backlogSource,
  bringBackNotice,
  earlierSources,
  inboxGuardNotice,
  inboxPathConflicts,
  inboxSource,
  insertSources,
  planSources,
  sourceNeedsWrite,
  rolloverNotice,
  sourceUnchangedNotice,
  sourceWriteFailedNotice,
  templaterNotice,
  templaterNoticeSources,
  writeSource,
} from "./rollover-sources";
import { appendToBacklog } from "./backlog";
import { stripFromField } from "./rolled-count";
import { followRename } from "./note-paths";
import { EXAMPLE_RULES, isIgnoredByRules, sanitizeRules } from "./rules";
import {
  lookBackApplies,
  lookBackDoneMarkers,
  settledLookBackSince,
} from "./look-back";

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
      // Look back: also read the daily notes of this many days before today
      // (0 = off), none dated before lookBackSince ("YYYY-MM-DD", "" = unset)
      lookBackDays: 0,
      lookBackSince: "",
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

  // The newest daily note dated before `today` (a moment), or null. The
  // rollover passes the time it read once, so midnight passing in between
  // cannot make today's own note the previous one.
  getLastDailyNote(today) {
    const settings = getDailyNoteSettings(this.app);
    if (!settings) return null;
    return previousDailyNote(
      this.app.vault.getMarkdownFiles(),
      settings,
      today,
      window.moment
    );
  }

  isTemplaterEnabled() {
    return !!this.app.plugins?.getPlugin("templater-obsidian");
  }

  async waitForSettle(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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

  // Points the inbox and backlog settings at their notes' new paths after the
  // vault renamed or moved a note or a folder holding it
  async followRenamedNote(newPath, oldPath) {
    let changed = false;
    for (const key of ["inboxNotePath", "backlogNotePath"]) {
      const setting = this.settings[key] ?? "";
      if (setting.trim() === "") continue;
      const moved = followRename(this.getNotePath(setting), oldPath, newPath);
      if (moved === null) continue;
      this.settings[key] = moved;
      changed = true;
    }
    if (changed) await this.saveSettings();
  }

  // A note's unfinished todos grouped by their parent heading, with the
  // options every source note is read with. `ruleLine` is the text "Not a
  // todo" rules see (the backlog's lines without their `[from:: …]` link).
  parseNote(lines, { ruleLine = (line) => line } = {}) {
    const rules = this.settings.rules ?? [];
    return getSections({
      lines,
      withChildren: this.settings.rolloverChildren,
      doneStatusMarkers: effectiveDoneStatusMarkers(this.settings),
      ignoreBlockquotes: this.settings.ignoreBlockquotes,
      skipCompletedChildren: this.settings.skipCompletedChildren,
      // "Not a todo" rules: such a line and what is nested under it stay
      // put
      isIgnored: (line, headingPath) =>
        isIgnoredByRules(ruleLine(line), headingPath, rules),
    });
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
    // null when the configuration cannot be read
    const dailyNoteSettings = getDailyNoteSettings(this.app);
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
    // the clock is read once: everything below decides "today" from it
    const today = new Date();
    const todayMoment = window.moment(today);
    const todayPath = todayNotePath(dailyNoteSettings, todayMoment);
    let ignoreCreationTime = false;

    // Rollover can be called, but we need to get the daily file
    if (file == undefined) {
      file = this.app.vault.getAbstractFileByPath(todayPath);
      if (!(file instanceof TFile)) return;
      ignoreCreationTime = true;
    }

    // is today's daily note
    if (file.path !== todayPath) return;

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
      await this.rolloverDailyNote(file, {
        review,
        isAutomaticRun,
        today: todayMoment,
        dailyNoteSettings,
      });
    } finally {
      this.rolloverInProgress = false;
    }
  }

  // Bring back from backlog: the backlog's open todos in the review dialog,
  // all on Stay, and the chosen ones moved into today's note
  async bringBack() {
    const dailyNoteSettings = getDailyNoteSettings(this.app);
    if (!dailyNoteSettings) {
      new Notice(
        "Rollover couldn't read your daily note settings. Check that Daily Notes (or Periodic Notes) is enabled and configured.",
        10000
      );
      return;
    }
    if (!isDailyNotesEnabled(this.app)) {
      new Notice(
        "Couldn't roll over unfinished todos. Enable Daily Notes, or Periodic Notes with daily notes turned on.",
        10000
      );
      return;
    }
    const todayPath = todayNotePath(dailyNoteSettings, window.moment());
    const file = this.app.vault.getAbstractFileByPath(todayPath);
    if (!(file instanceof TFile)) {
      new Notice("Create today's daily note first, then bring todos back.");
      return;
    }
    // it writes today's note and the backlog, as a rollover does
    if (this.rolloverInProgress) {
      new Notice("A rollover is already in progress.");
      return;
    }
    this.rolloverInProgress = true;
    try {
      await this.bringBackInto(file);
    } finally {
      this.rolloverInProgress = false;
    }
  }

  // Bring back into `file`, today's daily note, once bringBack() checked it
  async bringBackInto(file) {
    const backlogPath = this.getBacklogPath();
    if (backlogPath === file.path) {
      new Notice(BACKLOG_GUARD_NOTICE, 10000);
      return;
    }
    const backlogFile = this.app.vault.getAbstractFileByPath(backlogPath);
    if (!(backlogFile instanceof TFile)) {
      new Notice(`There is no backlog note at '${backlogPath}' yet.`);
      return;
    }
    const content = await this.app.vault.read(backlogFile);
    const lines = splitLines(content);
    const source = backlogSource({
      file: backlogFile,
      content,
      lines,
      sections: this.parseNote(lines, { ruleLine: stripFromField }),
    });
    if (!source.sections.some((s) => s.incompleteTodos.length > 0)) {
      new Notice(
        `The backlog note '${backlogFile.basename}' has no open todos.`
      );
      return;
    }
    const sources = [source];

    const staleSettings = {
      trackRolloverCount: this.settings.trackRolloverCount,
      staleAfterRollovers: this.settings.staleAfterRollovers,
    };
    const cancelEnabled = isCancelAvailable(this.settings);
    const { plans, reviewItems, decisions: defaults } = planSources({
      sources,
      settings: {
        removeEmptyTodos: this.settings.removeEmptyTodos,
        rolloverChildren: this.settings.rolloverChildren,
        ...staleSettings,
        staleBehavior: this.settings.staleBehavior,
        // Backlog is never offered for a todo already in the backlog
        backlogEnabled: false,
        cancelEnabled,
        rules: this.settings.rules ?? [],
        doneStatusMarkers: lookBackDoneMarkers(this.settings),
      },
    });
    // every todo may be an empty one Remove empty todos dropped
    if (reviewItems.length === 0) {
      new Notice(
        `The backlog note '${backlogFile.basename}' has no open todos.`
      );
      return;
    }

    const decisions = await new ReviewModal(this.app, {
      sources: [
        { name: source.name, sections: plans[0].sections, items: reviewItems },
      ],
      decisions: defaults,
      staleSettings,
      backlogEnabled: false,
      cancelEnabled,
      mode: "bringBack",
    }).openAndWait();
    if (decisions == null) return;
    const chosen = reviewItems.some((item) =>
      ["roll", "cancel"].includes(decisions[item.id])
    );
    if (!chosen) {
      new Notice("Nothing brought back.");
      return;
    }

    const { templateHeading } = this.settings;
    await this.writeRollover({
      file,
      sources,
      plans,
      decisions,
      backlogPath: null,
      // today's note is not new: Templater rendered it long ago
      templaterGuard: false,
      undoKind: "bring-back",
      buildNotice: (summary) =>
        bringBackNotice({
          broughtBack: summary.todosAdded,
          alreadyPresent: summary.todosAlreadyPresent,
          cancelled: summary.cancelledCount,
          name: source.name,
          templateHeadingNotFound: summary.templateHeadingNotFound,
          templateHeading,
        }),
    });
  }

  // The rollover into `file`, today's daily note, once rollover() checked it
  async rolloverDailyNote(
    file,
    { review, isAutomaticRun, today, dailyNoteSettings }
  ) {
    /*** Next, if it is a valid daily note, but we don't have daily notes enabled, we must alert the user ***/
    if (!isDailyNotesEnabled(this.app)) {
      new Notice(
        "Couldn't roll over unfinished todos. Enable Daily Notes, or Periodic Notes with daily notes turned on.",
        10000
      );
    } else {
      const { templateHeading, removeEmptyTodos } = this.settings;

      // check if there is a daily note from yesterday; without one, only an
      // inbox note can still give todos
      const lastDailyNote = this.getLastDailyNote(today);
      const inboxPath = this.getInboxPath();
      if (!lastDailyNote && inboxPath == null) return;

      const rules = this.settings.rules ?? [];
      const backlogEnabled =
        (this.settings.backlogNotePath || "").trim() !== "";
      // unfinished todos grouped by their parent heading, with the same
      // options for every source note
      const parse = (lines) => this.parseNote(lines);

      // the notes todos are rolled over from, in order: the previous daily
      // note, the older daily notes Look back reads (newest first), then the
      // inbox note
      const candidates = [];
      let lastDailyNoteLines = [];
      if (lastDailyNote) {
        const lastDailyNoteContent = await this.app.vault.read(lastDailyNote);
        lastDailyNoteLines = splitLines(lastDailyNoteContent);
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
      // Look back: the other daily notes of the last N days, none dated
      // before the start date (set to today, and saved, when it is unset)
      let earlierNotes = [];
      if (lookBackApplies(this.settings)) {
        const { since, changed } = settledLookBackSince(
          this.settings,
          today.format("YYYY-MM-DD")
        );
        if (changed) {
          this.settings.lookBackSince = since;
          await this.saveSettings();
        }
        earlierNotes = notesInWindow(
          this.app.vault.getMarkdownFiles(),
          dailyNoteSettings,
          today,
          window.moment,
          {
            count: this.settings.lookBackDays,
            period: "day",
            since: window.moment(since, "YYYY-MM-DD", true),
          }
        )
          .map((note) => note.file)
          .filter((note) => note.path !== lastDailyNote?.path);
      }
      const earlierPaths = earlierNotes.map((note) => note.path);
      if (earlierNotes.length > 0) {
        const notes = [];
        for (const earlierFile of earlierNotes) {
          const content = await this.app.vault.read(earlierFile);
          const lines = splitLines(content);
          notes.push({
            file: earlierFile,
            content,
            lines,
            sections: parse(lines),
          });
        }
        // An older note's todo already done in a newer note (today's, the
        // previous one or a newer older one) counts as handled. Today's note
        // is read for this now; the write below reads it again.
        candidates.push(
          ...earlierSources({
            todayLines: splitLines(await this.app.vault.read(file)),
            previousLines: lastDailyNoteLines,
            notes,
            settings: this.settings,
            doneStatusMarkers: lookBackDoneMarkers(this.settings),
          })
        );
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
            earlierPaths,
          })
        ) {
          new Notice(inboxGuardNotice({ inboxPath, earlierPaths }), 10000);
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
          // an older note's todo done in a newer note: the effective ones,
          // or the parser's default when the field is empty
          doneStatusMarkers: lookBackDoneMarkers(this.settings),
        },
      });
      // reviewItems: the items the review shows (an older note's todos done
      // in a newer note or left by a rule are not)
      const { plans, reviewItems } = planned;

      let backlogPath = null;
      if (backlogEnabled) {
        backlogPath = this.getBacklogPath();
        // Compare with the previous daily note itself, not with the sources:
        // a previous note without open todos is not a source, but it must
        // still never become the backlog (the inbox can run a rollover
        // without it). The same goes for the older notes Look back reads.
        const conflict = backlogPathConflict({
          backlogPath,
          todayPath: file.path,
          previousPath: lastDailyNote?.path,
          earlierPaths,
        });
        if (conflict != null) {
          new Notice(conflict, 10000);
          return;
        }
      }

      let decisions = planned.decisions;
      const showReview =
        reviewItems.length > 0 &&
        (review ||
          (isAutomaticRun &&
            needsReview(
              this.settings.reviewOnAutoRollover,
              reviewItems,
              staleSettings
            )));
      if (showReview) {
        decisions = await new ReviewModal(this.app, {
          sources: sources.map((source, i) => ({
            name: source.name,
            sections: plans[i].sections,
            // hidden items keep their decision: the dialog returns the whole
            // map it was given, with only the shown items changed
            items: plans[i].items.filter((item) => !item.hidden),
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

      await this.writeRollover({
        file,
        sources,
        plans,
        decisions,
        backlogPath,
        templaterGuard: true,
        undoKind: "rollover",
        buildNotice: (summary) =>
          rolloverNotice({
            templateHeadingNotFound: summary.templateHeadingNotFound,
            templateHeading,
            todosAdded: summary.todosAdded,
            todosAlreadyPresent: summary.todosAlreadyPresent,
            doneElsewhereCount: summary.doneElsewhereCount,
            backlogCount: summary.outcomeCounts.backlog,
            backlogPath,
            cancelledCount: summary.cancelledCount,
            sources: sources.map((source, i) => ({
              kind: source.kind,
              name: source.name,
              sourceAction: source.sourceAction,
              removedEmptyTodos: plans[i].removedEmptyTodos,
              // the leaves the review showed (not an older note's rule leaves)
              leftCount: summary.perSource[i].leftCount,
              // the todos of this source actually inserted into today's note
              rolledCount: summary.insertedPerSource[i].insertedTodos.length,
            })),
          }),
      });
    }
  }

  // Everything after the decisions are known: today's note, the backlog
  // note, each source note, the notice and the undo entry. Shared by the
  // rollover and Bring back from backlog. With templaterGuard the Templater
  // safeguard runs and today's note is only undoable without Templater;
  // without it (today's note is not new) neither applies.
  async writeRollover({
    file,
    sources,
    plans,
    decisions,
    backlogPath,
    templaterGuard,
    buildNotice,
    undoKind,
  }) {
    const { templateHeading, leadingNewLine, skipExistingTodos } =
      this.settings;

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
    undoHistoryInstance.kind = undoKind;

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
    // older notes' todos done in a newer note, kept out of today's note
    let todosDoneElsewhere = 0;
    let duplicateTodos = [];
    let insertedTodos = [];
    // per source: what insertSources() did with its todos, including the
    // lines of duplicates dropped by skip-existing (they did not move)
    let insertedPerSource = sources.map(() => ({
      todosAlreadyPresent: 0,
      duplicateTodos: [],
      retainedLineIndices: [],
      insertedTodos: [],
      todosDoneElsewhere: 0,
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
            handledLineIndices: perSource[i].handledLineIndices,
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
      todosDoneElsewhere = insertedPerSource.reduce(
        (sum, part) => sum + part.todosDoneElsewhere,
        0
      );
      insertedTodos = insertedPerSource.flatMap((part) => part.insertedTodos);
      todosAdded -= todosAlreadyPresent + todosDoneElsewhere;
      if (insertedTodos.length > 0) {
        // insertSources() only reports the heading missing when it inserted
        templateHeadingNotFound = inserted.templateHeadingNotFound;

        // With Templater, the note we read was still the unrendered template,
        // so undoing today's note would replace Templater's output with it.
        // Only the source notes are undoable in that case.
        if (!templaterGuard || !this.isTemplaterEnabled()) {
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
        templaterGuard &&
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
            templaterNotice(templaterNoticeSources(sources, perSource)),
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
        // nothing to cancel, mark or delete (an older note with only Leave
        // items, or a source whose action is "none" without Cancel items)
        if (!sourceNeedsWrite(source, decided)) continue;
        // Read, check and write in one atomic step: the line positions
        // refer to the content we parsed, and the note may have been edited
        // since (by the user, a sync client or another plugin, e.g. during
        // the Templater wait). Only change it when it is still exactly that.
        let editedMeanwhile = false;
        let changed = false;
        let writtenContent = null;
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
            writtenContent = result.content;
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
            const entry = {
              file: source.file,
              oldContent: `${source.content}`,
            };
            // the inbox can gain captures from another device before an
            // undo: undo keeps those lines (see undo-merge.js)
            if (source.kind === "inbox") {
              entry.newContent = writtenContent;
              entry.keepNewLines = true;
            }
            undoHistoryInstance.sources.push(entry);
          }
        }
      }

      // Let user know rollover has been successful with X todos
      const message = buildNotice({
        templateHeadingNotFound,
        todosAdded,
        todosAlreadyPresent,
        doneElsewhereCount: perSource.reduce(
          (sum, decided) => sum + decided.handledCount,
          0
        ),
        outcomeCounts,
        cancelledCount,
        backlogPath,
        perSource,
        insertedPerSource,
        plans,
      });
      if (message.length > 0) {
        new Notice(message, 4000 + message.length * 3);
      }
    } finally {
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

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        void this.followRenamedNote(file.path, oldPath).catch((error) =>
          console.error(
            "Daily Catch-Up: could not save the renamed note path",
            error
          )
        );
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
      id: "bring-back-from-backlog",
      name: "Bring back from backlog…",
      // only offered while a backlog note is set
      checkCallback: (checking) => {
        if ((this.settings.backlogNotePath ?? "").trim() === "") return false;
        if (!checking) void this.bringBack();
        return true;
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
