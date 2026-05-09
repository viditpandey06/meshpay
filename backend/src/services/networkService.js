import { randomUUID } from 'node:crypto';

export class NetworkService {
  constructor({ store, cryptoService, emit }) {
    this.store = store;
    this.crypto = cryptoService;
    this.emit = emit;
    this.resetDevices();
  }

  resetDevices() {
    this.devices = new Map([
      ['phone-alice', { deviceId: 'phone-alice', hasInternet: false, packets: new Map() }],
      ['phone-relay-1', { deviceId: 'phone-relay-1', hasInternet: false, packets: new Map() }],
      ['phone-relay-2', { deviceId: 'phone-relay-2', hasInternet: false, packets: new Map() }],
      ['phone-bridge-1', { deviceId: 'phone-bridge-1', hasInternet: true, packets: new Map() }],
      ['phone-bridge-2', { deviceId: 'phone-bridge-2', hasInternet: true, packets: new Map() }]
    ]);
  }

  async createPayment({ senderVpa, receiverVpa, amount, pin, ttl = 5, startDevice = 'phone-alice' }) {
    if (senderVpa === receiverVpa) {
      throw new Error('sender_and_receiver_must_be_different');
    }

    const instruction = {
      senderVpa,
      receiverVpa,
      amount: Number(amount),
      pinHash: this.crypto.pinHash(pin),
      nonce: randomUUID(),
      signedAt: Date.now()
    };

    const ciphertext = this.crypto.encrypt(instruction);
    const packet = {
      packetId: randomUUID(),
      ttl: Number(ttl),
      createdAt: Date.now(),
      ciphertext,
      senderVpa,
      receiverVpa,
      amount: Number(amount),
      status: 'IN_MESH'
    };

    await this.store.upsertPacket(packet);
    await this.inject(startDevice, packet);
    return packet;
  }

  async inject(deviceId, packet) {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`unknown_device:${deviceId}`);

    device.packets.set(packet.packetId, { ...packet });
    await this.store.addEvent({
      packetId: packet.packetId,
      type: 'INJECTED',
      deviceId,
      message: `Packet injected at ${deviceId}`
    });
    this.emit('mesh:event', { type: 'INJECTED', packetId: packet.packetId, deviceId });
  }

  async gossipOnce() {
    let transfers = 0;
    const snapshot = [...this.devices.values()].map((device) => ({
      deviceId: device.deviceId,
      packets: [...device.packets.values()].map((packet) => ({ ...packet }))
    }));

    for (const source of snapshot) {
      for (const packet of source.packets) {
        if (packet.ttl <= 0) continue;

        for (const target of this.devices.values()) {
          if (target.deviceId === source.deviceId) continue;
          if (target.packets.has(packet.packetId)) continue;

          const copy = { ...packet, ttl: packet.ttl - 1 };
          target.packets.set(packet.packetId, copy);
          transfers += 1;

          await this.store.addEvent({
            packetId: packet.packetId,
            type: 'HOP',
            fromDeviceId: source.deviceId,
            toDeviceId: target.deviceId,
            deviceId: target.deviceId,
            message: `${source.deviceId} -> ${target.deviceId}`
          });
        }
      }
    }

    this.emit('mesh:event', { type: 'GOSSIP_ROUND', transfers });
    return { transfers, deviceCounts: this.deviceCounts() };
  }

  collectBridgeUploads() {
    const uploads = [];
    for (const device of this.devices.values()) {
      if (!device.hasInternet) continue;
      for (const packet of device.packets.values()) {
        uploads.push({ bridgeNodeId: device.deviceId, packet: { ...packet } });
      }
    }
    return uploads;
  }

  deviceCounts() {
    return Object.fromEntries([...this.devices.values()].map((device) => [
      device.deviceId,
      device.packets.size
    ]));
  }

  snapshot() {
    return [...this.devices.values()].map((device) => ({
      deviceId: device.deviceId,
      hasInternet: device.hasInternet,
      packetCount: device.packets.size,
      packetIds: [...device.packets.keys()]
    }));
  }
}
