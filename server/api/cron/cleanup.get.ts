import { cleanupExpiredTracks } from '~/server/utils/storage'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const expectedSecret = (config.cronSecret || process.env.CRON_SECRET || '').trim()

  if (expectedSecret) {
    const authHeader = getHeader(event, 'authorization') || ''
    if (authHeader !== `Bearer ${expectedSecret}`) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized cron invocation.',
      })
    }
  }

  const result = await cleanupExpiredTracks()
  return {
    ok: true,
    timestamp: new Date().toISOString(),
    ...result,
  }
})
