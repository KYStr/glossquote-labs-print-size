# 圖片列印尺寸試算 / Image Print Size Calculator

A small bilingual browser calculator from Gloss Tools by GlossQuote. Enter an image's pixel width and height, a print width in millimetres, and an editable target PPI. It calculates proportional height, effective PPI, minimum pixel dimensions for the chosen target, and exact target status.

輸入圖片像素寬高、列印毫米寬度與自訂 PPI 門檻，查看等比例高度、有效 PPI 和所需最少像素。本工具不讀取、上傳或修改圖片；PPI 是尺寸密度指標，不是印刷品質保證。預設 300 可自行修改。

Calculations use BigInt rational arithmetic. Displayed height and PPI use positive half-up rounding to two decimal places; target status compares exact values. In the boundary fixtures, both `8466.67 mm` and `8466.66 mm` at `100000 × 100000 px` display `300.00 PPI`, while their 300 PPI target status differs.

## Run locally

Node.js 24 or newer is required. All scripts use Node built-ins; no package installation is needed.

```sh
node --test
node scripts/check.mjs
node scripts/build.mjs
node scripts/serve.mjs
```

Preview pages are `http://127.0.0.1:4211/index.html` and `http://127.0.0.1:4211/en/index.html`. Preview has `noindex,nofollow`. Servers bind only to loopback; an occupied port is reported without stopping the existing service.

## Production artifacts and local HTTP model

```sh
node scripts/build-production.mjs
node scripts/check-production.mjs
node scripts/release-check.mjs
node scripts/serve-production.mjs
```

Equivalent package scripts are `build:production`, `check:production`, `release:check` and `preview:production`.

Production assets are generated in `dist-production/`. Their manifest is `dist-production-manifest.json`, outside the uploaded asset directory. Preview `public/` and `dist/` remain separate. The production HTTP model is `http://127.0.0.1:5211/index.html` and `/en/index.html`; it models the routing/header subset used here and does not prove a Cloudflare deployment. With `html_handling=none`, only exact asset paths are modeled; unknown and directory aliases receive the custom 404.

The configured production origin is `https://printsize.glossquote.com`, with canonical paths `/index.html` and `/en/index.html`. This source and configuration do not establish live hosting, DNS, homepage integration or external acceptance. No deployment command runs as part of tests or builds.

## Privacy and limits

Inputs remain in the current page's memory. Editing invalidates old output; clearing, confirmed language changes and page lifecycle cleanup discard the draft. Loading the website initially requests its static files. There are no accounts, telemetry, remote fonts, storage, image processing, clipboard or download features.

Pixel dimensions accept ASCII integers from 1 to 100000; print width accepts 0.01 to 10000.00 mm with up to two decimal places; target PPI accepts 1 to 2400. Whitespace, signs, exponents, commas and locale conversions are rejected. The fixed pure entry point is `calculatePrintSize(request)` in `public/js/core/print-size.js`.

M1 had 47 passing automated tests and real bilingual browser checks. M2 adds production and source-reference regression coverage. See [model and verification limits](docs/M2-LOCAL-MODEL.md). Native devices, full Network/Storage, confirmed BFCache, native zoom, screen readers and actual paper quality remain unverified where stated. Subsequent UI work was halted at the user's request and is marked `NOT_RUN_USER_FOCUS_INCIDENT`; no M2 browser gate is claimed.

The tests include 31 fixed product oracle cases, hostile schema inputs and independent arithmetic invariants. They use synthetic inputs and independent constants. Public source publication, live deployment and final external review are separate milestones.

## Pure API example

```js
import { calculatePrintSize } from './public/js/core/print-size.js';

const answer = calculatePrintSize({
  pixelWidthRaw: '3000',
  pixelHeightRaw: '2000',
  widthMmRaw: '254',
  targetPpiRaw: '300'
});
```

This example returns `ok: true`, height `169.33`, effective PPI `300.00`, required pixels `3000 × 2000` and `meetsTarget: true`. Invalid requests return only the stable error code and field, without raw input. The UI does not load examples automatically or offer an example button.
