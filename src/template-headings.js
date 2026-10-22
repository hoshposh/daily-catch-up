// Pure helpers for the "Template heading" setting.

// Same pattern the plugin has always used to list headings in a template
export function extractHeadings(templateContents) {
  return Array.from(templateContents.matchAll(/#{1,} .*/g)).map(
    ([heading]) => heading
  );
}

// Dropdown options for the template heading. A saved heading that is no longer
// in the template stays selectable, so the dropdown shows what is really saved.
export function headingOptions(headings, savedHeading) {
  const options = {};
  for (const heading of headings) {
    options[heading] = heading;
  }
  if (savedHeading && savedHeading !== "none" && !(savedHeading in options)) {
    options[savedHeading] = savedHeading;
  }
  options.none = "None";
  return options;
}
