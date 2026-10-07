// src/lib/nightHours.ts
// When the wall displays dim (see components/display/NightDim): 19:00 to
// 07:00 on the plant's clock, IST, whatever timezone the screen is set to.

const DIM_FROM = 19;   // 19:00
const DIM_TO   = 7;    // until 07:00

export function isNightHour(now: Date = new Date()): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(now)) % 24;
  return h >= DIM_FROM || h < DIM_TO;
}
