import { expect, it } from "vitest";
import { readSection, sectionHref } from "./workspace-navigation";

it("restores a section from a root URL and defaults unknown destinations to Overview", () => {
  expect(readSection("?section=lessons")).toBe("Lessons");
  expect(readSection("?section=connections")).toBe("Connections");
  expect(readSection(sectionHref("Settings").split("?")[1])).toBe("Settings");
  expect(readSection("?section=unknown")).toBe("Overview");
  expect(readSection("")).toBe("Overview");

  const url = new URL(sectionHref("Lessons"), "https://app.localhost");
  expect(url.pathname).toBe("/");
  expect(readSection(url.search)).toBe("Lessons");
  expect(sectionHref("Overview")).toBe("/");
});
