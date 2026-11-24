import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = process.argv[2];
const get = (path) => import(pathToFileURL(`${root}/src/${path}`).href);
const [{ RaceClient }, { controls, DEFAULT_OPTIONS }, { emptyCarState, CAR_FLAG }, { EventLoop }, { encodeControl, encodeSnapshot }, { sessionIdentity }] = await Promise.all([
  get('net/client.ts'), get('simulation/config.ts'), get('net/snapshot.ts'), get('net/event-loop.ts'), get('net/codec.ts'), get('core/session-identity.ts'),
]);
const input = (tick) => ({ ...controls(), throttle: (Math.floor(tick / 17) % 11) / 10, brake: tick % 101 > 80 ? .25 : 0, steer: Math.sin(tick * .001) * .25 });
const state = (tick) => ({ ...emptyCarState(), flags: CAR_FLAG.FULL | (tick % 102 === 0 ? CAR_FLAG.CONTACT : 0), x: 5 * Math.sin(tick * .001), z: tick * .1, qy: Math.sin(tick * .0001), qw: Math.cos(tick * .0001), vx: Math.cos(tick * .001) * .6, vz: 12, wy: .024, ax: -Math.sin(tick * .001) * .072 });
const results = [];
for (const scenario of ['healthy', 'stale-ack', 'outage', 'jitter-loss']) {
  const hash = createHash('sha256');
  const record = (value) => hash.update(JSON.stringify(value) + '\n');
  const loop = new EventLoop();
  const options = { ...DEFAULT_OPTIONS, mode: 'race', opponents: 0, vehicles: ['apx01'], grid: [0], seed: 731 };
  const transport = { label: scenario, open: true, onMessage: null, onClose: null, send(data, channel) { record({ channel, bytes: Array.from(data) }); }, close() {} };
  const client = new RaceClient({ loop, transport, advertised: options, name: 'Retention', vehicle: 'apx01', input: ({ tick }) => input(tick), onRender: record });
  client.player = 'guest:retention';
  transport.onMessage(encodeControl({ kind: 'grid', options, identity: sessionIdentity(options), car: 0, startTick: 0, serverTick: 0, startInMs: 0, entries: [{ car: 0, player: client.player, name: 'Retention', vehicle: 'apx01' }] }), 'reliable');
  let maximum = 0;
  const snapshot = (tick, ack) => transport.onMessage(encodeSnapshot({ tick, phase: 1, raceTime: tick / 120, ackSeq: ack, slack: 127, missing: 0, echo: 0, hold: 0, cars: [state(tick)] }), 'unreliable');
  snapshot(0, -1);
  const stop = loop.every(50, () => {
    maximum = Math.max(maximum, client.commands.size);
    const tick = Math.round(loop.now / (1000 / 120));
    if (scenario === 'outage' && loop.now >= 2000 && loop.now < 10000) return;
    const n = tick / 6;
    if (scenario === 'jitter-loss' && n % 7 === 3) return;
    const ack = scenario === 'healthy' ? client.commands.nextSeq - 1 : -1;
    if (scenario === 'jitter-loss') loop.after([5, 80, 20, 135][n % 4], () => snapshot(tick, ack));
    else snapshot(tick, ack);
  }, 50);
  loop.at(5000, () => { client.lead = 120; });
  loop.at(12000, () => { client.lead = 2; });
  loop.at(20000, () => { client.lead = 75; });
  loop.runUntil(30000);
  stop();
  client.dispose();
  record({ commands: client.stats.commands, copies: client.stats.commandCopies, snapshots: client.stats.snapshots, late: client.stats.lateSnapshots, lead: client.lead, pose: client.predictor.render(loop.now), predicted: client.predictor.predictedAt(client.predictor.tick), observed: client.predictor.model.observations });
  results.push({ scenario, sha256: hash.digest('hex'), commands: client.stats.commands, maximumHistory: maximum, finalHistory: client.commands.size });
}
console.log(JSON.stringify({ root, results }));
