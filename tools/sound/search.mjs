/**
 * tools/sound/search.mjs — list CC0 candidates on Freesound for a query.
 *
 *   node tools/sound/search.mjs 'thunder rumble' [pages=1] [sort=Rating+descending]
 *
 * Scrapes the public search page (no API key) with the CC0 licence filter and prints
 * id, rating, downloads, duration, samplerate, user and title, one per line. The
 * previews it points at are what tools/sound/fetch.mjs downloads.
 */
const [query, pages = '1', sort = 'Rating+descending'] = process.argv.slice(2);
if (!query) {
  console.error("usage: node tools/sound/search.mjs '<query>' [pages] [sort]");
  process.exit(1);
}
const attr = (block, name) => block.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
for (let page = 1; page <= +pages; page++) {
  const url = `https://freesound.org/search/?q=${encodeURIComponent(query)}&f=license%3A%22Creative+Commons+0%22&s=${sort}&page=${page}`;
  const html = await (await fetch(url)).text();
  const blocks = html.split('class="bw-search__result"').slice(1);
  for (const b of blocks) {
    const rating = b.match(/Average rating of ([\d.]+)/)?.[1] ?? '-';
    const numRatings = b.match(/\((\d+)\)\s*<\/span>/)?.[1] ?? '';
    console.log([
      attr(b, 'data-sound-id'),
      rating.padStart(3),
      attr(b, 'data-num-downloads').padStart(6),
      (+attr(b, 'data-duration')).toFixed(1).padStart(6) + 's',
      attr(b, 'data-samplerate').replace('.0', ''),
      attr(b, 'data-username'),
      attr(b, 'data-title').replace(/&#x27;/g, "'").replace(/&amp;/g, '&'),
    ].join('\t'));
  }
}
