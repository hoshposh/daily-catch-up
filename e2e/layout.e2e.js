// The review dialog at phone width, with screenshots in both themes for a
// person to look at (checklist check 7). Screenshots never fail a test.
import { afterEach, expect, test } from "vitest";
import {
  evalJs,
  evalJson,
  screenshot,
  setViewportWidth,
  waitFor,
} from "./helpers/obsidian";
import {
  horizontalOverflow,
  pressEscape,
  runCommand,
  waitForIdle,
  waitForReview,
} from "./helpers/rollover";
import {
  CHECKLIST_PROFILE,
  expectNoErrors,
  reset,
  standardNotes,
} from "./helpers/vault";

afterEach(expectNoErrors);

test("horizontalOverflow sees content wider than its box", async () => {
  await reset({ notes: standardNotes() });
  await evalJs(`(() => {
    const box = document.body.createDiv({ cls: 'e2e-overflow-probe' });
    box.style.cssText = 'position: fixed; top: 0; left: 0; width: 100px; overflow: auto;';
    box.createDiv({ text: 'x'.repeat(200) }).style.whiteSpace = 'nowrap';
    return true;
  })()`);
  expect(await horizontalOverflow(".e2e-overflow-probe")).toBeGreaterThan(0);
  await evalJs("document.querySelector('.e2e-overflow-probe').remove(); true");
});

test("review dialog fits a phone", async () => {
  await reset({
    notes: standardNotes({ withToday: true }),
    settings: { ...CHECKLIST_PROFILE, reviewOnAutoRollover: "always" },
  });
  await setViewportWidth(375);
  expect(await evalJson("innerWidth")).toBe(375);

  await runCommand("review-and-rollover");
  await waitForReview();
  expect(await horizontalOverflow(".modal")).toBe(0);
  await screenshot("review-phone-light");

  await evalJs("app.changeTheme('obsidian')");
  await waitFor(
    async () => evalJson("document.body.classList.contains('theme-dark')"),
    { message: "the dark theme" }
  );
  await screenshot("review-phone-dark");

  await pressEscape();
  await waitForIdle();
});
