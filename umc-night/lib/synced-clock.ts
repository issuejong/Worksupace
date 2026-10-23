export interface ClockSample { serverReceivedAt: number; serverSentAt: number; serverUncertaintyMs: number; }

export class SyncedClock {
  private samples: { midpoint: number; epoch: number; uncertainty: number; at: number }[] = [];
  private best: typeof this.samples[number] | null = null;
  add(sample: ClockSample, sent: number, received: number): boolean {
    const processing = sample.serverSentAt - sample.serverReceivedAt;
    const network = received - sent - processing;
    if (![...Object.values(sample), sent, received].every(Number.isFinite) || processing < 0 || network < -2 || received < sent || sample.serverUncertaintyMs < 0) return false;
    this.samples = this.samples.filter(value => received - value.at < 60_000);
    this.samples.push({ midpoint: (sent + received) / 2, epoch: (sample.serverReceivedAt + sample.serverSentAt) / 2, uncertainty: Math.max(0, network) / 2 + sample.serverUncertaintyMs, at: received });
    this.samples = this.samples.slice(-12);
    this.best = this.samples.reduce((best, value) => value.uncertainty <= best.uncertainty ? value : best);
    return true;
  }
  get ready() { return this.best !== null; }
  get uncertaintyMs() { return this.best?.uncertainty ?? Infinity; }
  now(monotonic: number): number { return this.best ? this.best.epoch + monotonic - this.best.midpoint : Date.now(); }
}
