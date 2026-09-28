import { absUrl } from './config.js';
import { isoDate, truncate } from './text.js';

/** Central place where every page's <head> payload is decided. */
export function pageMeta(site, overrides = {}) {
  const base = {
    title: '',
    description: site.description,
    type: 'website',
    url: '/',
    noindex: false,
    image: '',
    publishedAt: null,
    updatedAt: null,
    tags: [],
    author: site.author,
    keywords: [],
    prevUrl: '',
    nextUrl: '',
    jsonLd: [],
    ...overrides,
  };
  return {
    ...base,
    canonicalUrl: absUrl(site, base.canonical || base.url),
    fullTitle: base.title ? base.title + ' | ' + site.title : site.title + ' — ' + site.tagline,
    robots: base.noindex
      ? 'noindex, nofollow'
      : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    ogImage: absUrl(site, base.image || '/assets/og-default.svg'),
  };
}

export function blogPostingLd(site, post) {
  const url = absUrl(site, post.url);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: String(post.title).slice(0, 110),
    description: truncate(post.description, 300),
    datePublished: isoDate(post.date),
    dateModified: isoDate(post.updated || post.date),
    author: { '@type': 'Person', name: post.author || site.author, url: absUrl(site, '/about') },
    publisher: {
      '@type': 'Organization',
      name: site.title,
      logo: { '@type': 'ImageObject', url: absUrl(site, '/assets/logo.svg') },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    keywords: post.tags.join(', '),
    inLanguage: post.lang || site.locale,
    wordCount: post.wordCount,
    image: post.cover ? [absUrl(site, post.cover)] : [absUrl(site, '/assets/og-default.svg')],
    isPartOf: { '@type': 'Blog', name: site.title, url: absUrl(site, '/') },
    articleSection: post.tags[0] || site.title,
  };
}

export function websiteLd(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.title,
    alternateName: site.tagline,
    description: site.description,
    url: absUrl(site, '/'),
    inLanguage: site.locale,
    publisher: { '@type': 'Person', name: site.author, url: absUrl(site, '/about') },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: absUrl(site, '/search?q={search_term_string}'),
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function personLd(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: site.author,
    url: absUrl(site, '/about'),
    description: site.description,
  };
}

export function breadcrumbLd(site, trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absUrl(site, item.href),
    })),
  };
}

export function collectionLd(site, { name, description, url }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    description,
    url: absUrl(site, url || '/'),
  };
}
