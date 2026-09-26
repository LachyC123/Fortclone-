import './styles.css';
import { Game } from './core/Game';

async function boot() {
  const loading = document.getElementById('loading')!;
  // fonts are used by painted signs, so make sure they're ready before the world is built
  try {
    await Promise.race([
      Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('20px "Fredoka"')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to system fonts */
  }
  // let the loading screen paint before the heavy world build
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas);
  game.start();
  loading.classList.add('hidden');
  setTimeout(() => loading.remove(), 600);
}

boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'Oops — the island failed to load. ' + (e?.message ?? '');
});
