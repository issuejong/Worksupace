import { db } from "./db";

// Both endpoint timestamps use the DB time domain used by game starts/deadlines.
// The DB round trip bounds calibration uncertainty; server work is excluded by
// the four-timestamp exchange on the client.
export async function databaseClockSample(received = performance.now()) {
  const began = performance.now();
  const rows = await db()`select extract(epoch from clock_timestamp())*1000 as epoch_ms`;
  const ended = performance.now();
  const epoch = Number(rows[0].epoch_ms);
  const midpoint = (began + ended) / 2;
  return { serverReceivedAt: epoch + received - midpoint, serverSentAt: epoch + performance.now() - midpoint, serverUncertaintyMs: (ended - began) / 2 };
}
