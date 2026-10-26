'use strict';

// Split oversized structured blocks at DOM boundaries. Keep every text node,
// link and image; never truncate the article to fit a provider request.
function splitTranslationBlocks(blocks, { cheerio, stripHtml, maxChars = 10000 }) {
  const cost = b => JSON.stringify({ i: b.i, tag: b.tag, text: b.source, ...(b.sourceHtml ? { html: b.sourceHtml } : {}) }).length;
  const result = [];
  function append(html, kind = 'text') {
    const $ = cheerio.load(html, {}, false);
    const root = $.root().children().first();
    const tag = root[0]?.name || 'p';
    const sourceHtml = $.html();
    const source = stripHtml(sourceHtml);
    const b = { i: result.length, tag, source, sourceHtml, kind: /^(img|hr)$/.test(tag) ? 'media' : kind };
    if (b.kind !== 'text' || cost(b) <= maxChars) { result.push(b); return; }
    const nodes = root.contents().toArray();
    const wrap = body => {
      const clone = root.clone().empty(); clone.append(body); return $.html(clone);
    };
    // Nested single elements still need their ancestor wrappers preserved.
    function fragments(node, wrappers = []) {
      const render = body => wrappers.reduceRight((inner, template) => {
        const copy = template.clone().empty(); copy.append(inner); return $.html(copy);
      }, body);
      const raw = $.html(node);
      const whole = render(raw);
      const candidate = { ...b, source: stripHtml(whole), sourceHtml: whole };
      if (cost(candidate) <= maxChars - 100) return [whole];
      if (node.type === 'text') {
        const chars = Array.from(node.data || '');
        if (chars.length <= 1) throw Object.assign(new Error('Translation structure exceeds request limit'), { statusCode: 413 });
        const middle = Math.ceil(chars.length / 2);
        return [chars.slice(0, middle), chars.slice(middle)].flatMap(part => fragments({ ...node, data: part.join('') }, wrappers));
      }
      const children = $(node).contents().toArray();
      if (!children.length) throw Object.assign(new Error('Translation structure exceeds request limit'), { statusCode: 413 });
      return children.flatMap(child => fragments(child, [...wrappers, $(node)]));
    }
    let pending = '';
    const flush = () => { if (pending) { append(wrap(pending), kind); pending = ''; } };
    for (const node of nodes) {
      const raw = $.html(node);
      const combined = wrap(pending + raw);
      if (cost({ ...b, source: stripHtml(combined), sourceHtml: combined }) <= maxChars - 100) { pending += raw; continue; }
      flush();
      const alone = wrap(raw);
      if (cost({ ...b, source: stripHtml(alone), sourceHtml: alone }) <= maxChars - 100) pending = raw;
      else for (const part of fragments(node, [root])) append(part, kind);
    }
    flush();
  }
  for (const block of blocks) {
    if (block.kind !== 'text' || cost(block) <= maxChars - 100) result.push({ ...block, i: result.length });
    else append(block.sourceHtml || `<p>${String(block.source).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`);
  }
  return result;
}
// A short linked byline at the start of an article may consist exclusively of
// names. Keeping those names verbatim is not a missing Chinese translation.
function preservesAttribution(block, target) {
  const source = String(block.source || '').trim();
  if (block.tag !== 'p' || block.i > 5 || source.length > 100 || !/<a\b[^>]*href=/i.test(block.sourceHtml || '')) return false;
  const words = source.split(/\s+/);
  if (words.length < 2 || words.length > 8 || !words.every(word => /^[A-Z][a-zA-Z’'.-]*$/.test(word))) return false;
  if (/\b(the|a|an|and|or|is|are|was|were|be|to|of|in|on|for|with|this|that|how|why|what|we|you|it|can|will|new)\b/i.test(source)) return false;
  return source.replace(/\s+/g, '') === String(target || '').replace(/\s+/g, '');
}
module.exports = { splitTranslationBlocks, preservesAttribution };
