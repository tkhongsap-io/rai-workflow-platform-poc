// W1-07 (Lane B): after a client-side navigation the element that had focus is gone, so keyboard focus moves to
// the main landmark (tabIndex -1) and the next Tab reaches the first control of the new screen instead of falling
// off the page; assistive technology hears the new content. The initial load keeps the browser's default: the
// location the shell mounted with is remembered, so StrictMode's double effect run never focuses on first paint.

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export function RouteFocus({ mainId }: { mainId: string }): null {
  const location = useLocation();
  const initialKey = useRef(location.key);
  useEffect(() => {
    if (location.key === initialKey.current) return;
    if (location.hash !== '') return; // an in-page anchor (the skip link) keeps its own target
    document.getElementById(mainId)?.focus();
  }, [location.key, location.hash, mainId]);
  return null;
}
