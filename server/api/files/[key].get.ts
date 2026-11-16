import { createReadStream, promises as fs } from 'node:fs'
import { getCachedTrack, getLocalAudioPaths } from '~/server/utils/storage'

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') || ''
  const query = getQuery(event)
  const isDownload = query.download === '1' || query.download === 'true'

  const cached = await getCachedTrack(key)
  if (!cached || cached.storageMode !== 'local-disk') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Cached MP3 not found or has expired (24h limit).',
    })
  }

  const { audioPath } = getLocalAudioPaths(key)
  let stat
  try {
    stat = await fs.stat(audioPath)
  }
  catch {
    throw createError({
      statusCode: 404,
      statusMessage: 'Audio file missing from local cache.',
    })
  }

  const encodedName = encodeURIComponent(cached.fileName)
  const asciiFallback = cached.fileName.replace(/[^\x20-\x7E]/g, '_')

  setHeader(event, 'Content-Type', 'audio/mpeg')
  setHeader(event, 'Accept-Ranges', 'bytes')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  if (isDownload) {
    setHeader(
      event,
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
    )
  }
  else {
    setHeader(event, 'Content-Disposition', 'inline')
  }

  const rangeHeader = getHeader(event, 'range')
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0
      const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1

      if (start >= 0 && end < stat.size && start <= end) {
        setResponseStatus(event, 206)
        setHeader(event, 'Content-Range', `bytes ${start}-${end}/${stat.size}`)
        setHeader(event, 'Content-Length', end - start + 1)
        return sendStream(event, createReadStream(audioPath, { start, end }))
      }
    }
  }

  setHeader(event, 'Content-Length', stat.size)
  return sendStream(event, createReadStream(audioPath))
})
