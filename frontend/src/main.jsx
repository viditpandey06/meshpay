import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import {
  Activity,
  AlertTriangle,
  Database,
  GitBranch,
  Play,
  Radio,
  RefreshCcw,
  RotateCcw,
  SquarePlus,
  Send,
  ShieldCheck
} from 'lucide-react';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) throw new Error((await response.json()).error || response.statusText);
  return response.json();
}

function App() {
  const [state, setState] = useState(null);
  const [health, setHealth] = useState(null);
  const [events, setEvents] = useState([]);
  const [notice, setNotice] = useState({ type: 'info', text: 'Connected to the MeshPay demo runtime.' });
  const [busyAction, setBusyAction] = useState('');
  const [form, setForm] = useState({
    senderVpa: 'alice@demo',
    receiverVpa: 'bob@demo',
    amount: 500,
    pin: '1234',
    ttl: 5
  });

  const refresh = async () => {
    const [nextState, nextHealth] = await Promise.all([
      api('/api/state'),
      api('/api/health')
    ]);
    setState(nextState);
    setHealth(nextHealth);
  };

  useEffect(() => {
    refresh().catch((error) => {
      setNotice({ type: 'error', text: `Backend is not reachable: ${error.message}` });
    });
    const socket = io(API_URL);
    socket.on('mesh:event', (event) => {
      setEvents((current) => [event, ...current].slice(0, 40));
      refresh();
    });
    return () => socket.close();
  }, []);

  const selectedPacket = state?.packets?.[0];
  const selectedPath = useMemo(() => {
    if (!state || !selectedPacket) return [];
    return state.events
      .filter((event) => event.packetId === selectedPacket.packetId)
      .slice()
      .reverse();
  }, [state, selectedPacket]);

  const flow = useMemo(() => {
    const packets = state?.packets || [];
    const devices = state?.devices || [];
    const bridgeHasPacket = devices.some((device) => device.hasInternet && device.packetCount > 0);
    const processed = packets.some((packet) => ['SETTLED', 'REJECTED', 'DLQ', 'DUPLICATE_DROPPED'].includes(packet.status));
    const hasPacket = packets.length > 0;

    return {
      canInject: !hasPacket && !processed,
      canGossip: hasPacket && !bridgeHasPacket && !processed,
      canBridgeProcess: bridgeHasPacket && !processed,
      isComplete: processed,
      stepText: !hasPacket
        ? 'Step 1: inject an encrypted packet into the sender phone.'
        : bridgeHasPacket
          ? processed
            ? 'Run complete. Reset to start a new simulation.'
            : 'Step 3: flush bridge nodes or tamper with the packet.'
          : 'Step 2: gossip the packet to nearby phones.'
    };
  }, [state]);

  const runAction = async (name, action, successText) => {
    setBusyAction(name);
    setNotice({ type: 'info', text: `${successText}...` });
    try {
      await action();
      await refresh();
      setNotice({ type: 'success', text: successText });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setBusyAction('');
    }
  };

  const submitPayment = () => runAction(
    'inject',
    () => {
      if (form.senderVpa === form.receiverVpa) {
        throw new Error('Sender and receiver must be different.');
      }
      return api('/api/payments', { method: 'POST', body: JSON.stringify(form) });
    },
    'Encrypted packet is now waiting inside phone-alice. Run Gossip so bridge nodes can receive it.'
  );

  const gossip = () => runAction(
    'gossip',
    () => api('/api/mesh/gossip', { method: 'POST' }),
    'Gossip round completed'
  );

  const flush = () => runAction(
    'flush',
    () => api('/api/mesh/flush', { method: 'POST' }),
    'Bridge upload completed. Rejected payments appear in the transaction table.'
  );

  const tamper = () => runAction(
    'tamper',
    () => api('/api/dev/tamper-first-packet', { method: 'POST' }),
    'Tampered packet sent to DLQ path'
  );

  const reset = () => runAction(
    'reset',
    async () => {
      await api('/api/mesh/reset', { method: 'POST' });
      setEvents([]);
    },
    'Hard reset complete. Balances and ledger restored to demo seed values.'
  );

  const newRun = () => runAction(
    'new-run',
    async () => {
      await api('/api/mesh/new-run', { method: 'POST' });
      setEvents([]);
    },
    'Ready for the next transaction. Balances and ledger were kept.'
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Secure Offline Payment Routing</p>
          <h1>MeshPay</h1>
        </div>
        <div className="health-strip">
          <StatusPill icon={<Database size={15} />} label={health?.store || 'store'} />
          <StatusPill icon={<GitBranch size={15} />} label={health?.queue || 'queue'} />
          <StatusPill icon={<ShieldCheck size={15} />} label={health?.redis ? 'Redis idempotency' : 'memory idempotency'} />
        </div>
      </header>

      <section className="command-band">
        <div className="compose-panel">
          <label>
            Sender
            <select value={form.senderVpa} onChange={(event) => {
              const senderVpa = event.target.value;
              const receiverVpa = senderVpa === form.receiverVpa
                ? ['bob@demo', 'carol@demo', 'alice@demo', 'dave@demo'].find((vpa) => vpa !== senderVpa)
                : form.receiverVpa;
              setForm({ ...form, senderVpa, receiverVpa });
            }}>
              <option>alice@demo</option>
              <option>bob@demo</option>
              <option>carol@demo</option>
            </select>
          </label>
          <label>
            Receiver
            <select value={form.receiverVpa} onChange={(event) => setForm({ ...form, receiverVpa: event.target.value })}>
              {['bob@demo', 'carol@demo', 'alice@demo', 'dave@demo'].map((vpa) => (
                <option key={vpa} disabled={vpa === form.senderVpa}>{vpa}</option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })} />
          </label>
          <label>
            TTL
            <input type="number" value={form.ttl} min="1" max="9" onChange={(event) => setForm({ ...form, ttl: Number(event.target.value) })} />
          </label>
          <button onClick={submitPayment} title="Create encrypted packet" disabled={Boolean(busyAction) || !flow.canInject}>
            <Send size={17} /> {busyAction === 'inject' ? 'Injecting' : 'Inject'}
          </button>
        </div>
        <div className="control-panel">
          <div className="button-row primary-actions">
            <button className="secondary" onClick={gossip} title="Run one gossip round" disabled={Boolean(busyAction) || !flow.canGossip}>
              <RefreshCcw size={17} /> {busyAction === 'gossip' ? 'Running' : 'Gossip'}
            </button>
            <button className="secondary" onClick={flush} title="Upload from bridge nodes" disabled={Boolean(busyAction) || !flow.canBridgeProcess}>
              <Radio size={17} /> {busyAction === 'flush' ? 'Flushing' : 'Flush Bridges'}
            </button>
            <button className="warning" onClick={tamper} title="Force an invalid packet into the DLQ" disabled={Boolean(busyAction) || !flow.canBridgeProcess}>
              <AlertTriangle size={17} /> {busyAction === 'tamper' ? 'Sending' : 'Tamper'}
            </button>
          </div>
          <div className="button-row reset-actions">
            <button
              className={flow.isComplete ? 'new-run-cta' : 'ghost'}
              onClick={newRun}
              title="Clear the active packet and continue with current balances"
              disabled={Boolean(busyAction) || (!flow.isComplete && !state?.packets?.length)}
            >
              <SquarePlus size={17} /> {busyAction === 'new-run' ? 'Preparing' : 'New Transaction'}
            </button>
            <button
              className="ghost"
              onClick={reset}
              title="Restore original demo balances and clear all records"
              disabled={Boolean(busyAction)}
            >
              <RotateCcw size={17} /> {busyAction === 'reset' ? 'Resetting' : 'Hard Reset'}
            </button>
          </div>
        </div>
      </section>

      <div className={`notice ${notice.type}`}>{notice.text}</div>
      <div className="step-guide">{flow.stepText}</div>

      <section className="metrics-grid">
        <Metric label="Packets" value={state?.packets?.length || 0} />
        <Metric label="Settled" value={state?.transactions?.filter((tx) => tx.status === 'SETTLED').length || 0} />
        <Metric label="DLQ" value={state?.dlq?.length || 0} />
        <Metric label="Idempotency Keys" value={state?.idempotencyCacheSize || 0} />
      </section>

      <section className="main-grid">
        <section className="surface network-surface">
          <SectionTitle icon={<Radio size={18} />} title="Mesh Devices" />
          <div className="legend-row">
            <span><i className="legend offline" /> Offline carrier</span>
            <span><i className="legend bridge" /> Bridge node with internet</span>
          </div>
          <NetworkMap devices={state?.devices || []} />
        </section>

        <section className="surface path-surface">
          <SectionTitle icon={<GitBranch size={18} />} title="Packet Propagation" />
          <PacketPath packet={selectedPacket} events={selectedPath} />
        </section>

        <section className="surface">
          <SectionTitle icon={<Activity size={18} />} title="Live Events" />
          <EventStream events={events.length ? events : state?.events || []} />
        </section>
      </section>

      <section className="tables-grid">
        <DataTable title="Accounts" columns={['VPA', 'Holder', 'Balance']} rows={(state?.accounts || []).map((a) => [a.vpa, a.holderName, `Rs ${a.balance.toFixed(2)}`])} />
        <DataTable title="Transactions" columns={['Status', 'From', 'To', 'Amount', 'Bridge']} rows={(state?.transactions || []).map((tx) => [tx.status, tx.senderVpa, tx.receiverVpa, `Rs ${tx.amount.toFixed(2)}`, tx.bridgeNodeId])} statusColumn />
        <DataTable title="Dead Letter Queue" columns={['Packet', 'Reason', 'Bridge']} rows={(state?.dlq || []).map((row) => [short(row.packetId), row.reason, row.bridgeNodeId])} />
      </section>
    </main>
  );
}

function StatusPill({ icon, label }) {
  return <span className="status-pill">{icon}{label}</span>;
}

function SectionTitle({ icon, title }) {
  return <h2>{icon}{title}</h2>;
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NetworkMap({ devices }) {
  return (
    <div className="network-map">
      {devices.map((device) => (
        <div key={device.deviceId} className={`device-node ${device.hasInternet ? 'bridge' : ''}`}>
          <Radio size={18} />
          <strong>{device.deviceId}</strong>
          <span>{device.hasInternet ? 'Bridge' : 'Offline'} | {device.packetCount} packets</span>
        </div>
      ))}
    </div>
  );
}

function PacketPath({ packet, events }) {
  if (!packet) return <div className="empty-state"><Play size={18} /> Inject a packet to see its route.</div>;

  return (
    <div className="path-list">
      <div className={`packet-banner status-${packet.status}`}>{short(packet.packetId)} | {packet.status}</div>
      <p className="trace-note">
        This trace shows every broadcast event for the packet, so one source can appear multiple times when it shares the packet with several nearby devices.
      </p>
      {events.map((event) => (
        <div key={`${event.at}-${event.type}-${event.deviceId}`} className="path-step">
          <span className="dot" />
          <div>
            <strong>{event.type}</strong>
            <p>{event.message || event.deviceId || event.toDeviceId}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EventStream({ events }) {
  if (!events.length) return <div className="empty-state"><Activity size={18} /> Waiting for events.</div>;
  return (
    <div className="event-stream">
      {events.map((event, index) => (
        <div key={`${event.at}-${event.type}-${index}`}>
          <strong>{event.type}</strong>
          <span>{event.packetId ? short(event.packetId) : ''} {event.reason || event.message || ''}</span>
        </div>
      ))}
    </div>
  );
}

function DataTable({ title, columns, rows, statusColumn = false }) {
  return (
    <section className="surface table-surface">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => (
              <td key={cellIndex} className={statusColumn && cellIndex === 0 ? `table-status status-text-${cell}` : ''}>
                {cell}
              </td>
            ))}</tr>
          )) : <tr><td colSpan={columns.length}>No records yet</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function short(value = '') {
  return value.slice(0, 8);
}

createRoot(document.getElementById('root')).render(<App />);
