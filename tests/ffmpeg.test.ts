import { spawn } from 'node:child_process'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFfmpegBinary, transcodeToMp3, withTempWorkDir } from '~/server/utils/ffmpeg'

async function generateTestWav(wavPath: string): Promise<void> {
  const bin = await getFfmpegBinary()
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.6',
      wavPath,
    ])
    proc.on('error', reject)
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`wav gen failed: ${code}`))))
  })
}

describe('server/utils/ffmpeg', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('transcodes audio files and streams to ID3v2.3-tagged MP3 and cleans up temp workdir', async () => {
    let capturedDir = ''

    await withTempWorkDir('vitest', async (dir) => {
      capturedDir = dir
      const wavPath = path.join(dir, 'input.wav')
      const mp3FromFile = path.join(dir, 'out-file.mp3')
      const mp3FromStream = path.join(dir, 'out-stream.mp3')

      await generateTestWav(wavPath)

      // Mock broken cover URL to ensure graceful fallback without failing conversion
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

      await transcodeToMp3({
        inputPath: wavPath,
        outputPath: mp3FromFile,
        bitrate: 192,
        title: 'Test Synth',
        artist: 'Wavelength Suite',
        thumbnailUrl: 'https://example.com/missing-cover.jpg',
      })

      const buf = await fs.readFile(mp3FromFile)
      expect(buf.byteLength).toBeGreaterThan(2000)
      // ID3v2 header starts with ASCII "ID3"
      expect(buf.subarray(0, 3).toString('ascii')).toBe('ID3')

      await transcodeToMp3({
        inputStream: createReadStream(wavPath),
        outputPath: mp3FromStream,
        bitrate: 128,
        title: 'Streamed Synth',
        artist: 'Wavelength Suite',
      })

      const streamBuf = await fs.readFile(mp3FromStream)
      expect(streamBuf.subarray(0, 3).toString('ascii')).toBe('ID3')
    })

    // Verify withTempWorkDir removed temporary folder
    await expect(fs.access(capturedDir)).rejects.toThrow()
  }, 15_000)
})
