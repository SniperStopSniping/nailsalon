/** Actual Chromium compositor recording, preserving source frame timestamps. */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function beginScreenRecording(page, kind) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'luster-tutorial-frames-'));
  const output = `docs/tutorials/recordings/${kind}-v2-${Date.now()}`;
  const session = await page.context().newCDPSession(page);
  const frames = [];
  let queue = Promise.resolve();
  let firstResolve;
  const first = new Promise(r => firstResolve = r);
  const zero = Date.now() / 1000;
  session.on('Page.screencastFrame', (event) => {
    const i = frames.length;
    const t = Math.max(0, event.metadata.timestamp - zero);
    const path = `${root}/${String(i).padStart(6, '0')}.jpg`;
    frames.push({
      path,
      t: i ? Math.max(frames[i - 1].t, t) : 0,
      scale: event.metadata.pageScaleFactor,
      width: event.metadata.deviceWidth,
      height: event.metadata.deviceHeight,
    });
    queue = queue.then(() => writeFile(path, Buffer.from(event.data, 'base64')));
    session.send('Page.screencastFrameAck', {
      sessionId: event.sessionId,
    }).catch(() => {});
    firstResolve();
  });
  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: 390,
    maxHeight: 844,
    everyNthFrame: 2,
  });
  await first;
  return {
    zero,
    async finish() {
      const stop = Date.now() / 1000 - zero;
      await session.send('Page.stopScreencast');
      await queue;
      await session.detach();
      if (frames.length < 10) {
        throw new Error('Insufficient real recording frames');
      }
      let concat = '';
      for (let i = 0; i < frames.length; i++) {
        const duration = Math.max(0.001, (i + 1 < frames.length ? frames[i + 1].t : stop) - frames[i].t);
        concat += `file '${frames[i].path.split('/').pop()}'\nduration ${duration.toFixed(6)}\n`;
      }
      concat += `file '${frames.at(-1).path.split('/').pop()}'\n`;
      await writeFile(`${root}/frames.concat`, concat);
      await writeFile(`${output}-timestamps.json`, JSON.stringify({
        zero,
        stop,
        frames: frames.map(f => ({
          t: f.t,
          scale: f.scale,
          width: f.width,
          height: f.height,
        })),
      }, null, 2));
      const raw = `${output}.mp4`;
      await new Promise((resolve, reject) => {
        const p = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${root}/frames.concat`, '-vf', 'fps=30,setsar=1', '-c:v', 'libx264', '-crf', '16', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-threads', '2', '-movflags', '+faststart', raw]);
        let error = '';
        p.stderr.on('data', d => error += d);
        p.on('exit', c => c ? reject(new Error(error)) : resolve());
      });
      await rm(root, {
        recursive: true,
      });
      return raw;
    },
  };
}
