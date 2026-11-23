# Scrollback paging demo

Run these commands from the xterm.js checkout.

```sh
npm run setup-full
npm run esbuild-demo-client
npm start
```

Open [Scrollback paging](http://127.0.0.1:3000/scrollback) or follow the link in
the main demo banner. The page generates its own output in the browser.

The terminal starts with a live screen and 48 rows of history. Scroll up to
load 48 older rows at a time. Scroll down to retrieve newer rows and rejoin
the live screen. At the 144-row history limit, each page replaces rows at the
other end of the window. The visible text stays in place when a page arrives.

Enable **Generate live output**, scroll back to an older row, and pause.
The latest output row in the status line keeps advancing while you read.
The provider simulates a 180 ms delay and generates rows by ID. This shows
the limits and viewport behavior without requiring a separate terminal service.

[Example source](client/scrollback.ts)
