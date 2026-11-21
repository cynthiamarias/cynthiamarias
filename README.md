# cynthiamarias.com

Cynthia's site, hosted on GitHub Pages. Plain HTML, no build step.

- `index.html`: home page
- `wishlist/`: the wish list. Lives in a Firebase Realtime Database (project `wishlist-7a0d5`); people sign in with Google.
- `firebase/database.rules.json`: the database rules. Paste into Firebase Console → Realtime Database → Rules → Publish whenever they change.
- `CNAME`: the custom domain.

Owners (can edit the list and who has access): `cynthiamarias@gmail.com` and `latona@gmail.com`. Keep `OWNERS` and `SURPRISE_FOR` in `wishlist/index.html` in sync with the rules file.

## Setup checklist

1. **Firebase rules:** paste `firebase/database.rules.json` into Realtime Database → Rules → Publish. (If pasting from a phone fails with errors about spaces, remove every space from the JSON; the rules don't need them.)
2. **Authorized domains:** Firebase → Authentication → Settings → add `cynthiamarias.com` and `www.cynthiamarias.com`.
3. **GitHub Pages:** repo Settings → Pages → Deploy from a branch → `main` / root. Then tick **Enforce HTTPS** once it's available.
4. **DNS:** four `A` records for `@` (`185.199.108.153`, `.109.153`, `.110.153`, `.111.153`) and a `www` CNAME to `cynthiamarias.github.io`, all set to DNS only (no proxy).

## If the site doesn't update

Every push to `main` starts a "pages build and deployment" run (Actions tab). If the deploy step fails with a 502, it's a GitHub-side hiccup: use **Re-run failed jobs**. Changes appear a minute or two after the run turns green.
