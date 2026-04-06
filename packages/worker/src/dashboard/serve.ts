import { Hono } from 'hono'
import type { AppType } from '../index.js'
import { appJs } from './app.js'
import { indexHtml } from './index-html.js'
import { stylesCss } from './styles.js'

export const dashboardRoutes = new Hono<AppType>()

dashboardRoutes.get('/', (c) => c.html(indexHtml))

dashboardRoutes.get('/assets/app.js', (c) => {
  return c.body(appJs, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
})

dashboardRoutes.get('/assets/styles.css', (c) => {
  return c.body(stylesCss, {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
})
