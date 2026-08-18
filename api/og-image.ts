/// <reference types="node" />

import sharp, { type OverlayOptions } from "sharp";

const WIDTH = 1200;
const HEIGHT = 630;
const FOREGROUND = "#fafafa";
const MUTED = "#a1a1aa";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const COLLAGE_WIDTH = 342;
const COLLAGE_HEIGHT = 513;

type CollectionResponse = {
  collection?: {
    name?: string;
  };
  movies?: Array<{
    movie_id: string | number;
    is_movie?: boolean | null;
  }>;
};

type ContentResponse = {
  poster_path?: string;
};


const getEnvVar = (key: string): string | undefined => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[key];
};

const buildBackendUrl = () => {
  const rawUrl = getEnvVar("VITE_BACKEND_URL");
  if (!rawUrl) {
    return "";
  }
  return rawUrl.endsWith("/") ? rawUrl.slice(0, -1) : rawUrl;
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const truncate = (value: string, max = 48) => {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1).trimEnd()}...`;
};

const fetchJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Upstream request failed with ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchCollection = async (backendUrl: string, collectionId: string) => {
  const data = await fetchJson(`${backendUrl}/api/collections/${collectionId}`, {
    method: "GET",
  });

  return data as CollectionResponse;
};

const fetchContent = async (backendUrl: string, endpoint: string) => {
  const data = await fetchJson(`${backendUrl}/api/content`, {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });

  return data as ContentResponse;
};

const imageFromPath = (path?: string) => {
  if (!path) {
    return "";
  }
  return `${TMDB_IMAGE_BASE}${path}`;
};

const fetchImageBytes = async (url: string) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Image request failed with ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeoutId);
  }
};

const getCollectionPosters = async (backendUrl: string, collectionId: string) => {
  const collection = await fetchCollection(backendUrl, collectionId);
  const items = (collection.movies ?? []).slice(0, 6);

  const posters = (await Promise.all(
    items.map(async (item) => {
      try {
        const idStr = String(item.movie_id);
        const isTv = item.is_movie === false || idStr.includes("tv");
        const numericId = idStr.replace(/\D/g, "");
        if (!numericId) return null;
        const endpoint = isTv ? `/tv/${numericId}` : `/movie/${numericId}`;
        const content = await fetchContent(backendUrl, endpoint);
        const poster = imageFromPath(content.poster_path);
        return poster || null;
      } catch {
        return null;
      }
    })
  )).filter(Boolean) as string[];

  return { posters: posters.slice(0, 4) };
};


const svgBytes = (svg: string) => Buffer.from(svg);




const buildFallbackImage = async (title: string) => {
  return sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: "#09090b",
    },
  })
    .composite([
      {
        input: svgBytes(`
          <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#18181b" />
                <stop offset="1" stop-color="#09090b" />
              </linearGradient>
            </defs>
            <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
            <text x="600" y="250" text-anchor="middle" fill="${MUTED}" font-family="Arial, Helvetica, sans-serif" font-size="28">Collection</text>
            <text x="600" y="340" text-anchor="middle" fill="${FOREGROUND}" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700">${escapeXml(truncate(title, 24))}</text>
          </svg>
        `),
      },
    ])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
};

const buildCollectionImage = async (posters: string[]) => {
  const w = COLLAGE_WIDTH;
  const h = COLLAGE_HEIGHT;
  const gap = 4;
  const count = posters.length;

  type TileSpec = { x: number; y: number; w: number; h: number };
  let tiles: TileSpec[];

  if (count <= 1) {
    tiles = [{ x: 0, y: 0, w, h }];
  } else if (count === 2) {
    const tw = Math.floor((w - gap) / 2);
    tiles = [
      { x: 0, y: 0, w: tw, h },
      { x: tw + gap, y: 0, w: w - tw - gap, h },
    ];
  } else if (count === 3) {
    const tw = Math.floor((w - gap) / 2);
    const th = Math.floor((h - gap) / 2);
    tiles = [
      { x: 0, y: 0, w: tw, h },
      { x: tw + gap, y: 0, w: w - tw - gap, h: th },
      { x: tw + gap, y: th + gap, w: w - tw - gap, h: h - th - gap },
    ];
  } else {
    const tw = Math.floor((w - gap) / 2);
    const th = Math.floor((h - gap) / 2);
    tiles = [
      { x: 0, y: 0, w: tw, h: th },
      { x: tw + gap, y: 0, w: w - tw - gap, h: th },
      { x: 0, y: th + gap, w: tw, h: h - th - gap },
      { x: tw + gap, y: th + gap, w: w - tw - gap, h: h - th - gap },
    ];
  }

  const tileComposites: OverlayOptions[] = [];
  for (const [i, posterUrl] of posters.entries()) {
    const tile = tiles[i];
    if (!tile) break;
    const source = await fetchImageBytes(posterUrl);
    const resized = await sharp(source)
      .resize(tile.w, tile.h, { fit: "cover" })
      .png()
      .toBuffer();
    tileComposites.push({ input: resized, left: tile.x, top: tile.y });
  }

  return sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 24, g: 24, b: 27 },
    },
  })
    .composite(tileComposites)
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
};

export default async function handler(req: any, res: any) {
  const type = String(req.query?.type ?? "").trim();
  const id = String(req.query?.id ?? "").trim();
  const backendUrl = buildBackendUrl();

  try {
    let image: Uint8Array;

    if (type === "collection" && id && id.length <= 60 && backendUrl) {
      const { posters } = await getCollectionPosters(backendUrl, id);
      image = await buildCollectionImage(posters);
    } else {
      image = await buildFallbackImage("Collection");
    }

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(image.byteLength));
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(image);
  } catch {
    const image = await buildFallbackImage("Collection");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(image.byteLength));
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(image);
  }
}
