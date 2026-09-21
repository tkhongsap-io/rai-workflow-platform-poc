// Read-only DOM comparison. Call after driving both pages to the same state.
// Supports a Playwright Page/FrameLocator or the Codex browser equivalents.
// This is layout/style evidence, not a screenshot or raster-equivalence test.
export function fingerprint(el) {
  let root = el;
  for (let i = 0; i < 20 && root.parentElement; i++) {
    const style = root.getAttribute('style') || '';
    if (style.includes('width: 1500px') && style.includes('height: 1220px')) break;
    root = root.parentElement;
  }
  const base = root.getBoundingClientRect();
  return {
    base: { w: base.width, h: base.height },
    nodes: [root, ...root.querySelectorAll('*')].filter(n =>
      !['SCRIPT', 'STYLE', 'OPTION'].includes(n.tagName) &&
      !(n.getAttribute('class') || '').split(' ').includes('sc-interp') &&
      n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0
    ).map(n => {
      const r = n.getBoundingClientRect(), s = getComputedStyle(n), styles = {};
      for (const k of [
        'font', 'line-height', 'letter-spacing', 'color', 'background-color',
        'background-image', 'border-top', 'border-right', 'border-bottom',
        'border-left', 'border-radius', 'box-shadow', 'padding', 'margin',
        'display', 'align-items', 'justify-content', 'gap', 'opacity', 'overflow',
        'text-align', 'text-transform', 'white-space', 'fill', 'stroke'
      ]) styles[k] = s.getPropertyValue(k);
      return { tag: n.tagName, x: r.x - base.x, y: r.y - base.y,
        w: r.width, h: r.height, styles };
    })
  };
}

export async function compareArtboards(local, reference, heading, label) {
  const options = { name: heading, exact: true };
  const l = await local.getByRole('heading', options).evaluate(fingerprint);
  const r = await reference.getByRole('heading', options).evaluate(fingerprint);
  const differences = [];
  let maxGeometryDelta = 0;
  for (let i = 0; i < Math.max(l.nodes.length, r.nodes.length); i++) {
    const x = l.nodes[i], y = r.nodes[i];
    if (!x || !y) { differences.push({ i, reason: 'count' }); continue; }
    const geometryDelta = Math.max(...['x', 'y', 'w', 'h'].map(k => Math.abs(x[k] - y[k])));
    const stylesEqual = JSON.stringify(x.styles) === JSON.stringify(y.styles);
    maxGeometryDelta = Math.max(maxGeometryDelta, geometryDelta);
    if (x.tag !== y.tag || !stylesEqual || geometryDelta > 0.001)
      differences.push({ i, tag: x.tag, geometryDelta, stylesEqual });
  }
  return { label, nodes: l.nodes.length, referenceNodes: r.nodes.length,
    maxGeometryDelta, differences };
}
