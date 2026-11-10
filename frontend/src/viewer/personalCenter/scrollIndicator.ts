export function bindScrollIndicator(content: HTMLElement, compact = false): () => void {
  const workspace = content.closest<HTMLElement>('.pc-platform-workspace');
  if (!workspace) return () => {};
  const bar = document.createElement('div'), thumb = document.createElement('div');
  bar.className = 'pc-platform-overlay-scrollbar' + (compact ? ' is-compact' : '');
  bar.setAttribute('aria-hidden', 'true'); bar.hidden = true;
  bar.style.top = `${content.offsetTop + 4}px`;
  thumb.className = 'pc-platform-overlay-scrollbar-thumb'; bar.append(thumb); workspace.append(bar);
  let timer = 0, frame = 0, dragging = false, startY = 0, startScroll = 0;
  const update = () => {
    const range = Math.max(0, content.scrollHeight - content.clientHeight), height = Math.max(0, content.clientHeight - 8);
    bar.hidden = range <= 2 || height <= 0;
    workspace.classList.toggle('pc-platform-has-more-below', range > 2 && content.scrollTop < range - 2);
    bar.style.height = `${height}px`;
    if (bar.hidden) { bar.classList.remove('is-active'); return; }
    const size = Math.max(36, Math.min(height, height * content.clientHeight / content.scrollHeight));
    thumb.style.height = `${size}px`; thumb.style.transform = `translateY(${Math.min(1, content.scrollTop / range) * (height - size)}px)`;
  };
  const reveal = () => { update(); if (bar.hidden) return; bar.classList.add('is-active'); window.clearTimeout(timer); timer = window.setTimeout(() => { if (!dragging) bar.classList.remove('is-active'); }, 850); };
  const down = (e: PointerEvent) => { e.preventDefault(); dragging = true; startY = e.clientY; startScroll = content.scrollTop; thumb.setPointerCapture(e.pointerId); thumb.classList.add('dragging'); reveal(); };
  const move = (e: PointerEvent) => { if (dragging) content.scrollTop = startScroll + (e.clientY - startY) * (content.scrollHeight - content.clientHeight) / Math.max(1, bar.clientHeight - thumb.offsetHeight); };
  const up = (e: PointerEvent) => { dragging = false; if (thumb.hasPointerCapture(e.pointerId)) thumb.releasePointerCapture(e.pointerId); thumb.classList.remove('dragging'); reveal(); };
  thumb.addEventListener('pointerdown', down); thumb.addEventListener('pointermove', move); thumb.addEventListener('pointerup', up); thumb.addEventListener('pointercancel', up);
  content.addEventListener('scroll', reveal, { passive: true });
  if (!compact) content.addEventListener('pointerenter', reveal, { passive: true });
  const resize = new ResizeObserver(update); resize.observe(content); Array.from(content.children).forEach(child => resize.observe(child));
  const mutation = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); }); mutation.observe(content, { childList: true, subtree: true });
  frame = requestAnimationFrame(update);
  return () => { window.clearTimeout(timer); cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); content.removeEventListener('scroll', reveal); content.removeEventListener('pointerenter', reveal); bar.remove(); workspace.classList.remove('pc-platform-has-more-below'); };
}
