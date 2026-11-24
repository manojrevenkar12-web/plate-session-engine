import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { differing } from "../shared/format";
import PlateChip from "../shared/ui/PlateChip.vue";
import App from "./App.vue";

const data = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "data", "report.json"), "utf8"));
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

afterEach(() => vi.restoreAllMocks());

describe("App", () => {
  it("shows loading, then the development results with real cases", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => ok(data));
    const w = mount(App);
    expect(w.find("[role=status]").exists()).toBe(true);
    await flushPromises();
    expect(w.find("h1").text()).toContain("billed once");
    expect(w.text()).toMatch(/Release gates: 6 of 6 pass/);
    expect(w.findAll(".case").length).toBeGreaterThan(1);
  });

  it("explains a missing report and loads it again", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(new Response("", { status: 404 })))
      .mockImplementation(() => ok(data));
    const w = mount(App);
    await flushPromises();
    expect(w.find("[role=alert]").text()).toContain("HTTP 404");
    await w.find("[role=alert] button").trigger("click");
    await flushPromises();
    expect(w.find("h1").exists()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("says when the held-out car parks have not been run", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => ok({ ...data, heldout: null, lock: null }));
    const w = mount(App);
    await flushPromises();
    await w.findAll("[role=radio]")[1]!.trigger("click");
    expect(w.text()).toContain("The held-out car parks have not been run");
  });

  it("shows the held-out gates as they came out, failures included", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => ok(data));
    const w = mount(App);
    await flushPromises();
    await w.findAll("[role=radio]")[1]!.trigger("click");
    expect(w.text()).toMatch(/Release gates: 4 of 6 pass/);
    expect(w.text()).toContain("not run again");
    expect(w.text()).toContain("The held-out world ran before cases were recorded");
  });
});

describe("PlateChip", () => {
  it("marks the misread character, not everything after it", () => {
    expect(differing("MA81234", "MAB1234")).toEqual([false, false, true, false, false, false, false]);
    expect(differing("MAB124", "MAB1234")).toEqual([false, false, false, false, false, false]);
    const w = mount(PlateChip, { props: { plate: "EDDB20Y8", reference: "EDDB2088" } });
    expect(w.findAll(".off").map((x) => x.text())).toEqual(["Y"]);
    expect(w.attributes("aria-label")).toContain("misread");
  });
});
