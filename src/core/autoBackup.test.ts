import { describe, expect, it } from "vitest";
import { AUTO_BACKUP_EVERY_MS, backupDue } from "./autoBackup";

describe("automatic backup schedule", () => {
  const now = 1_800_000_000_000;
  it("is due when it was never made", () => expect(backupDue(0, now)).toBe(true));
  it("is not due again within six hours", () => expect(backupDue(now - AUTO_BACKUP_EVERY_MS + 60_000, now)).toBe(false));
  it("is due after six hours", () => expect(backupDue(now - AUTO_BACKUP_EVERY_MS, now)).toBe(true));
  it("is due when the clock went backwards (date changed)", () => expect(backupDue(now + 60_000, now)).toBe(true));
  it("treats garbage as never made", () => expect(backupDue(Number("x"), now)).toBe(true));
});
