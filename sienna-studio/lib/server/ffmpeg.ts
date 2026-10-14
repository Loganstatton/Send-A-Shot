/**
 * ffmpeg on the app server (bundled by the ffmpeg-static package; FFMPEG_PATH overrides). Used for small, fast jobs:
 *
 *  - normalising an uploaded driving video for Copy Motion: first 20 s, upright, 16 fps, longest side ≤ 832 px,
 *    H.264, no sound — a 100 MB iPhone HEVC clip becomes a ~2 MB file the GPU can read directly;
 *  - remuxing GPU results with the index at the front (+faststart), so phones start playing before the download ends;
 *  - poster frames, and the mock backend's stand-in videos.
 *
 * Nothing here runs on the GPU or costs money.
 */

import 'server-only';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cached: string | null | undefined;

/** Path to an ffmpeg binary, or null when none is installed. */
export async function ffmpegPath(): Promise<string | null> {
  if (cached !== undefined) return cached;
  const candidates: string[] = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try {
    // listed in next.config serverComponentsExternalPackages, so this resolves inside node_modules at run time
    const mod: any = await import('ffmpeg-static');
    const p = (mod?.default ?? mod) as string | null;
    if (typeof p === 'string') candidates.push(p);
  } catch {}
  candidates.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  for (const c of candidates) {
    try {
      await fs.access(c);
      cached = c;
      return c;
    } catch {}
  }
  cached = null;
  return null;
}

export class FfmpegError extends Error {}

function run(bin: string, args: string[], timeoutMs: number): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['-hide_banner', '-nostdin', ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new FfmpegError(lastLines(String(stderr || err.message))));
      else resolve({ stderr: String(stderr) });
    });
  });
}

const lastLines = (s: string) => s.trim().split('\n').slice(-3).join(' ').slice(0, 400);

async function need(): Promise<string> {
  const bin = await ffmpegPath();
  if (!bin) throw new FfmpegError('ffmpeg is not installed on this server (npm install ffmpeg-static, or set FFMPEG_PATH)');
  return bin;
}

export interface VideoProbe {
  width: number;
  height: number;
  frames: number;
  fps: number;
  seconds: number;
}

/** Decode the first video stream to count frames and read its size (exact, unlike container metadata). */
export async function probeVideo(file: string): Promise<VideoProbe> {
  const bin = await need();
  const { stderr } = await run(bin, ['-i', file, '-map', '0:v:0', '-f', 'null', '-'], 120_000).catch((e) => {
    throw new FfmpegError(`not a readable video (${e.message})`);
  });
  return parseProbe(stderr);
}

/** Parse ffmpeg's stderr: "Stream #0:0…: Video: h264 …, 480x832 …, 16 fps" and the final "frame=  77". */
export function parseProbe(stderr: string): VideoProbe {
  const stream = /Stream #\d+:\d+[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*/.exec(stderr);
  if (!stream) throw new FfmpegError('the file has no video track');
  const fpsM = /([\d.]+) fps/.exec(stream[0]);
  const frameMatches = [...stderr.matchAll(/frame=\s*(\d+)/g)];
  const frames = frameMatches.length ? Number(frameMatches[frameMatches.length - 1][1]) : 0;
  const fps = fpsM ? Number(fpsM[1]) : 0;
  // rotation is applied by ffmpeg on decode, so swap when the stream says 90/270
  const rotated = /rotate\s*:\s*-?(90|270)|rotation of -?(90|270)/.test(stderr);
  let width = Number(stream[1]);
  let height = Number(stream[2]);
  if (rotated) [width, height] = [height, width];
  return { width, height, frames, fps, seconds: fps > 0 ? Math.round((frames / fps) * 100) / 100 : 0 };
}

export const DRIVE_MAX_SECONDS = 20;
export const DRIVE_MAX_SIDE = 832;

/** Upright, 16 fps, ≤ 832 px, first 20 s, H.264, no audio, index at the front. */
export async function normaliseDrivingVideo(input: string, output: string, fps: number): Promise<VideoProbe> {
  const bin = await need();
  const scale = `scale=w='if(gte(iw,ih),min(${DRIVE_MAX_SIDE},iw),-2)':h='if(gte(iw,ih),-2,min(${DRIVE_MAX_SIDE},ih))'`;
  await run(
    bin,
    ['-y', '-i', input, '-t', String(DRIVE_MAX_SECONDS), '-map', '0:v:0', '-an', '-vf', `fps=${fps},${scale},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', '-threads', '2', output],
    240_000,
  ).catch((e) => {
    throw new FfmpegError(`could not read this video (${e.message})`);
  });
  return probeVideo(output);
}

/** Copy the streams into a new MP4 with the index at the front. */
export async function faststart(input: string, output: string): Promise<void> {
  const bin = await need();
  await run(bin, ['-y', '-i', input, '-map', '0', '-c', 'copy', '-movflags', '+faststart', output], 120_000);
}

/** One frame as JPEG (`at` seconds in). */
export async function posterFrame(input: string, output: string, at = 0): Promise<void> {
  const bin = await need();
  await run(bin, ['-y', '-ss', String(at), '-i', input, '-frames:v', '1', '-q:v', '3', output], 60_000);
}

/** Mock backend: a slow zoom over a still image, `frames` frames at `fps`, exactly width × height. */
export async function stillToVideo(image: string, output: string, width: number, height: number, frames: number, fps: number): Promise<void> {
  const bin = await need();
  const vf = `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},zoompan=z='min(zoom+0.002,1.15)':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`;
  await run(bin, ['-y', '-loop', '1', '-i', image, '-vf', vf, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'ultrafast', '-movflags', '+faststart', output], 120_000);
}

/** A scratch directory that is removed afterwards. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sienna-video-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
