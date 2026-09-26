# Rift Rascals with friends: quick start

Everyone needs to be on the **same Wi-Fi**. One computer (Windows, Mac or Linux) hosts the room. Phones,
tablets and other computers only need a web browser.

## Once, on the computer that will host

1. Install **Node.js** (the "LTS" button on https://nodejs.org).
2. Get the game:
   ```bash
   git clone https://github.com/LachyC123/Fortclone-.git
   cd Fortclone-
   git checkout claude/rift-rascals-game-4y2v8z
   npm install
   ```
   (No git? On GitHub, switch to the `claude/rift-rascals-game-4y2v8z` branch, then **Code → Download ZIP**,
   unzip it, open a terminal in that folder and run `npm install`.)

If you already have it, just run `git pull` in the folder to get the latest version.

## Every time you play

1. On that computer, in the game folder, run:
   ```bash
   npm run lan
   ```
   It prints an address like **`http://192.168.1.20:8787`**. Leave that window open.
2. Open that address on **every** device that wants to play, including the host computer.
3. One of you taps **WITH FRIENDS → MAKE A ROOM** and reads out the 4-letter code.
4. Everyone else taps **WITH FRIENDS**, types the code and taps **JOIN**.
5. The room creator picks **SOLO / DUOS / TRIOS / SQUADS**. Use the ◀ ▶ arrows next to your name to pick a team:
   - **Same team number** means you play together.
   - **Different numbers** means you play against each other, each with bot teammates.
   Bots fill the rest of the 24 places.
6. The room creator taps **START MATCH**. Afterwards they can tap **PLAY AGAIN** for everyone.

## If something goes wrong

- **"No LAN server found"**: the address must be the one `npm run lan` printed, not the claude.ai link. Also
  check everyone is on the same Wi-Fi (not a guest network or mobile data).
- **Windows asks about the firewall**: click **Allow** (private networks).
- **Still can't connect from a phone**: the computer's firewall is blocking port 8787. Allow it, or try
  `PORT=9000 npm run lan` (on Windows PowerShell: `$env:PORT=9000; npm run lan`).
- **Laggy match**: whoever makes the room runs the whole match. Let the fastest device (ideally the computer)
  make the room.
