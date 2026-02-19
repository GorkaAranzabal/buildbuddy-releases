import { net } from 'electron';
import type { DocImage } from '../../shared/types';

interface CacheEntry {
  images: DocImage[];
  timestamp: number;
}

export class DocImageService {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
  private readonly CACHE_MAX_SIZE = 50;
  private readonly MAX_IMAGES_PER_QUERY = 2;

  async fetchImagesForQuery(query: string): Promise<DocImage[]> {
    const cacheKey = query.toLowerCase().trim();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.images;
    }

    try {
      const pageUrl = await this.searchTopDocPage(query);
      if (!pageUrl) return [];

      const images = await this.extractImagesFromPage(pageUrl);
      const limited = images.slice(0, this.MAX_IMAGES_PER_QUERY);

      // Evict oldest cache entry if full
      if (this.cache.size >= this.CACHE_MAX_SIZE) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, { images: limited, timestamp: Date.now() });

      return limited;
    } catch (error) {
      console.error('[DocImageService] Error fetching images for query:', query, error);
      return [];
    }
  }

  private async searchTopDocPage(query: string): Promise<string | null> {
    // Strategy: Google search with site: filter for UE docs
    try {
      const googleUrl = `https://www.google.com/search?q=site:docs.unrealengine.com+${encodeURIComponent(query)}&num=3`;
      const response = await net.fetch(googleUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      const html = await response.text();

      // Extract first docs.unrealengine.com URL from Google results
      const match = html.match(/https:\/\/dev\.epicgames\.com\/documentation\/[^"&\s<]+|https:\/\/docs\.unrealengine\.com\/[^"&\s<]+/);
      if (match) {
        // Clean up the URL (remove tracking params)
        const url = match[0].split('&')[0];
        console.log('[DocImageService] Found doc page:', url);
        return url;
      }
    } catch (err) {
      console.error('[DocImageService] Google search failed:', err);
    }

    return null;
  }

  private async extractImagesFromPage(pageUrl: string): Promise<DocImage[]> {
    try {
      const response = await net.fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      const html = await response.text();

      // Extract title
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      const pageTitle = titleMatch
        ? titleMatch[1]
            .replace(/\s*\|\s*Unreal Engine.*$/i, '')
            .replace(/\s*-\s*Unreal Engine.*$/i, '')
            .trim()
        : 'Unreal Engine Documentation';

      // Extract <img> tags with src and alt attributes
      const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
      const images: DocImage[] = [];
      let match;

      while ((match = imgRegex.exec(html)) !== null) {
        const imgTag = match[0];
        const src = match[1];

        // Extract alt text
        const altMatch = imgTag.match(/alt="([^"]*)"/);
        const alt = altMatch ? altMatch[1] : '';

        if (this.isValidDocImage(src, alt)) {
          const absoluteUrl = src.startsWith('http')
            ? src
            : src.startsWith('//')
              ? `https:${src}`
              : `${new URL(pageUrl).origin}${src}`;

          images.push({
            imageUrl: absoluteUrl,
            pageUrl,
            pageTitle,
            altText: alt || pageTitle,
          });

          if (images.length >= this.MAX_IMAGES_PER_QUERY) break;
        }
      }

      return images;
    } catch (error) {
      console.error('[DocImageService] Failed to extract images from:', pageUrl, error);
      return [];
    }
  }

  private isValidDocImage(src: string, alt: string): boolean {
    const srcLower = src.toLowerCase();

    // Exclude paths that are clearly icons, nav elements, or logos
    const excludedPaths = [
      '/skin/', '/resources/icon/', '/favicon', '/logo',
      'arrow', 'btn_', 'icon_', 'sprite', 'nav_',
      'footer', 'header', 'social', 'badge', 'avatar',
    ];
    if (excludedPaths.some(p => srcLower.includes(p))) return false;

    // Must be a recognizable image format
    if (!srcLower.match(/\.(png|jpg|jpeg|gif|webp)/)) return false;

    // Exclude very small images (likely icons) based on URL hints
    if (srcLower.match(/(\d+)x(\d+)/)) {
      const sizeMatch = srcLower.match(/(\d+)x(\d+)/);
      if (sizeMatch) {
        const w = parseInt(sizeMatch[1]);
        const h = parseInt(sizeMatch[2]);
        if (w < 100 || h < 100) return false;
      }
    }

    // Exclude SVGs disguised as other formats
    if (srcLower.includes('.svg')) return false;

    // Prefer images from content areas (heuristic)
    const contentIndicators = ['/images/', '/img/', '/media/', '/content/', '/attachments/', 'image'];
    const hasContentIndicator = contentIndicators.some(p => srcLower.includes(p));

    // If the image has meaningful alt text OR is in a content directory, accept it
    const genericAlt = ['', 'image', 'logo', 'icon', 'banner', 'img'];
    const hasMeaningfulAlt = alt.length > 3 && !genericAlt.includes(alt.toLowerCase());

    return hasMeaningfulAlt || hasContentIndicator;
  }
}
