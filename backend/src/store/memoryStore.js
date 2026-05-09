export const seedAccounts = () => ([
  { vpa: 'alice@demo', holderName: 'Alice', balance: 5000 },
  { vpa: 'bob@demo', holderName: 'Bob', balance: 1000 },
  { vpa: 'carol@demo', holderName: 'Carol', balance: 2500 },
  { vpa: 'dave@demo', holderName: 'Dave', balance: 500 }
]);

export class MemoryStore {
  constructor() {
    this.reset();
  }

  async reset() {
    this.accounts = new Map(seedAccounts().map((account) => [account.vpa, { ...account }]));
    this.packets = new Map();
    this.events = [];
    this.transactions = [];
    this.dlq = [];
  }

  async clearActiveRun() {
    this.packets = new Map();
    this.events = [];
  }

  async upsertPacket(packet) {
    this.packets.set(packet.packetId, {
      ...this.packets.get(packet.packetId),
      ...packet,
      updatedAt: Date.now()
    });
    return this.packets.get(packet.packetId);
  }

  async addEvent(event) {
    const row = { id: this.events.length + 1, at: Date.now(), ...event };
    this.events.push(row);
    return row;
  }

  async createTransaction(transaction) {
    const row = { id: this.transactions.length + 1, settledAt: Date.now(), ...transaction };
    this.transactions.unshift(row);
    return row;
  }

  async addDlqPacket(record) {
    const row = { id: this.dlq.length + 1, failedAt: Date.now(), ...record };
    this.dlq.unshift(row);
    return row;
  }

  async settle({ instruction, packetHash, bridgeNodeId, hopCount }) {
    const sender = this.accounts.get(instruction.senderVpa);
    const receiver = this.accounts.get(instruction.receiverVpa);
    if (!sender) throw new Error(`unknown_sender:${instruction.senderVpa}`);
    if (!receiver) throw new Error(`unknown_receiver:${instruction.receiverVpa}`);

    const amount = Number(instruction.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('invalid_amount');

    const status = sender.vpa !== receiver.vpa && sender.balance >= amount ? 'SETTLED' : 'REJECTED';
    if (status === 'SETTLED') {
      sender.balance -= amount;
      receiver.balance += amount;
    }

    return this.createTransaction({
      packetHash,
      senderVpa: instruction.senderVpa,
      receiverVpa: instruction.receiverVpa,
      amount,
      signedAt: instruction.signedAt,
      bridgeNodeId,
      hopCount,
      status
    });
  }

  async getState({ devices, idempotencySize }) {
    return {
      devices,
      idempotencyCacheSize: idempotencySize,
      accounts: [...this.accounts.values()],
      packets: [...this.packets.values()].sort((a, b) => b.createdAt - a.createdAt),
      transactions: this.transactions,
      dlq: this.dlq,
      events: this.events.slice(-80).reverse()
    };
  }
}
