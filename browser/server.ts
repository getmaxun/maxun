import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import http from 'http';
import net from 'net';
import { timingSafeEqual } from 'crypto';
import type { BrowserServer } from 'playwright';

chromium.use(stealthPlugin());

let browserServer: BrowserServer | null = null;

const BROWSER_WS_PORT = parseInt(process.env.BROWSER_WS_PORT || '3001', 10);
const BROWSER_HEALTH_PORT = parseInt(process.env.BROWSER_HEALTH_PORT || '3002', 10);
const BROWSER_WS_HOST = process.env.BROWSER_WS_HOST || 'localhost';
// Interface the WebSocket server listens on. Playwright 1.65+ binds launchServer to
// loopback by default, which other containers cannot reach, so listen on all interfaces.
const BROWSER_LISTEN_HOST = process.env.BROWSER_LISTEN_HOST || '0.0.0.0';
const BROWSER_SERVICE_TOKEN = process.env.BROWSER_SERVICE_TOKEN || '';

/**
 * The Playwright WebSocket endpoint grants full control of the browser
 * (including reading files the browser process can access), and its random
 * path is the only thing protecting it. Only hand it out to callers that
 * present BROWSER_SERVICE_TOKEN, when one is configured.
 */
function isAuthorized(req: http.IncomingMessage): boolean {
    if (!BROWSER_SERVICE_TOKEN) return true;
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const expected = Buffer.from(BROWSER_SERVICE_TOKEN);
    const given = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
}

async function start(): Promise<void> {
    console.log('Starting Maxun Browser Service...');
    console.log(`WebSocket port: ${BROWSER_WS_PORT}`);
    console.log(`Health check port: ${BROWSER_HEALTH_PORT}`);

    try {
        browserServer = await chromium.launchServer({
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials',
                '--disable-extensions',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--force-color-profile=srgb',
                '--force-device-scale-factor=2',
                '--ignore-certificate-errors',
                '--mute-audio'
            ],
            port: BROWSER_WS_PORT,
            host: BROWSER_LISTEN_HOST,
        });

        console.log(`✅ Browser WebSocket server listening on port ${BROWSER_WS_PORT}`);
        if (!BROWSER_SERVICE_TOKEN) {
            console.warn('⚠️  BROWSER_SERVICE_TOKEN is not set: /health returns the browser control endpoint to any caller that can reach it. Keep the browser ports off untrusted networks or set a token.');
        }
        console.log(`✅ Stealth plugin enabled`);

        const healthServer = http.createServer(async (req, res) => {
            if (req.url === '/health') {
                // Report healthy only if the WebSocket server really accepts connections.
                const wsListening = await isWsPortOpen();
                // Liveness stays public (Docker healthcheck); the control endpoint does not.
                const wsEndpoint = isAuthorized(req) ? advertisedWsEndpoint() : undefined;
                res.writeHead(wsListening ? 200 : 503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: wsListening ? 'healthy' : 'unhealthy',
                    wsEndpoint,
                    wsPort: BROWSER_WS_PORT,
                    healthPort: BROWSER_HEALTH_PORT,
                    timestamp: new Date().toISOString()
                }));
            } else if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(`Maxun Browser Service\nHealth: http://localhost:${BROWSER_HEALTH_PORT}/health`);
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        healthServer.listen(BROWSER_HEALTH_PORT, () => {
            console.log(`✅ Health check server running on port ${BROWSER_HEALTH_PORT}`);
            console.log('Browser service is ready to accept connections!');
        });
    } catch (error) {
        console.error('❌ Failed to start browser service:', error);
        process.exit(1);
    }
}

/**
 * The endpoint other containers should use: Playwright reports the address it bound to
 * (localhost, 127.0.0.1, [::1] or 0.0.0.0), so swap in the service's reachable hostname.
 */
function advertisedWsEndpoint(): string {
    const endpoint = browserServer?.wsEndpoint();
    if (!endpoint) return '';
    const url = new URL(endpoint);
    url.hostname = BROWSER_WS_HOST;
    return url.toString();
}

/** True if a TCP connection to the WebSocket port succeeds from inside this container. */
function isWsPortOpen(): Promise<boolean> {
    const probeHost = ['0.0.0.0', '::'].includes(BROWSER_LISTEN_HOST) ? '127.0.0.1' : BROWSER_LISTEN_HOST;
    return new Promise((resolve) => {
        const socket = net.connect({ host: probeHost, port: BROWSER_WS_PORT });
        const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
        socket.setTimeout(1000, () => done(false));
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
    });
}

async function shutdown(): Promise<void> {
    console.log('Shutting down browser service...');
    if (browserServer) {
        try {
            await browserServer.close();
            console.log('Browser server closed');
        } catch (error) {
            console.error('Error closing browser server:', error);
        }
    }
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch(console.error);