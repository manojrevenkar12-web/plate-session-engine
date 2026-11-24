import { describe, expect, it } from "vitest";
import { PlateIndex, skeleton } from "./plate-index.js";

describe("PlateIndex", () => {
  it("finds lookalike, dropped-character and one-substitution neighbours", () => {
    const ix = new PlateIndex<string>();
    ix.add("a", ["MAB1234"]);
    ix.add("b", ["KXY77"]);
    expect(ix.query(["MA81234"])).toEqual(["a"]);
    expect(ix.query(["MAB124"])).toEqual(["a"]);
    expect(ix.query(["MAC1234"])).toEqual(["a"]);
    expect(ix.query(["ZZZ999"])).toEqual([]);
    ix.remove("a");
    expect(ix.query(["MAB1234"])).toEqual([]);
    expect(skeleton("OIBS")).toBe("0185");
  });
});
