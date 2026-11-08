import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

const columns = [
  { header: "Name", value: (row: { name: string }) => row.name },
];

describe("toCsv", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(toCsv([{ name: 'DELA CRUZ, "MARIA"' }], columns)).toBe(
      'Name\r\n"DELA CRUZ, ""MARIA"""\r\n',
    );
  });

  it.each(["=1+1", "+63", "-5", "@cmd"])("stops %s being read as a formula", (name) => {
    expect(toCsv([{ name }], columns)).toBe(`Name\r\n'${name}\r\n`);
  });

  it("writes empty values as blank", () => {
    expect(toCsv([{ name: "" }], columns)).toBe("Name\r\n\r\n");
  });
});
