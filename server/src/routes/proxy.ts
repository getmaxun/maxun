import { Router, Request, Response } from 'express';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import User from '../models/User';
import { encrypt, decrypt } from '../utils/auth';
import { requireSignIn } from '../middlewares/auth';
chromium.use(stealthPlugin());

export const router = Router();

interface AuthenticatedRequest extends Request {
    user?: { id: string };
}

router.post('/config', requireSignIn, async (req: AuthenticatedRequest, res: Response) => {
    const { server_url, username, password } = req.body;

    try {

        if (!req.user) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        const user = await User.findByPk(req.user.id, {
            attributes: { exclude: ['password'] },
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!server_url) {
            return res.status(400).send('Proxy URL is required');
        }

        const encryptedProxyUrl = encrypt(server_url);
        let encryptedProxyUsername: string | null = null;
        let encryptedProxyPassword: string | null = null;

        if (username && password) {
            encryptedProxyUsername = encrypt(username);
            encryptedProxyPassword = encrypt(password);
        } else if (username && !password) {
            return res.status(400).send('Proxy password is required when proxy username is provided');
        }

        await user.update({
            proxy_url: encryptedProxyUrl,
            proxy_username: encryptedProxyUsername,
            proxy_password: encryptedProxyPassword,
        });

        res.status(200).json({ ok: true });
    } catch (error: any) {
        console.log(`Could not save proxy configuration - ${error}`);
        res.status(500).json({ ok: false, error: 'Could not save proxy configuration' });
    }
});

router.get('/test', requireSignIn, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        const user = await User.findByPk(req.user.id, {
            attributes: ['proxy_url', 'proxy_username', 'proxy_password'],
            raw: true
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const decryptedProxyUrl = user.proxy_url ? decrypt(user.proxy_url) : null;
        const decryptedProxyUsername = user.proxy_username ? decrypt(user.proxy_username) : null;
        const decryptedProxyPassword = user.proxy_password ? decrypt(user.proxy_password) : null;

        const proxyOptions: any = {
            server: decryptedProxyUrl,
            ...(decryptedProxyUsername && decryptedProxyPassword && {
                username: decryptedProxyUsername,
                password: decryptedProxyPassword,
            }),
        };

        const browser = await chromium.launch({
            headless: true,
            proxy: proxyOptions,
        });
        const page = await browser.newPage();
        await page.goto('https://example.com');
        await browser.close();

        res.status(200).send({ success: true });
    } catch (error) {
        res.status(500).send({ success: false, error: 'Proxy connection failed' });
    }
});

router.get('/config', requireSignIn, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        const user = await User.findByPk(req.user.id, {
            attributes: ['proxy_url', 'proxy_username', 'proxy_password'],
            raw: true,
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const maskedProxyUrl = user.proxy_url ? maskProxyUrl(decrypt(user.proxy_url)) : null;
        const auth = user.proxy_username && user.proxy_password ? true : false;

        res.status(200).json({
            proxy_url: maskedProxyUrl,
            auth: auth,
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Could not retrieve proxy configuration' });
    }
});

router.delete('/config', requireSignIn, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const user = await User.findByPk(req.user.id);

    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }

    await user.update({
        proxy_url: null,
        proxy_username: null,
        proxy_password: null,
    });

    res.status(200).json({ ok: true });
});

const maskProxyUrl = (url: string) => {
    const urlWithoutProtocol = url.replace(/^https?:\/\//, '').replace(/^socks5?:\/\//, ''); // Remove protocols
    const [domain, port] = urlWithoutProtocol.split(':');
    const maskedDomain = `${domain.slice(0, 3)}****${domain.slice(-3)}`; // Shows first and last 3 characters
    if (port) {
        return `${maskedDomain}:${port}`;
    } else {
        return maskedDomain;
    }
};

// TODO: Move this from here
export const getDecryptedProxyConfig = async (userId: string) => {
    const user = await User.findByPk(userId, {
        raw: true,
    });

    if (!user) {
        throw new Error('User not found');
    }

    const decryptedProxyUrl = user.proxy_url ? decrypt(user.proxy_url) : null;
    const decryptedProxyUsername = user.proxy_username ? decrypt(user.proxy_username) : null;
    const decryptedProxyPassword = user.proxy_password ? decrypt(user.proxy_password) : null;

    return {
        proxy_url: decryptedProxyUrl,
        proxy_username: decryptedProxyUsername,
        proxy_password: decryptedProxyPassword,
    };
};
