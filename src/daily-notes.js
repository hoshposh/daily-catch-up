// The only code that reads the daily-notes settings or decides which files are
// daily notes and what their dates are. `moment` and `app` are passed in
// (Obsidian provides `window.moment`), so all of it runs in unit tests.

export const DEFAULT_DAILY_NOTE_FORMAT = "YYYY-MM-DD";

// The folder as a vault path: no surrounding whitespace or slashes, "" for the
// vault root
export function cleanFolder(folder) {
  return (folder ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

// A note's date, or null when it is not a daily note: its path inside the
// folder, without ".md", must match the whole format exactly. This is the path
// Daily Notes itself creates, so a note in a subfolder the format doesn't
// describe is not a daily note.
export function noteDate(path, { folder, format }, moment) {
  let rest = path;
  if (folder !== "") {
    if (!rest.startsWith(`${folder}/`)) return null;
    rest = rest.slice(folder.length + 1);
  }
  if (!rest.endsWith(".md")) return null;
  rest = rest.slice(0, -".md".length);
  const date = moment(rest, format, true);
  return date.isValid() ? date : null;
}

// Where today's daily note lives
export function todayNotePath({ folder, format }, today) {
  const name = `${today.format(format)}.md`;
  return folder === "" ? name : `${folder}/${name}`;
}

// [{ file, date }] for each daily note among `files`, newest first
export function dailyNotes(files, settings, moment) {
  return files
    .map((file) => ({ file, date: noteDate(file.path, settings, moment) }))
    .filter(({ date }) => date !== null)
    .sort((a, b) => b.date.valueOf() - a.date.valueOf());
}

// The newest daily note dated before `today`'s day, or null
export function previousDailyNote(files, settings, today, moment) {
  const found = dailyNotes(files, settings, moment).find(({ date }) =>
    date.isBefore(today, "day")
  );
  return found ? found.file : null;
}

// { folder, format, template } from Periodic Notes when it has daily notes on,
// else from the core Daily Notes plugin; null when they can't be read
export function getDailyNoteSettings(app) {
  try {
    const periodicNotes = app.plugins.getPlugin("periodic-notes");
    const options = periodicNotes?.settings?.daily?.enabled
      ? periodicNotes.settings.daily
      : app.internalPlugins.getPluginById("daily-notes")?.instance?.options;
    const { folder, format, template } = options || {};
    return {
      format: format || DEFAULT_DAILY_NOTE_FORMAT,
      folder: cleanFolder(folder),
      template: template?.trim() || "",
    };
  } catch (err) {
    console.info("Daily Catch-Up: could not read the daily notes settings", err);
    return null;
  }
}

export function isDailyNotesEnabled(app) {
  const dailyNotesPlugin = app.internalPlugins.plugins["daily-notes"];
  const dailyNotesEnabled = dailyNotesPlugin && dailyNotesPlugin.enabled;

  const periodicNotesPlugin = app.plugins.getPlugin("periodic-notes");
  const periodicNotesEnabled =
    periodicNotesPlugin && periodicNotesPlugin.settings?.daily?.enabled;

  return Boolean(dailyNotesEnabled || periodicNotesEnabled);
}
