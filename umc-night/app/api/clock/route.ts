import { databaseClockSample } from "../../../lib/server/clock";
import { errorResponse, noStore } from "../../../lib/server/errors";

export const runtime = "nodejs";
export async function GET() {
  const received = performance.now();
  try { return noStore(await databaseClockSample(received)); }
  catch (error) { return errorResponse(error); }
}
