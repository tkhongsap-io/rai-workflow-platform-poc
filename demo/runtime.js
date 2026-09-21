/* Local adapter for the authored DC template. No Claude runtime or network service. */
(() => {
  'use strict';
  const template = document.querySelector('x-dc');
  const logic = document.querySelector('script[type="text/x-dc"]');
  if (!template || !logic) throw new Error('Missing original design template or component');
  const props = Object.fromEntries(Object.entries(JSON.parse(logic.dataset.props || '{}')).map(([k,v]) => [k,v.default]));
  const root = document.createElement('div');
  root.id = 'dc-root';
  template.replaceWith(root);
  for (const helmet of template.querySelectorAll('helmet')) {
    for (const node of [...helmet.childNodes]) document.head.append(node.cloneNode(true));
    helmet.remove();
  }
  const source = [...template.childNodes];
  const exact = /^\{\{\s*([^{}]+?)\s*\}\}$/;
  const holes = /\{\{\s*([^{}]+?)\s*\}\}/g;
  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    return path.split('.').reduce((value,key) => value == null ? undefined : value[key], scope);
  }
  function bind(value, scope) {
    const match = value.match(exact);
    return match ? lookup(match[1], scope) : value.replace(holes, (_,path) => String(lookup(path,scope) ?? ''));
  }
  function renderNodes(nodes, scope) {
    const fragment = document.createDocumentFragment();
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        let last = 0;
        for (const match of node.textContent.matchAll(holes)) {
          fragment.append(document.createTextNode(node.textContent.slice(last,match.index)));
          const span = document.createElement('span'); span.className = 'sc-interp';
          span.textContent = String(lookup(match[1],scope) ?? ''); fragment.append(span);
          last = match.index + match[0].length;
        }
        fragment.append(document.createTextNode(node.textContent.slice(last)));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.localName === 'sc-if') {
        if (bind(node.getAttribute('value') || '',scope)) fragment.append(renderNodes(node.childNodes,scope));
        continue;
      }
      if (node.localName === 'sc-for') {
        const list = bind(node.getAttribute('list') || '',scope) || [];
        list.forEach((item,index) => {const child = Object.create(scope); child[node.getAttribute('as') || 'item'] = item; child.$index=index; fragment.append(renderNodes(node.childNodes,child));});
        continue;
      }
      const element = node.namespaceURI === 'http://www.w3.org/2000/svg' ? document.createElementNS(node.namespaceURI,node.tagName) : document.createElement(node.localName);
      let value, checked;
      for (const attr of node.attributes) {
        const key = attr.name.toLowerCase();
        if (key.startsWith('hint-placeholder-')) continue;
        const val = bind(attr.value,scope);
        if (key.startsWith('on') && typeof val === 'function') {
          let event = key.slice(2);
          if (event === 'change' && (node.localName === 'textarea' || (node.localName === 'input' && !['radio','checkbox','file'].includes(node.getAttribute('type'))))) event='input';
          element.addEventListener(event,val); continue;
        }
        if (key.startsWith('on')) continue;
        if (key === 'value') {value=val; continue;}
        if (key === 'checked') {checked=!!val; continue;}
        if (['disabled','multiple','required','readonly','selected'].includes(key)) {
          if (val === true || val === '' || val === key) element.setAttribute(key,'');
          continue;
        }
        if (val != null) element.setAttribute(attr.name,String(val));
      }
      if (node.localName === 'option') element.textContent = String(bind(node.textContent,scope));
      else element.append(renderNodes(node.childNodes,scope));
      if (value != null) {element.setAttribute('value',String(value)); element.value=String(value);}
      if (checked != null) element.checked=checked;
      fragment.append(element);
    }
    return fragment;
  }
  function redraw(component) {
    const active = document.activeElement;
    const focusId = root.contains(active) ? active.id : '';
    const selection = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart,active.selectionEnd] : null;
    const scroll = [...root.querySelectorAll('.scrl')].map(n => [n.scrollLeft,n.scrollTop]);
    root.replaceChildren(renderNodes(source,component.renderVals()));
    [...root.querySelectorAll('.scrl')].forEach((n,i) => {if(scroll[i]) {n.scrollLeft=scroll[i][0];n.scrollTop=scroll[i][1];}});
    const next = focusId && document.getElementById(focusId);
    if (next) {next.focus({preventScroll:true}); if(selection && next.setSelectionRange) next.setSelectionRange(...selection);}
  }
  class DCLogic {
    constructor(initialProps) {this.props=initialProps;this.state={};}
    setState(next) {this.state=next;redraw(this);}
    forceUpdate() {redraw(this);}
  }
  // Only the frozen, locally authored component is compiled. Form values are never code.
  const Component = new Function('DCLogic',logic.textContent+'\nreturn Component;')(DCLogic);
  const component = new Component(props);
  redraw(component);
  // Fit only the outer presentation canvas; authored CSS geometry stays unchanged.
  const fit = () => {
    const scale = Math.min(1, window.innerWidth / 1500, window.innerHeight / 1220);
    root.style.cssText = `position:absolute;width:1500px;height:1220px;transform-origin:top left;transform:scale(${scale});left:${Math.max(0,(window.innerWidth-1500*scale)/2)}px;top:0`;
    document.body.style.overflow = 'hidden';
  };
  window.addEventListener('resize',fit); fit();
})();
