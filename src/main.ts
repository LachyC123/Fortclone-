import './styles.css';
import { Game } from './core/Game';
import { installSave, connectCloudSave } from './core/Save';

// saves must survive a missing/cleared browser storage (and sync on claude.ai) — before anything reads one
installSave();
const cloud = connectCloudSave();

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
  // give a cloud save a moment to arrive before the game reads its state (the world build is slow anyway)
  let pulledEarly = false;
  await Promise.race([cloud.then((p) => (pulledEarly = p)), new Promise((r) => setTimeout(r, 1500))]);
  const game = new Game(canvas);
  game.start();
  // arrived late: reload what the game already read
  void cloud.then((pulled) => {
    if (pulled && !pulledEarly) game.reloadSave();
  });
  loading.classList.add('hidden');
  setTimeout(() => loading.remove(), 600);
}

boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'Oops — the island failed to load. ' + (e?.message ?? '');
});
