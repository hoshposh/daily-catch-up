import { afterEach, describe, expect, test, vi } from "vitest";
import moment from "moment";
import {
  cleanFolder,
  dailyNotes,
  DEFAULT_DAILY_NOTE_FORMAT,
  getDailyNoteSettings,
  isDailyNotesEnabled,
  noteDate,
  previousDailyNote,
  todayNotePath,
} from "./daily-notes";

const S = { folder: "daily", format: "YYYY-MM-DD" };
const d = (s) => moment(s, "YYYY-MM-DD", true);

describe("cleanFolder", () => {
  test.each([
    ["daily", "daily"],
    ["/daily", "daily"],
    ["daily/", "daily"],
    ["/daily/", "daily"],
    ["  daily  ", "daily"],
    ["a/b/", "a/b"],
    ["", ""],
    ["/", ""],
    [undefined, ""],
  ])("%j → %j", (input, out) => expect(cleanFolder(input)).toBe(out));
});

describe("noteDate", () => {
  const date = (path, settings = S) =>
    noteDate(path, settings, moment)?.format("YYYY-MM-DD") ?? null;

  test("a note in the folder", () =>
    expect(date("daily/2026-11-19.md")).toBe("2026-11-19"));
  test("a sibling folder sharing the prefix", () =>
    expect(date("daily-old/2026-11-19.md")).toBeNull());
  test("a subfolder the format does not describe", () =>
    expect(date("daily/archive/2026-11-19.md")).toBeNull());
  test("outside the folder", () => expect(date("2026-11-19.md")).toBeNull());
  test("not markdown", () => expect(date("daily/2026-11-19.pdf")).toBeNull());
  test("strict parsing", () => expect(date("daily/2026-11-5.md")).toBeNull());
  test("not a date", () => expect(date("daily/Ideas.md")).toBeNull());
  test("a folder with regex characters", () =>
    expect(
      date("Daily (work)/2026-11-19.md", {
        folder: "Daily (work)",
        format: "YYYY-MM-DD",
      })
    ).toBe("2026-11-19"));
  test("the vault root", () => {
    const root = { folder: "", format: "YYYY-MM-DD" };
    expect(date("2026-11-19.md", root)).toBe("2026-11-19");
    expect(date("Inbox.md", root)).toBeNull();
    expect(date("daily/2026-11-19.md", root)).toBeNull();
  });
  test("a format with folders in it", () => {
    const nested = { folder: "journal", format: "YYYY/MM/YYYY-MM-DD" };
    expect(date("journal/2026/10/2026-10-31.md", nested)).toBe("2026-10-31");
    expect(date("journal/2026-10-31.md", nested)).toBeNull();
  });
  test("literal text and words in the format", () => {
    expect(
      date("daily/Journal 2026-11-19.md", {
        folder: "daily",
        format: "[Journal] YYYY-MM-DD",
      })
    ).toBe("2026-11-19");
    expect(
      date("daily/Thursday, November 19, 2026.md", {
        folder: "daily",
        format: "dddd, MMMM D, YYYY",
      })
    ).toBe("2026-11-19");
  });
});

describe("todayNotePath", () => {
  test("in a folder", () =>
    expect(todayNotePath(S, d("2026-11-20"))).toBe("daily/2026-11-20.md"));
  test("at the root", () =>
    expect(
      todayNotePath({ folder: "", format: "YYYY-MM-DD" }, d("2026-11-20"))
    ).toBe("2026-11-20.md"));
  test("a format with folders in it", () =>
    expect(
      todayNotePath(
        { folder: "journal", format: "YYYY/MM/YYYY-MM-DD" },
        d("2026-11-20")
      )
    ).toBe("journal/2026/11/2026-11-20.md"));
});

describe("dailyNotes", () => {
  test("only daily notes, newest first", () => {
    const files = [
      "daily/2026-11-18.md",
      "daily/Ideas.md",
      "daily/2026-11-20.md",
      "Inbox.md",
      "daily/2026-11-19.md",
    ].map((path) => ({ path }));
    expect(dailyNotes(files, S, moment).map((n) => n.file.path)).toEqual([
      "daily/2026-11-20.md",
      "daily/2026-11-19.md",
      "daily/2026-11-18.md",
    ]);
  });
});

describe("previousDailyNote", () => {
  const prev = (paths, today = "2026-11-20") =>
    previousDailyNote(
      paths.map((path) => ({ path })),
      S,
      d(today),
      moment
    )?.path ?? null;

  test("the newest before today", () =>
    expect(
      prev(["daily/2026-11-17.md", "daily/2026-11-20.md", "daily/2026-11-19.md"])
    ).toBe("daily/2026-11-19.md"));
  test("skips future-dated notes", () =>
    expect(
      prev(["daily/2026-11-21.md", "daily/2026-11-20.md", "daily/2026-11-18.md"])
    ).toBe("daily/2026-11-18.md"));
  test("only today's note", () =>
    expect(prev(["daily/2026-11-20.md"])).toBeNull());
  test("a gap of several days", () =>
    expect(prev(["daily/2026-11-02.md", "daily/2026-11-20.md"])).toBe(
      "daily/2026-11-02.md"
    ));
  test("without today's note", () =>
    expect(prev(["daily/2026-11-19.md"])).toBe("daily/2026-11-19.md"));
});

describe("getDailyNoteSettings", () => {
  afterEach(() => vi.restoreAllMocks());

  const app = ({ daily, periodic } = {}) => ({
    plugins: {
      getPlugin: (id) => (id === "periodic-notes" ? periodic : undefined),
    },
    internalPlugins: {
      getPluginById: (id) => (id === "daily-notes" ? daily : undefined),
    },
  });

  test("Daily Notes options, cleaned", () =>
    expect(
      getDailyNoteSettings(
        app({
          daily: {
            instance: {
              options: {
                folder: " /daily/ ",
                format: "YYYY.MM.DD",
                template: " t/daily ",
              },
            },
          },
        })
      )
    ).toEqual({ folder: "daily", format: "YYYY.MM.DD", template: "t/daily" }));

  test("never configured", () => {
    const fresh = {
      folder: "",
      format: DEFAULT_DAILY_NOTE_FORMAT,
      template: "",
    };
    expect(DEFAULT_DAILY_NOTE_FORMAT).toBe("YYYY-MM-DD");
    expect(
      getDailyNoteSettings(app({ daily: { instance: { options: {} } } }))
    ).toEqual(fresh);
    expect(getDailyNoteSettings(app())).toEqual(fresh);
  });

  test("Periodic Notes with daily notes on wins", () =>
    expect(
      getDailyNoteSettings(
        app({
          daily: { instance: { options: { folder: "daily" } } },
          periodic: {
            settings: {
              daily: { enabled: true, folder: "journal", format: "YYYY/MM/DD" },
            },
          },
        })
      )
    ).toEqual({ folder: "journal", format: "YYYY/MM/DD", template: "" }));

  test("Periodic Notes with daily notes off is ignored", () =>
    expect(
      getDailyNoteSettings(
        app({
          daily: { instance: { options: { folder: "daily" } } },
          periodic: { settings: { daily: { enabled: false, folder: "journal" } } },
        })
      ).folder
    ).toBe("daily"));

  test("null when reading throws", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(
      getDailyNoteSettings({
        plugins: {
          getPlugin: () => {
            throw new Error("boom");
          },
        },
      })
    ).toBeNull();
    expect(info).toHaveBeenCalled();
  });
});

describe("isDailyNotesEnabled", () => {
  test.each([
    [{ enabled: true }, undefined, true],
    [{ enabled: false }, undefined, false],
    [undefined, { settings: { daily: { enabled: true } } }, true],
    [undefined, undefined, false],
  ])("daily-notes %j, periodic %j → %j", (daily, periodic, out) =>
    expect(
      isDailyNotesEnabled({
        internalPlugins: { plugins: { "daily-notes": daily } },
        plugins: { getPlugin: () => periodic },
      })
    ).toBe(out)
  );
});
