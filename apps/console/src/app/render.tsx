import { renderToStaticMarkup } from "react-dom/server";

import { ConsoleApp } from "./app.js";
import { consoleAppCss } from "./styles.js";
import type { ConsoleDataSet, ConsoleRenderOptions } from "./types.js";

export function renderConsoleHtml(options: ConsoleRenderOptions): string {
  const route = options.route ?? "/";
  const body = renderToStaticMarkup(<ConsoleApp routePath={route} data={options.data} />);
  const state = `<script id="boreal-console-state" class="bw-json-state" type="application/json">${escapeJsonForScript(JSON.stringify(consoleStatePayload(options.data)))}</script>`;
  if (options.includeDocument === false) {
    return `${body}${state}`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Boreal Console</title><style>${consoleAppCss}</style></head><body>${body}${state}</body></html>`;
}

export function consoleStatePayload(data: ConsoleDataSet): unknown {
  return {
    ...data,
    routes: data.routes.map((route) => ({
      id: route.id,
      path: route.path,
      label: route.label
    }))
  };
}

function escapeJsonForScript(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}
