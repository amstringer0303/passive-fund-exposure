# Country Outline Guessing Game

Browser game: open this file directly:

```text
C:\Users\as1612\Desktop\Misc_Folders\nasdaq_project\country_outline_game\index.html
```

It shows one official country outline at a time, gives you five guesses, and reports how many kilometers your wrong guess is from the correct country.

Python desktop version:

```powershell
python .\country_outline_game.py
```

Notes:

- Uses Natural Earth admin-0 countries and cleaner 10m map-unit outlines through Cartopy.
- The browser version stores those detailed outlines in `country_data.js`.
- The browser renderer uses adaptive local projection so wide and high-latitude countries keep recognizable shapes.
- Uses country label points for the distance feedback, so distances are approximate center-to-center kilometers.
- Accepts common aliases such as `usa`, `uk`, `china`, and `czech republic`.

Regenerate browser data:

```powershell
python .\generate_country_data.py
```

Quick non-GUI check:

```powershell
python .\country_outline_game.py --self-test
```

Casual multiplayer with Supabase:

1. Create a free Supabase project.
2. In Supabase, copy the Project URL and anon/publishable key.
3. For local testing, paste them into `supabase_config.js`.
4. For GitHub Pages, add repo secrets named `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
5. Open `index.html`, click `Create room`, then `Copy link`.

Do not put the Supabase secret key or service role key in this static site.
The publishable key is safe for browser use, but it is still visible to anyone who opens the deployed page.

No SQL table is required. The browser version uses Supabase Realtime Broadcast for round/guess messages and Presence for the player list.

Multiplayer scoring:

- Wrong guesses add their distance in kilometers as points.
- Lower points are better.
- The first correct guess ends the round for everyone.
- The host clicks `Next` to start the next shared country.
