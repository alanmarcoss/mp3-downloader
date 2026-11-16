import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Readable } from 'node:stream'
import ffmpegStatic from 'ffmpeg-static'
import type { AudioBitrate } from '~/types/track'

let resolvedFfmpegBin: string | null = null

export async function getFfmpegBinary(): Promise<string> {
  if (resolvedFfmpegBin) return resolvedFfmpegBin

  const candidates = [
    typeof ffmpegStatic === 'string' ? ffmpegStatic : '',
    path.resolve(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ].filter(Boolean)

  for (const bin of candidates) {
    try {
      await fs.access(bin)
      resolvedFfmpegBin = bin
      return bin
    }
    catch {
      // try next
    }
  }

  resolvedFfmpegBin = 'ffmpeg'
  return 'ffmpeg'
}

export interface TranscodeOptions {
  inputPath?: string
  inputStream?: Readable
  outputPath: string
  bitrate: AudioBitrate
  title: string
  artist: string
  thumbnailUrl?: string
}

async function fetchCoverImage(url: string, tempDir: string): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WavelengthMP3/1.0)',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const arrayBuffer = await res.arrayBuffer()
    if (arrayBuffer.byteLength < 256) return null
    const coverPath = path.join(tempDir, 'cover-input.img')
    await fs.writeFile(coverPath, Buffer.from(arrayBuffer))
    return coverPath
  }
  catch {
    return null
  }
}

export async function transcodeToMp3(options: TranscodeOptions): Promise<void> {
  const ffmpegBin = await getFfmpegBinary()
  const workDir = path.dirname(options.outputPath)
  const coverPath = options.thumbnailUrl
    ? await fetchCoverImage(options.thumbnailUrl, workDir)
    : null

  const runFfmpeg = (withCover: boolean) =>
    new Promise<void>((resolve, reject) => {
      const args: string[] = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
      ]

      if (options.inputPath) {
        args.push('-i', options.inputPath)
      }
      else {
        args.push('-i', 'pipe:0')
      }

      if (withCover && coverPath) {
        args.push(
          '-i',
          coverPath,
          '-map',
          '0:a:0',
          '-map',
          '1:v:0',
          '-c:v',
          'mjpeg',
          '-vf',
          'scale=min(600\\,iw):-2',
          '-disposition:v:0',
          'attached_pic',
          '-metadata:s:v',
          'title=Album cover',
          '-metadata:s:v',
          'comment=Cover (front)',
        )
      }
      else {
        args.push('-vn')
      }

      args.push(
        '-c:a',
        'libmp3lame',
        '-b:a',
        `${options.bitrate}k`,
        '-ar',
        '44100',
        '-id3v2_version',
        '3',
        '-metadata',
        `title=${options.title}`,
        '-metadata',
        `artist=${options.artist}`,
        options.outputPath,
      )

      const child = spawn(ffmpegBin, args, {
        stdio: [options.inputStream ? 'pipe' : 'ignore', 'ignore', 'pipe'],
      })

      let stderr = ''
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      child.on('error', (err) => {
        reject(new Error(`FFmpeg failed to launch: ${err.message}`))
      })

      if (options.inputStream && child.stdin) {
        options.inputStream.on('error', (err) => {
          child.kill('SIGKILL')
          reject(new Error(`Source audio stream failed: ${err.message}`))
        })
        child.stdin.on('error', () => {
          // Ignore EPIPE if ffmpeg exits early; exit handler reports real stderr
        })
        options.inputStream.pipe(child.stdin)
      }

      child.on('close', (code) => {
        if (code === 0) {
          resolve()
        }
        else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`))
        }
      })
    })

  // If streaming via pipe:0, we can only consume the stream once, so if we only have a stream
  // we first spool the raw stream to a temp file so cover-fallback or ffmpeg seek always succeeds!
  if (options.inputStream && !options.inputPath) {
    const rawPath = path.join(workDir, 'raw-source.audio')
    const writeHandle = await fs.open(rawPath, 'w')
    const writeStream = writeHandle.createWriteStream()

    await new Promise<void>((resolve, reject) => {
      options.inputStream!.on('error', reject)
      writeStream.on('error', reject)
      writeStream.on('finish', resolve)
      options.inputStream!.pipe(writeStream)
    })
    await writeHandle.close().catch(() => {})
    options = { ...options, inputPath: rawPath, inputStream: undefined }
  }

  try {
    await runFfmpeg(Boolean(coverPath))
  }
  catch (err) {
    if (coverPath) {
      // Retry without cover art if image format caused any issue
      await runFfmpeg(false)
    }
    else {
      throw err
    }
  }
}

export async function withTempWorkDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mp3dl-${prefix}-`))
  try {
    return await fn(dir)
  }
  finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
