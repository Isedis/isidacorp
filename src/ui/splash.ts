import logo from '../assets/isidacorp-logo.png';

/**
 * The studio's opening, as the brand book sets it: a terminal line (0-0.6 s), the whole mark
 * (0.6-2.4 s), then away into the game (2.4-3.0 s). A tap skips it; reduced motion shows
 * the still mark and leaves smoothly.
 */
export function splash(host: HTMLElement): Promise<void> {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = 'splash';
  el.setAttribute('role', 'presentation');
  el.innerHTML = `<pre class="boot">&gt; ISIDACORP\n&gt; INITIALIZING<span class="cursor">_</span></pre><img class="mark" src="${logo}" alt="Isidacorp" width="900" height="1155">`;
  host.append(el);
  return new Promise((resolve) => {
    const timers: number[] = [];
    const done = () => {
      timers.forEach(clearTimeout);
      el.classList.add('leave');
      setTimeout(() => {
        el.remove();
        resolve();
      }, reduced ? 200 : 600);
    };
    el.addEventListener('click', done, { once: true });
    if (reduced) {
      el.classList.add('show-mark');
      timers.push(window.setTimeout(done, 1600));
    } else {
      timers.push(window.setTimeout(() => el.classList.add('show-mark'), 600));
      timers.push(window.setTimeout(done, 2400));
    }
  });
}
