# RSI Utilify

A browser extension for the [Roberts Space Industries](https://robertsspaceindustries.com) website. It shows prices in your own currency and recolours the site with in-game manufacturer themes. (The GitHub repository is called **Utilify**.)

> Unofficial fan project. Not affiliated with Cloud Imperium Games or Roberts Space Industries.

## Reporting a bug (read this first)

Open an issue at **https://github.com/Hooroo-mp4/Utilify/issues** and include:

1. **What you did, what you expected, and what happened instead.**
2. **The page link** (the address of the RSI page where it goes wrong) and a **screenshot**.
3. **Your browser and its version**, and the **RSI Utilify version** (shown in the menu header).

### If it's a theme bug (wrong colours, a background that stays blue, something broken after recolouring)

Please attach the theme report. It takes ten seconds and lets me see exactly what the extension did on that page:

1. Go to the **RSI page where the problem is** and leave your theme switched on.
2. Click the **RSI Utilify icon** to open the menu.
3. In the **Website theme** section, click **Background images on this page** to expand it.
4. Press **Copy report**.
5. **Paste it into your bug report** (together with the screenshot and page link).

The report contains the extension version, your theme, the page's path, your browser, which parts of the page are deliberately left untouched, and what happened to each background image (recoloured, left alone and why, or couldn't be done). It contains nothing personal.

### If it's a price bug

Say which currency RSI is set to (USD, EUR or GBP), which currency you picked in the menu, and include a screenshot of the price.

---

## What it does

### Currency converter
- Hover a price and it swipes up and is replaced by the price in **your currency** at the current exchange rate. Move the mouse away and it swipes back. The `USD` / `EUR` / `GBP` label next to the price flips to your currency code at the same time, and a crossed-out old price flips together with the current one.
- Works whichever currency RSI is showing (**USD, EUR or GBP**): each price is read, its currency worked out, and converted from there. This includes prices RSI builds out of separate pieces (for example the animated upgrade price above **Add To Cart**).
- Choose **any currency except USD, EUR and GBP** (about 160) from a searchable list. The default is AUD.
- **Always show converted prices** converts every price without hovering. Hover one to peek at the original.
- Rates are mid-market reference rates from open.er-api.com (frankfurter.app as a fallback), cached for an hour. The providers update about once a day. Your card's or PayPal's real charge will differ.

### Website themes
- 18 themes based on in-game manufacturers (Aegis, Anvil, Aopoa, Argo, Banu, Consolidated Outland, Crusader, Drake, Esperia, Gatac, Grey's Market, Greycat, Kruger, Mirai, MISC, Origin, Tumbril) plus the normal RSI blue. Each recolours RSI's dark backgrounds and its bright accent (buttons, links) separately. Or make your own with the **Base colour**, **Accent colour** and **Colourfulness** sliders.
- **What changes:** RSI's blues, including colours set inline, blue background images (recoloured pixel by pixel, SVGs as text) and big animated backgrounds (tinted with a matching filter).
- **What doesn't:** sale prices, errors and the orange checkout buttons keep their colours. Photos, ship images and videos are never changed. MISC, Origin and Tumbril are really light brands, so they appear as lighter steel, silver and tan on RSI's dark site.
- Changes apply instantly to every open RSI tab, and your theme is remembered so pages load already themed.

### Organization pages
Organizations choose their own colours and background, so pages under `/orgs/<name>` are **left alone by default**. The **Recolour organization pages** setting recolours the organization's content too. An organization's **background is never changed**, even with the setting on.

### Star Citizen Hangar XPLORer
Works alongside **Star Citizen Hangar XPLORer**: its total spend converts on hover, and its own interface (filters, sort, search, pager and the total panel with the CSV/JSON buttons) is **never recoloured**.

### Updates
On browser start RSI Utilify checks this GitHub repository for a newer release and, if there is one, opens a tab with the release notes and download link. See [Updating](#updating).

## Compatibility
| Browser | Supported |
|---|---|
| Google Chrome | ✅ |
| Opera / Opera GX | ✅ |
| Microsoft Edge | ✅ |
| Brave | ✅ |
| Firefox | ❌ not supported |

The extension only runs on `robertsspaceindustries.com`.

---

## Installation (manual / developer mode)

Until RSI Utilify is on a browser store, you install it by loading the folder yourself. It takes about a minute.

### Step 1: Download
1. On this GitHub page click the green **Code** button, then **Download ZIP**.
   (Or download `Utilify.zip` from the Releases page.)
2. Save it somewhere you'll remember, like your Downloads folder.

### Step 2: Unzip it
**Windows**
1. Find the `.zip` file in File Explorer.
2. Right-click it and choose **Extract All...**
3. Click **Extract**. A normal folder appears next to the zip.

**Mac**
1. Double-click the `.zip` file. A folder appears next to it.

### Step 3: Put the folder somewhere permanent
The browser reads the extension from this folder **every time it starts**, so don't delete or move it afterwards. A good spot is `Documents` or `C:\Users\YourName\Extensions`.

### Step 4: Find the right folder
Open the unzipped folder. You should see these files inside:

```
manifest.json
background.js
currency.js
theme.js
popup.html
icons/
README.md
...
```

The folder that **directly contains `manifest.json`** is the one you need. Sometimes unzipping creates a folder inside a folder (for example `Utilify` → `Utilify`). If you open the first one and see only another folder, that inner one is the right one.

### Step 5: Load it into your browser
Pick your browser below.

#### Google Chrome
1. Type `chrome://extensions` into the address bar and press Enter.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** (top-left).
4. In the window that opens, **click the folder once to highlight it. Don't double-click it.** Make sure it's the folder that contains `manifest.json`.
5. Click **Select Folder** (Windows) or **Select** (Mac).

#### Opera / Opera GX
1. Type `opera://extensions` into the address bar and press Enter.
   (Or: click the Opera menu in the top-left, then **Extensions**, then **Manage Extensions**. The shortcut is `Ctrl + Shift + E`.)
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. **Click the folder once to highlight it. Don't double-click it.** Choose the folder that contains `manifest.json`.
5. Click **Select Folder**.

#### Microsoft Edge
1. Go to `edge://extensions`.
2. Turn on **Developer mode** (left sidebar).
3. Click **Load unpacked**, click the folder once to highlight it, then **Select Folder**.

#### Brave
1. Go to `brave://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked**, click the folder once to highlight it, then **Select**.

### Step 6: Check it worked
- A **welcome tab** should open saying "Thanks for downloading!" and showing your version number.
- **RSI Utilify** should appear in your extensions list, switched **on**.
- Click the RSI Utilify icon (pin it from the puzzle-piece / cube menu) to open the menu.
- Open any RSI store page, for example the [First Flight Pack](https://robertsspaceindustries.com/en/pledge/Packages/Star-Citizen-First-Flight-Pack), and **hover over a price**. It should swipe up and show the converted amount.

> If you had an RSI page open while installing, refresh it (`F5`) once.

---

## Settings
Click the **RSI Utilify icon** in your browser toolbar. If you can't see it, open the puzzle-piece icon in Chrome/Edge/Brave or the cube icon in Opera and pin it.

| Setting | What it does |
|---|---|
| **Always show converted prices** | Converts every price on the page without hovering. Hover a price to peek at the original. |
| **Convert prices to** | Your currency. Type in the search box to filter (try `yen`, `CAD` or `swiss`). Default: AUD. |
| **Website theme** | Pick a manufacturer (hover a swatch to see its name; each swatch shows the theme's background and accent colour), or drag **Base colour** / **Accent colour** / **Colourfulness**. The first swatch (RSI blue) switches theming off. |
| **Recolour organization pages** | Off by default. When on, organization pages (`/orgs/<name>`) are recoloured too. Their backgrounds are never changed. |
| **Background images on this page** | A report of what happened to each background image on the open RSI page. Use **Copy report** for [theme bug reports](#reporting-a-bug-read-this-first). |
| **Check for updates on browser start** | On by default. See [Updating](#updating). |
| **Check now** | Checks GitHub for a newer release immediately. |

The menu also shows the exchange rate in use and when it was last fetched.

## Where to find the extension afterwards

| Browser | How to open the extensions list |
|---|---|
| Chrome | `chrome://extensions`, or the puzzle-piece icon in the toolbar, then **Manage extensions** |
| Opera / Opera GX | `opera://extensions`, or `Ctrl + Shift + E`, or the cube icon in the toolbar / sidebar |
| Edge | `edge://extensions` |
| Brave | `brave://extensions` |

From there you can switch it off or on, or remove it.

## Updating

**Update notifications.** When your browser starts, RSI Utilify asks GitHub (`api.github.com`) for the latest release of this repository. If it's newer than the version you have, a tab opens with the release notes, a download button and **Skip this version**. A skipped version is not shown again, but a newer one will be. Turn the check off with **Check for updates on browser start** in the menu. Installs from a browser store update themselves, so for those the check does nothing.

**Installing an update.**
1. Download and unzip the new version.
2. Replace the old files in your folder with the new ones (or point **Load unpacked** at the new folder after removing the old one).
3. Open your browser's extensions page and press the **reload** icon (circular arrow) on RSI Utilify.
4. Refresh any open RSI tabs.

(Reloading an unpacked extension also opens the welcome tab again. That's normal.)

## Troubleshooting

| Problem | Fix |
|---|---|
| **"Manifest file is missing or unreadable"** | You selected the wrong folder. Select the one that directly contains `manifest.json` (see Step 4). |
| **I don't see a "Load unpacked" button** | Turn on **Developer mode** first. |
| **Extension disappeared after restarting the browser or moving a folder** | The browser lost the folder. Don't move or delete it after loading. Load it again from its location. |
| **I can't find the menu** | Pin the extension: click the puzzle-piece icon (cube icon in Opera) and pin **RSI Utilify**. |
| **Prices don't swap when I hover** | Refresh the RSI page. Check the extension is switched on. |
| **Price shows "…"** | The exchange rate hasn't loaded. Check your internet connection, then refresh. |
| **My currency isn't in the list** | The list comes from the live exchange-rate provider, so a few very obscure currencies may be missing. USD, EUR and GBP are left out on purpose. |
| **A background is still blue** | Follow the [theme bug steps](#if-its-a-theme-bug-wrong-colours-a-background-that-stays-blue-something-broken-after-recolouring) and attach the copied report. The first visit to a page with a very large background can take a few seconds to recolour; after that it's remembered. |
| **An organization page isn't themed** | That's deliberate. Turn on **Recolour organization pages** in the menu. Their backgrounds are never changed. |
| **Theme doesn't change everything** | RSI Utilify recolours RSI's blue palette and blue background images, so photos, ship images, videos and a few older pages with their own styling stay as they are. |
| **Page flashes blue for a moment after changing theme** | Only the very first load after picking a new theme. It's remembered after that. |
| **Opera shows a warning about developer-mode extensions** | This is normal for extensions loaded manually. |
| **A price isn't converting** | [Open an issue](https://github.com/Hooroo-mp4/Utilify/issues) with a screenshot and the page link. |

## Permissions (and why)

| Permission | Why |
|---|---|
| `storage`, `unlimitedStorage` | Saves your settings, the exchange rates and the recoloured theme/background images (which can be large) so pages load already themed. |
| `alarms` | Refreshes the exchange rates every hour. |
| `robertsspaceindustries.com` | The only site the extension runs on. |
| `cdn.robertsspaceindustries.com` | To download RSI's own background images so they can be recoloured on your device. |
| `open.er-api.com`, `api.frankfurter.app` | Exchange rates. |
| `api.github.com` | The update check (a single request when your browser starts). |

Nothing about you or the pages you visit is sent anywhere. See [PRIVACY.md](PRIVACY.md).

## How it works
- `currency.js` finds price text (such as `$49.50 USD`, `€45,55`, `686.40 USD`, or digits split over several elements), wraps it in a two-layer element and pairs it with a separate currency label. `currency.css` handles the slide animation.
- `theme.js` reads RSI's own stylesheets (and inline styles), finds every blue colour and writes override rules for the chosen theme, treating the dark base blues and the bright accent blue separately. It also recolours RSI's decorative background images on your device and reads what the page's big background layers actually paint. Hangar XPLORer's interface and (by default) organization pages are excluded. `themes.js` holds the manufacturer presets.
- `background.js` fetches USD exchange rates for every currency, caches them for an hour, downloads background images for the theme engine and runs the update check.
- `popup.html` / `popup.js` is the menu, `welcome.html` the tab shown after install/update, `update.html` the tab shown when a newer version exists.

## Support the developer
Like it? The menu has a **Refer** button (https://hooroo.net/rsi) if you'd like to help by referring a friend, and a **Ko-fi** button (https://ko-fi.com/hooroo). Both only open a page when you click them.

## Contributing
Pull requests are welcome. To work on it, load the folder as above, edit the files, then click the reload icon on the extensions page to see your changes.

## License
MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Hooroo-mp4.
