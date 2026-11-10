export function bindScrollRebound(content: HTMLElement): () => void {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new AbortController();
  const passive = { passive: true, signal: listeners.signal };
  let lastTouch: Touch | null = null;
  let pull = 0;
  let wheelTimer = 0;
  let returnAnimation: Animation | undefined;

  const atEdge = (delta: number) => delta < 0
    ? content.scrollTop <= 1
    : content.scrollHeight - content.clientHeight - content.scrollTop <= 1;
  const canPull = (event: Event) => {
    if (motion.matches || event.defaultPrevented) return false;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable], .pc-continue-dock, .pc-floating-search-row, .pc-user-search-pill')) return false;
    for (let node = target; node && node !== content; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 1 && /^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) return false;
    }
    return true;
  };
  const offset = () => `${-36 * pull / (Math.abs(pull) + 64)}px`;

  const settle = () => {
    window.clearTimeout(wheelTimer);
    if (!pull) return;
    const from = offset();
    pull = 0;
    content.style.removeProperty('top');
    if (!motion.matches) {
      returnAnimation = content.animate([{ top: from }, { top: '0px' }], {
        duration: 240,
        easing: 'cubic-bezier(.2, .75, .3, 1)'
      });
    }
  };

  const stretch = (delta: number) => {
    const direction = Math.sign(pull || delta);
    const nextPull = direction * Math.min(320, Math.max(0, (pull + delta) * direction));
    if (nextPull === pull) return;
    returnAnimation?.cancel();
    pull = nextPull;
    if (pull) content.style.top = offset();
    else content.style.removeProperty('top');
  };

  content.classList.add('pc-scroll-rebound');
  content.addEventListener('touchstart', event => {
    settle();
    lastTouch = canPull(event) && event.touches.length === 1 ? event.touches[0] : null;
  }, passive);
  content.addEventListener('touchmove', event => {
    if (!lastTouch || event.touches.length !== 1 || event.defaultPrevented || motion.matches) return;
    const touch = event.touches[0];
    const dy = lastTouch.clientY - touch.clientY;
    const dx = lastTouch.clientX - touch.clientX;
    lastTouch = touch;
    if (Math.abs(dy) > Math.abs(dx) && atEdge(pull || dy)) stretch(dy);
  }, passive);
  const finishTouch = () => {
    lastTouch = null;
    settle();
  };
  content.addEventListener('touchend', finishTouch, passive);
  content.addEventListener('touchcancel', finishTouch, passive);
  content.addEventListener('wheel', event => {
    if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (!atEdge(event.deltaY)) {
      settle();
      return;
    }
    if (!canPull(event)) return;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? content.clientHeight : 1;
    stretch(event.deltaY * unit);
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(settle, 100);
  }, passive);
  content.addEventListener('scroll', () => { if (pull && !atEdge(pull)) settle(); }, passive);
  motion.addEventListener('change', () => {
    returnAnimation?.cancel();
    finishTouch();
  }, { signal: listeners.signal });

  return () => {
    listeners.abort();
    window.clearTimeout(wheelTimer);
    returnAnimation?.cancel();
    content.style.removeProperty('top');
    content.classList.remove('pc-scroll-rebound');
  };
}
