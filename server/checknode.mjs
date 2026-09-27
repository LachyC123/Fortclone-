// Friendly check before building: the build tools need a recent Node.js.
const [maj, min] = process.versions.node.split('.').map(Number);
const ok = maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19);
if (!ok) {
  console.log(`
  ------------------------------------------------------------------
   Your Node.js is too old (you have ${process.versions.node}).
   Rift Rascals needs Node.js 22 or newer.

   Fix: go to https://nodejs.org, download the "LTS" version,
   install it, then CLOSE this window, open a new one and run
   npm install   and then   npm run lan   again.
  ------------------------------------------------------------------
`);
  process.exit(1);
}
