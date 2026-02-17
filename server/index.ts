import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { config } from './config.js';
import { MemoryCache } from './lib/cache.js';
import { buildDiffData } from './services/pipeline.js';
import { buildMetaForgeDataFromStore } from './services/metaforgeStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, '../client');

const app = express();
const cache = new MemoryCache();

function setApiCacheHeaders(res: express.Response): void {
  const maxAge = Math.max(0, config.apiResponseMaxAgeSec);
  const stale = Math.max(maxAge * 5, 60);
  res.setHeader('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${stale}`);
}

function parseIconSource(value: unknown): URL | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return undefined;
    }
    if (!config.iconAllowedHosts.includes(url.hostname.toLowerCase())) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

async function fetchIconBuffer(sourceUrl: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: 'image/*',
        'User-Agent': 'arc-data-diff-explorer/0.1.0',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Icon request failed (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function normalizeIcon(sourceBuffer: Buffer, sizePx: number): Promise<Buffer> {
  const normalizedSize = Math.min(256, Math.max(32, Math.round(sizePx)));
  const innerScale = Math.min(1, Math.max(0.5, config.iconInnerScale));
  const innerSize = Math.max(16, Math.round(normalizedSize * innerScale));
  const totalPadding = Math.max(0, normalizedSize - innerSize);
  const paddingBefore = Math.floor(totalPadding / 2);
  const paddingAfter = totalPadding - paddingBefore;
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

  // Trim transparent padding to normalize visual bounds, then fit to a fixed square.
  try {
    return await sharp(sourceBuffer, { animated: false })
      .rotate()
      .trim({ threshold: config.iconTrimThreshold })
      .resize(innerSize, innerSize, {
        fit: 'contain',
        background: transparent,
      })
      .extend({
        top: paddingBefore,
        bottom: paddingAfter,
        left: paddingBefore,
        right: paddingAfter,
        background: transparent,
      })
      .webp({ quality: 92, effort: 4 })
      .toBuffer();
  } catch {
    return await sharp(sourceBuffer, { animated: false })
      .rotate()
      .resize(innerSize, innerSize, {
        fit: 'contain',
        background: transparent,
      })
      .extend({
        top: paddingBefore,
        bottom: paddingAfter,
        left: paddingBefore,
        right: paddingAfter,
        background: transparent,
      })
      .webp({ quality: 92, effort: 4 })
      .toBuffer();
  }
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    enabledSources: config.enabledSources,
  });
});

app.get('/api/diff-data', async (_req, res) => {
  try {
    const data = await cache.getOrSet('diff-data', config.cacheTtlMs, () => buildDiffData(config.enabledSources));
    setApiCacheHeaders(res);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    res.status(500).json({ error: message });
  }
});

async function sendMetaForgeData(res: express.Response): Promise<void> {
  try {
    const data = await cache.getOrSet('metaforge-data', config.cacheTtlMs, () => buildMetaForgeDataFromStore());
    setApiCacheHeaders(res);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    res.status(500).json({ error: message });
  }
}

app.get('/api/metaforge-data', async (_req, res) => {
  await sendMetaForgeData(res);
});

// Backward compatible alias.
app.get('/api/metaforge-diff-data', async (_req, res) => {
  await sendMetaForgeData(res);
});

app.get('/api/icon', async (req, res) => {
  if (!config.iconProxyEnabled) {
    res.status(404).json({ error: 'Icon proxy disabled' });
    return;
  }

  const sourceUrl = parseIconSource(req.query.src);
  if (!sourceUrl) {
    res.status(400).json({ error: 'Invalid icon source URL' });
    return;
  }

  const requestedSize = typeof req.query.size === 'string' ? Number(req.query.size) : config.iconSizePx;
  const sizePx = Number.isFinite(requestedSize) ? requestedSize : config.iconSizePx;

  const cacheKey = `icon:${sourceUrl.toString()}:size=${Math.round(sizePx)}:inner=${config.iconInnerScale}`;

  try {
    const iconBuffer = await cache.getOrSet(cacheKey, config.iconCacheTtlMs, async () => {
      const sourceBuffer = await fetchIconBuffer(sourceUrl.toString());
      return normalizeIcon(sourceBuffer, sizePx);
    });

    res.setHeader('Cache-Control', `public, max-age=${Math.max(0, config.iconResponseMaxAgeSec)}, stale-while-revalidate=604800`);
    res.type('image/webp').send(iconBuffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Icon transform failed';
    res.status(502).json({ error: message });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }

    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`Data Diff Explorer API listening on http://localhost:${config.port}`);
});
