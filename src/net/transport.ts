import { UDP_IP_OVERHEAD_BYTES } from './constants.ts';
import { NetRandom, type EventLoop } from './event-loop.ts';

/** Two delivery classes. `unreliable` behaves like a datagram (may be lost,
 * duplicated or reordered); `reliable` is ordered and eventually delivered,
 * with head-of-line delay when a segment is lost (TCP/SCTP-like). A browser
 * build maps these onto WebRTC data channels; a WebSocket-only build would
 * carry both reliably and pay head-of-line blocking on inputs. */
export type Channel = 'reliable' | 'unreliable';

/** The only surface the client and server code use. Nothing in src/net
 * depends on the in-memory implementation below. */
export interface Transport {
  readonly label: string;
  readonly open: boolean;
  send(data: Uint8Array, channel: Channel): void;
  onMessage: ((data: Uint8Array, channel: Channel) => void) | null;
  onClose: ((reason: string) => void) | null;
  close(reason: string): void;
}

/** One direction of a simulated link. Times are one-way, in ms. */
export interface LinkConditions {
  latencyMs: number;
  /** Standard deviation of the per-packet delay variation. */
  jitterMs: number;
  /** Probability a datagram (or a reliable segment's first try) is lost. */
  loss: number;
  duplicate: number;
  /** Probability a datagram is held back long enough to arrive out of order. */
  reorder: number;
}
export const PERFECT_LINK: LinkConditions = Object.freeze({
  latencyMs: 0,
  jitterMs: 0,
  loss: 0,
  duplicate: 0,
  reorder: 0,
});
/** 100 ms round trip, 2% loss, modest jitter and reordering (the slice target). */
export const TARGET_LINK: LinkConditions = Object.freeze({
  latencyMs: 50,
  jitterMs: 4,
  loss: 0.02,
  duplicate: 0.005,
  reorder: 0.01,
});

const TIMING_FIELDS = ['latencyMs', 'jitterMs'] as const;
const PROBABILITY_FIELDS = ['loss', 'duplicate', 'reorder'] as const;
function validateConditions(c: LinkConditions) {
  for (const key of TIMING_FIELDS) {
    const value = c[key];
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid link timing');
  }
  for (const key of PROBABILITY_FIELDS) {
    const value = c[key];
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error('Invalid link probability');
  }
  if (!Number.isFinite(2 * c.latencyMs + 4 * c.jitterMs)) throw new Error('Invalid link timing');
}

/** Ordinary seeded sends retain their original synchronous lookahead. A long
 * loss streak continues on the simulated clock instead of blocking its caller. */
const RELIABLE_RETRY_BATCH = 64;
interface RetryPacket {
  data: Uint8Array;
  at: number;
  rto: number;
  next: RetryPacket | null;
}
interface DeferredReliable {
  first: RetryPacket | null;
  last: RetryPacket | null;
  timer: number | null;
  close: { at: number; reason: string } | null;
}

export interface DirectionStats {
  packets: number;
  payloadBytes: number;
  /** Payload plus per-datagram IP/UDP overhead. */
  wireBytes: number;
  reliablePayloadBytes: number;
  unreliablePayloadBytes: number;
  dropped: number;
  duplicated: number;
  reordered: number;
  retransmits: number;
  delivered: number;
}
const emptyStats = (): DirectionStats => ({
  packets: 0,
  payloadBytes: 0,
  wireBytes: 0,
  reliablePayloadBytes: 0,
  unreliablePayloadBytes: 0,
  dropped: 0,
  duplicated: 0,
  reordered: 0,
  retransmits: 0,
  delivered: 0,
});

class SimulatedEndpoint implements Transport {
  onMessage: ((data: Uint8Array, channel: Channel) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  peer!: SimulatedEndpoint;
  closed = false;
  /** Earliest time the next reliable message may be delivered (ordering). */
  reliableClock = 0;
  readonly stats = emptyStats();
  constructor(
    readonly label: string,
    private readonly link: SimulatedLink,
    public conditions: LinkConditions,
  ) {}
  get open() {
    return !this.closed;
  }
  send(data: Uint8Array, channel: Channel) {
    if (this.closed) return;
    this.link.transmit(this, data, channel);
  }
  close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.link.notifyClose(this, reason);
  }
}

/** A bidirectional link between one client and the server. */
export class SimulatedLink {
  readonly client: SimulatedEndpoint;
  readonly server: SimulatedEndpoint;
  private readonly deferred = new Map<SimulatedEndpoint, DeferredReliable>();
  /** A severed link silently loses everything (cable pulled, NAT expiry):
   * neither side is told, so only timeouts detect it. */
  severed = false;
  constructor(
    private readonly loop: EventLoop,
    private readonly random: NetRandom,
    up: LinkConditions,
    down: LinkConditions,
    label: string,
  ) {
    validateConditions(up);
    validateConditions(down);
    this.client = new SimulatedEndpoint(`${label}:client`, this, { ...up });
    this.server = new SimulatedEndpoint(`${label}:server`, this, { ...down });
    this.client.peer = this.server;
    this.server.peer = this.client;
  }
  get upStats() {
    return this.client.stats;
  }
  get downStats() {
    return this.server.stats;
  }
  sever() {
    this.severed = true;
    for (const from of this.deferred.keys()) this.retireReliable(from);
  }
  private delay(c: LinkConditions) {
    const delay = Math.max(c.latencyMs * 0.5, c.latencyMs + c.jitterMs * this.random.gaussian());
    if (!Number.isFinite(delay)) throw new Error('Invalid link delay');
    return delay;
  }
  transmit(from: SimulatedEndpoint, data: Uint8Array, channel: Channel) {
    validateConditions(from.conditions);
    const c = from.conditions,
      s = from.stats,
      copy = data.slice();
    s.packets++;
    s.payloadBytes += copy.length;
    s.wireBytes += copy.length + UDP_IP_OVERHEAD_BYTES;
    if (channel === 'reliable') s.reliablePayloadBytes += copy.length;
    else s.unreliablePayloadBytes += copy.length;
    if (this.severed) {
      s.dropped++;
      return;
    }
    const to = from.peer;
    if (channel === 'reliable') {
      const at = this.loop.now + this.delay(c);
      const rto = Math.max(200, 2 * c.latencyMs + 4 * c.jitterMs);
      const waiting = this.deferred.get(from);
      if (waiting) {
        const packet: RetryPacket = { data: copy, at, rto, next: null };
        waiting.last!.next = packet;
        waiting.last = packet;
        return;
      }
      const retryAt = this.tryReliable(from, copy, at, rto);
      if (retryAt !== null) {
        const packet: RetryPacket = { data: copy, at: retryAt, rto, next: null };
        const pending: DeferredReliable = { first: packet, last: packet, timer: null, close: null };
        this.deferred.set(from, pending);
        this.continueReliable(from, pending, retryAt);
      }
      return;
    }
    if (this.random.next() < c.loss) {
      s.dropped++;
      return;
    }
    let at = this.loop.now + this.delay(c);
    if (this.random.next() < c.reorder) {
      s.reordered++;
      at += 5 + this.random.next() * (2 * c.jitterMs + 30);
    }
    this.loop.at(at, () => this.deliver(from, to, copy, channel));
    if (this.random.next() < c.duplicate) {
      s.duplicated++;
      const again = this.loop.now + this.delay(c) + this.random.next() * 20;
      // The first receiver owns its delivered buffer and may reuse or mutate it.
      const duplicate = copy.slice();
      this.loop.at(again, () => this.deliver(from, to, duplicate, channel));
    }
  }
  /** Null means delivery was scheduled; otherwise continue at the next retry. */
  private tryReliable(from: SimulatedEndpoint, data: Uint8Array, at: number, rto: number) {
    if (!Number.isFinite(at)) throw new Error('Invalid reliable delivery time');
    for (let attempt = 0; attempt < RELIABLE_RETRY_BATCH; attempt++) {
      if (!(this.random.next() < from.conditions.loss)) {
        at = Math.max(at, from.reliableClock, this.loop.now);
        if (!Number.isFinite(at)) throw new Error('Invalid reliable delivery time');
        this.loop.at(at, () => this.deliver(from, from.peer, data, 'reliable'));
        from.reliableClock = at;
        return null;
      }
      from.stats.retransmits++;
      from.stats.wireBytes += data.length + UDP_IP_OVERHEAD_BYTES;
      const next = at + rto;
      if (!Number.isFinite(next) || next <= at)
        throw new Error('Reliable retry clock cannot advance');
      at = next;
    }
    return at;
  }
  private retireReliable(from: SimulatedEndpoint) {
    const pending = this.deferred.get(from);
    if (!pending) return;
    this.deferred.delete(from);
    if (pending.timer !== null) this.loop.cancel(pending.timer);
    pending.first = pending.last = null;
    pending.close = null;
  }
  private continueReliable(from: SimulatedEndpoint, pending: DeferredReliable, at: number) {
    pending.timer = this.loop.at(at, () => {
      if (this.deferred.get(from) !== pending) return;
      pending.timer = null;
      if (this.severed || from.peer.closed) {
        this.retireReliable(from);
        return;
      }
      const packet = pending.first!;
      try {
        validateConditions(from.conditions);
        const retryAt = this.tryReliable(
          from,
          packet.data,
          Math.max(packet.at, this.loop.now),
          packet.rto,
        );
        if (retryAt !== null) {
          packet.at = retryAt;
          this.continueReliable(from, pending, retryAt);
          return;
        }
        pending.first = packet.next;
        packet.next = null;
        if (pending.first) this.continueReliable(from, pending, this.loop.now);
        else {
          const close = pending.close;
          this.retireReliable(from);
          if (close) this.scheduleClose(from, close.reason, close.at);
        }
      } catch (error) {
        this.retireReliable(from);
        throw error;
      }
    });
  }
  private deliver(
    from: SimulatedEndpoint,
    to: SimulatedEndpoint,
    data: Uint8Array,
    channel: Channel,
  ) {
    // Data already in flight when the link is cut is lost too; data sent
    // before a graceful close still arrives (close follows it in order).
    if (this.severed || to.closed) return;
    from.stats.delivered++;
    to.onMessage?.(data, channel);
  }
  notifyClose(from: SimulatedEndpoint, reason: string) {
    // The opposite direction cannot deliver into this now-closed endpoint.
    this.retireReliable(from.peer);
    if (this.severed) return;
    const at = this.loop.now + this.delay(from.conditions);
    const pending = this.deferred.get(from);
    if (pending) {
      pending.close = { at, reason };
      return;
    }
    this.scheduleClose(from, reason, at);
  }
  private scheduleClose(from: SimulatedEndpoint, reason: string, at: number) {
    const to = from.peer;
    this.loop.at(Math.max(at, from.reliableClock, this.loop.now), () => {
      if (this.severed || to.closed) return;
      to.closed = true;
      to.onClose?.(reason);
    });
  }
}

/** In-memory network: hands out linked client/server transport pairs whose
 * deliveries are scheduled on the shared event loop with seeded conditions. */
export class NetworkSimulator {
  private readonly random: NetRandom;
  readonly links: SimulatedLink[] = [];
  constructor(
    private readonly loop: EventLoop,
    seed = 1,
  ) {
    this.random = new NetRandom(seed);
  }
  connect(up: LinkConditions, down: LinkConditions = up, label = `link${this.links.length}`) {
    const link = new SimulatedLink(this.loop, this.random, up, down, label);
    this.links.push(link);
    return { client: link.client as Transport, server: link.server as Transport, link };
  }
}
