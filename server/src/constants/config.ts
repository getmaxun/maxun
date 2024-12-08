export const SERVER_PORT = process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : 8080
export const DEBUG = process.env.DEBUG === 'true'
export const LOGS_PATH = process.env.LOGS_PATH ?? 'server/logs'
export const ANALYTICS_ID = 'oss'