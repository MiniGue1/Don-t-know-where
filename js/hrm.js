// Live heart rate from a watch or chest strap over Bluetooth (standard Heart Rate service).
// Garmin watches: enable "Broadcast Heart Rate" (or "Virtual Run"/HR broadcast) on the watch.
// Web Bluetooth works in Chrome/Edge on Android and desktop; iOS Safari doesn't support it.

export const hrmSupported = () => typeof navigator !== "undefined" && !!navigator.bluetooth;

/** Parse a Heart Rate Measurement characteristic value (DataView). */
export function parseHeartRate(dv) {
  const flags = dv.getUint8(0);
  return flags & 0x1 ? dv.getUint16(1, true) : dv.getUint8(1);
}

export async function connectHrm(onBpm, onDisconnect) {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: ["heart_rate"] }],
    optionalServices: ["battery_service"],
  });
  device.addEventListener("gattserverdisconnected", () => onDisconnect?.());
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService("heart_rate");
  const ch = await service.getCharacteristic("heart_rate_measurement");
  ch.addEventListener("characteristicvaluechanged", (e) => {
    const bpm = parseHeartRate(e.target.value);
    if (bpm > 0) onBpm(bpm);
  });
  await ch.startNotifications();
  return {
    name: device.name || "Heart rate sensor",
    disconnect: () => device.gatt.connected && device.gatt.disconnect(),
  };
}
