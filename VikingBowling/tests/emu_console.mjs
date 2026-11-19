// The Android emulator's console (telnet localhost:5554): sensor values for tests/motion_android.mjs.
//   const emu = await emuConsole(); await emu.cmd('sensor set gyroscope 0:1:0'); emu.close();
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export async function emuConsole(port = 5554) {
  const token = readFileSync(join(homedir(), '.emulator_console_auth_token'), 'utf8').trim();
  const sock = net.connect(port, '127.0.0.1');
  sock.setNoDelay(true);
  let buf = '';
  const waiters = [];
  sock.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.search(/\r?\n/)) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(buf[i] === '\r' ? i + 2 : i + 1);
      if (/^(OK|KO)/.test(line) && waiters.length) waiters.shift()(line);
    }
  });
  await new Promise((r, j) => { sock.once('connect', r); sock.once('error', j); });
  const cmd = (c) => new Promise((r) => { waiters.push(r); sock.write(c + '\n'); });
  await new Promise((r) => setTimeout(r, 300));     // the banner ends with OK
  waiters.length = 0; buf = '';
  const auth = await cmd('auth ' + token);
  if (!/^OK/.test(auth)) throw new Error('emulator console auth: ' + auth);
  return { cmd, close: () => sock.end() };
}
