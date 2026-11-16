// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-03-01',
  devtools: { enabled: false },
  telemetry: false,

  modules: [
    '@nuxtjs/tailwindcss',
    'shadcn-nuxt',
    '@nuxtjs/color-mode',
  ],

  css: ['~/assets/css/tailwind.css'],

  shadcn: {
    prefix: '',
    componentDir: './components/ui',
  },

  colorMode: {
    classSuffix: '',
    preference: 'dark',
    fallback: 'dark',
  },

  app: {
    head: {
      title: 'Wavelength — YouTube & SoundCloud to MP3',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: 'Convert YouTube and SoundCloud tracks to tagged high-bitrate MP3s with instant 24-hour cloud caching.',
        },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
        },
      ],
    },
  },

  runtimeConfig: {
    blobReadWriteToken: process.env.BLOB_READ_WRITE_TOKEN || '',
    cronSecret: process.env.CRON_SECRET || '',
    cacheTtlHours: Number(process.env.CACHE_TTL_HOURS || 24),
    maxDurationSeconds: Number(process.env.MAX_DURATION_SECONDS || 3600),
    youtubeProxy: process.env.YOUTUBE_PROXY || '',
    youtubeCookies: process.env.YOUTUBE_COOKIES || '',
    soundcloudClientId: process.env.SOUNDCLOUD_CLIENT_ID || '',
  },

  nitro: {
    // Nitro Vercel preset runtime options (maxDuration & memory written to .vc-config.json)
    vercel: {
      functions: {
        maxDuration: 60,
        memory: 1024,
      },
    },
    externals: {
      traceInclude: ['node_modules/ffmpeg-static/**'],
    },
  } as any,
})
