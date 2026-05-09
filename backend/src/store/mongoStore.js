import mongoose from 'mongoose';
import { MemoryStore, seedAccounts } from './memoryStore.js';

const accountSchema = new mongoose.Schema({
  vpa: { type: String, unique: true },
  holderName: String,
  balance: Number
}, { timestamps: true });

const packetSchema = new mongoose.Schema({
  packetId: { type: String, unique: true },
  packetHash: String,
  ciphertext: String,
  ttl: Number,
  senderVpa: String,
  receiverVpa: String,
  amount: Number,
  status: String,
  createdAt: Number,
  updatedAt: Number
});

const eventSchema = new mongoose.Schema({
  packetId: String,
  type: String,
  deviceId: String,
  fromDeviceId: String,
  toDeviceId: String,
  message: String,
  at: Number
});

const transactionSchema = new mongoose.Schema({
  packetHash: { type: String, unique: true },
  senderVpa: String,
  receiverVpa: String,
  amount: Number,
  signedAt: Number,
  settledAt: Number,
  bridgeNodeId: String,
  hopCount: Number,
  status: String
});

const dlqSchema = new mongoose.Schema({
  packetId: String,
  packetHash: String,
  bridgeNodeId: String,
  reason: String,
  attempts: Number,
  failedAt: Number,
  ciphertextPreview: String
});

export class MongoStore extends MemoryStore {
  constructor() {
    super();
    this.Account = mongoose.model('Account', accountSchema);
    this.Packet = mongoose.model('Packet', packetSchema);
    this.PacketEvent = mongoose.model('PacketEvent', eventSchema);
    this.Transaction = mongoose.model('Transaction', transactionSchema);
    this.DlqPacket = mongoose.model('DlqPacket', dlqSchema);
  }

  async reset() {
    if (!this.Account) return super.reset();

    await Promise.all([
      this.Account.deleteMany({}),
      this.Packet.deleteMany({}),
      this.PacketEvent.deleteMany({}),
      this.Transaction.deleteMany({}),
      this.DlqPacket.deleteMany({})
    ]);

    await this.Account.insertMany(seedAccounts());
  }

  async ensureSeedData() {
    const accountCount = await this.Account.countDocuments();
    if (accountCount === 0) {
      await this.Account.insertMany(seedAccounts());
    }
  }

  async clearActiveRun() {
    await Promise.all([
      this.Packet.deleteMany({}),
      this.PacketEvent.deleteMany({})
    ]);
  }

  async upsertPacket(packet) {
    return this.Packet.findOneAndUpdate(
      { packetId: packet.packetId },
      { $set: { ...packet, updatedAt: Date.now() } },
      { upsert: true, new: true, lean: true }
    );
  }

  async addEvent(event) {
    return this.PacketEvent.create({ at: Date.now(), ...event });
  }

  async createTransaction(transaction) {
    return this.Transaction.create({ settledAt: Date.now(), ...transaction });
  }

  async addDlqPacket(record) {
    return this.DlqPacket.create({ failedAt: Date.now(), ...record });
  }

  async settle({ instruction, packetHash, bridgeNodeId, hopCount }) {
    const amount = Number(instruction.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('invalid_amount');

    const sender = await this.Account.findOne({ vpa: instruction.senderVpa });
    const receiver = await this.Account.findOne({ vpa: instruction.receiverVpa });
    if (!sender) throw new Error(`unknown_sender:${instruction.senderVpa}`);
    if (!receiver) throw new Error(`unknown_receiver:${instruction.receiverVpa}`);

    const status = sender.vpa !== receiver.vpa && sender.balance >= amount ? 'SETTLED' : 'REJECTED';
    if (status === 'SETTLED') {
      sender.balance -= amount;
      receiver.balance += amount;
      await Promise.all([sender.save(), receiver.save()]);
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
    const [accounts, packets, transactions, dlq, events] = await Promise.all([
      this.Account.find({}).sort({ vpa: 1 }).lean(),
      this.Packet.find({}).sort({ createdAt: -1 }).lean(),
      this.Transaction.find({}).sort({ settledAt: -1 }).limit(40).lean(),
      this.DlqPacket.find({}).sort({ failedAt: -1 }).limit(40).lean(),
      this.PacketEvent.find({}).sort({ at: -1 }).limit(80).lean()
    ]);

    return { devices, idempotencyCacheSize: idempotencySize, accounts, packets, transactions, dlq, events };
  }
}

export async function createStore(mongoUri) {
  if (!mongoUri) return { store: new MemoryStore(), mode: 'memory' };

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2500 });
    const store = new MongoStore();
    await store.ensureSeedData();
    return { store, mode: 'mongo' };
  } catch (error) {
    console.warn(`[store] MongoDB unavailable, using memory store: ${error.message}`);
    return { store: new MemoryStore(), mode: 'memory' };
  }
}
