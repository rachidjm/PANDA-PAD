import { test } from "node:test";
import assert from "node:assert/strict";
import { phantomBrowseUrl } from "./phantom-link";

test("phantomBrowseUrl: wraps the current page in Phantom's browse link, with the origin as ref", () => {
  assert.equal(
    phantomBrowseUrl("https://panda-pad.vercel.app/discover", "https://panda-pad.vercel.app"),
    "https://phantom.app/ul/browse/https%3A%2F%2Fpanda-pad.vercel.app%2Fdiscover?ref=https%3A%2F%2Fpanda-pad.vercel.app"
  );
});

test("phantomBrowseUrl: a typed recruiter code travels in the URL so the in-app browser still has it", () => {
  const url = phantomBrowseUrl("https://panda-pad.vercel.app/?ref=abc", "https://panda-pad.vercel.app", "rachid");
  const inner = decodeURIComponent(url.split("/ul/browse/")[1].split("?ref=")[0]);
  assert.equal(inner, "https://panda-pad.vercel.app/?ref=abc&code=rachid");
});

test("phantomBrowseUrl: no code, no code param", () => {
  const url = phantomBrowseUrl("https://panda-pad.vercel.app/", "https://panda-pad.vercel.app", null);
  assert.ok(!decodeURIComponent(url).includes("code="));
});
