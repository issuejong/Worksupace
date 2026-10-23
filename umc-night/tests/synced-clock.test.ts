import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncedClock } from "../lib/synced-clock";

afterEach(() => vi.restoreAllMocks());
describe("shared database clock", () => {
  const epoch = 1_800_000_000_000;
  it("synchronizes devices with different local clock origins and ignores wall-clock changes", () => {
    const laptop = new SyncedClock(); const phone = new SyncedClock();
    const sample = {serverReceivedAt:epoch+20,serverSentAt:epoch+120,serverUncertaintyMs:2};
    laptop.add(sample,10_000,10_140); phone.add(sample,500,640);
    vi.spyOn(Date,"now").mockReturnValue(epoch+3_600_000);
    expect(laptop.now(10_140)).toBe(epoch+140);
    expect(phone.now(640)).toBe(laptop.now(10_140));
    expect(laptop.now(20_140)).toBe(epoch+10_140);
    expect(laptop.uncertaintyMs).toBe(22);
  });
  it("subtracts three seconds of server work instead of treating it as a clock offset", () => {
    const clock = new SyncedClock();
    clock.add({serverReceivedAt:epoch+10,serverSentAt:epoch+3010,serverUncertaintyMs:1},0,3020);
    expect(clock.now(3020)).toBe(epoch+3020);
    expect(clock.uncertaintyMs).toBe(11);
  });
  it("uses the most precise recent sample and expires old anchors", () => {
    const clock = new SyncedClock();
    clock.add({serverReceivedAt:epoch+90,serverSentAt:epoch+90,serverUncertaintyMs:0},0,100);
    clock.add({serverReceivedAt:epoch+205,serverSentAt:epoch+205,serverUncertaintyMs:0},200,210);
    expect(clock.now(300)).toBe(epoch+300);
    clock.add({serverReceivedAt:epoch+70_030,serverSentAt:epoch+70_030,serverUncertaintyMs:0},70_000,70_020);
    expect(clock.now(70_020)).toBe(epoch+70_040);
  });
  it("rejects invalid timing samples", () => {
    const clock = new SyncedClock();
    expect(clock.add({serverReceivedAt:NaN,serverSentAt:epoch,serverUncertaintyMs:0},0,100)).toBe(false);
    expect(clock.add({serverReceivedAt:epoch,serverSentAt:epoch+200,serverUncertaintyMs:0},0,100)).toBe(false);
    expect(clock.ready).toBe(false);
  });
});
