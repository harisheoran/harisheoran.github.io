// The truth the figure is built from. Every number the drawing shows comes from here.
//
// A 100-byte HTTP GET travelling over TLS, TCP, IPv4 and Ethernet II.
// `adds` is the bytes that layer puts on the wire -- head and tail.
// Layers 7, 5 and 1 add no bytes, and that is the point: a layer earns its
// place by doing a job, not by owning a header.

export const PAYLOAD = 100;            // bytes of HTTP request
export const U_PER_BYTE = 0.30;        // world units per byte

export const LAYERS = [
  { n: 7, name: "Application",  pdu: "Data",    head: 0,  tail: 0, act: "load",   note: "HTTP GET, the payload itself" },
  { n: 6, name: "Presentation", pdu: "Data",    head: 5,  tail: 0, act: "seal",   note: "TLS record header, and the payload goes opaque" },
  { n: 5, name: "Session",      pdu: "Data",    head: 0,  tail: 0, act: "latch",  note: "session state, nothing on the wire" },
  { n: 4, name: "Transport",    pdu: "Segment", head: 20, tail: 0, act: "ports",  note: "TCP header, source and destination port" },
  { n: 3, name: "Network",      pdu: "Packet",  head: 20, tail: 0, act: "ttl",    note: "IPv4 header, TTL set to 64" },
  { n: 2, name: "Data Link",    pdu: "Frame",   head: 14, tail: 4, act: "both",   note: "Ethernet header and the FCS trailer" },
  { n: 1, name: "Physical",     pdu: "Bits",    head: 0,  tail: 0, act: "send",   note: "line coding, no bytes of its own" },
];

// Running size after each station, in order of travel (7 -> 1).
export function sizeAfter(index) {
  let bytes = PAYLOAD;
  for (let i = 0; i <= index; i++) bytes += LAYERS[i].head + LAYERS[i].tail;
  return bytes;
}

export const FRAME_BYTES = sizeAfter(LAYERS.length - 1);   // 163
export const FRAME_BITS = FRAME_BYTES * 8;                 // 1304
